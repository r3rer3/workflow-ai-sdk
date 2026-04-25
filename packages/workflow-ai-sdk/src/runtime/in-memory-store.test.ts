import { describe, expect, it } from "bun:test";
import { createWorkflowStartStreamEvent } from "./create-stream-event";
import { createInMemoryWorkflowStore } from "./in-memory-store";
import type {
  WorkflowCheckpoint,
  WorkflowExecutionState,
  WorkflowRunRecord,
  WorkflowUIMessage,
} from "./types";

type TestState = {
  count: number;
  nested: {
    label: string;
  };
};

type TestMessage = WorkflowUIMessage;

function createMessage(
  overrides: Partial<TestMessage> = {},
): WorkflowUIMessage {
  return {
    id: "msg_1",
    role: "user",
    parts: [
      {
        type: "text",
        text: "hello",
      },
    ],
    ...overrides,
  };
}

function createExecutionState(
  overrides: Partial<WorkflowExecutionState<TestState, TestMessage>> = {},
): WorkflowExecutionState<TestState, TestMessage> {
  return {
    state: {
      count: 1,
      nested: {
        label: "initial",
      },
    },
    messages: [createMessage()],
    ...overrides,
  };
}

function createRun(
  overrides: Partial<WorkflowRunRecord<TestState, TestMessage>> = {},
): WorkflowRunRecord<TestState, TestMessage> {
  return {
    workflowName: "demo",
    runId: "run_1",
    threadId: "thread_1",
    resourceId: "resource_1",
    mode: "resumable",
    executionState: createExecutionState(),
    status: "paused",
    metadata: {
      attempt: 1,
    },
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createCheckpoint(
  overrides: Partial<WorkflowCheckpoint<TestState, TestMessage>> = {},
): WorkflowCheckpoint<TestState, TestMessage> {
  return {
    workflowName: "demo",
    runId: "run_1",
    mode: "resumable",
    threadId: "thread_1",
    resourceId: "resource_1",
    executionState: createExecutionState(),
    pause: {
      kind: "pause",
      reason: "awaiting-input",
      payload: {
        required: true,
      },
    },
    metadata: {
      source: "test",
    },
    runtime: {
      nextOccurrenceId: 2,
      pendingEvents: [
        {
          id: 1,
          event: {
            type: "step.ready",
            data: {
              step: 1,
            },
          },
        },
      ],
      stepStates: [
        {
          history: [
            {
              id: 0,
              event: {
                type: "workflow.started",
                data: {
                  at: "t0",
                },
              },
            },
          ],
        },
      ],
    },
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createWorkflowStartEvent() {
  return createWorkflowStartStreamEvent({
    workflowName: "demo",
    runId: "run_1",
    threadId: "thread_1",
    resourceId: "resource_1",
    mode: "resumable",
    resumed: false,
    hierarchy: {
      workflowName: "demo",
      workflowRunId: "run_1",
    },
  });
}

describe("InMemoryWorkflowStore", () => {
  it("creates runs from cloned input records", async () => {
    const store = createInMemoryWorkflowStore<TestState, TestMessage>();
    const record = createRun();

    await store.createRun(record);

    record.executionState.state.nested.label = "mutated";
    // biome-ignore lint/style/noNonNullAssertion: guaranteed by createRun to have at least one message
    record.executionState.messages[0]!.id = "msg_changed";
    // biome-ignore lint/style/noNonNullAssertion: guaranteed by createRun to have metadata
    record.metadata!.attempt = 2;

    const stored = store.state.runs.get(record.runId);

    expect(stored).toEqual(
      expect.objectContaining({
        executionState: expect.objectContaining({
          state: {
            count: 1,
            nested: {
              label: "initial",
            },
          },
          messages: [
            expect.objectContaining({
              id: "msg_1",
            }),
          ],
        }),
        metadata: {
          attempt: 1,
        },
      }),
    );
    expect(stored).not.toBe(record);
  });

  it("updates run status and stores cloned results", async () => {
    const store = createInMemoryWorkflowStore<TestState, TestMessage>();
    const record = createRun();

    await store.createRun(record);
    await store.markRunRunning(record.runId);

    const running = store.state.runs.get(record.runId);
    expect(running?.status).toBe("running");
    expect(running?.updatedAt).not.toBe(record.updatedAt);

    await store.markRunPaused(record.runId, {
      kind: "pause",
      reason: "wait",
    });

    expect(store.state.runs.get(record.runId)?.status).toBe("paused");

    const result = {
      output: {
        done: true,
      },
    };
    await store.markRunCompleted(record.runId, result);

    result.output.done = false;

    expect(store.state.runs.get(record.runId)?.status).toBe("completed");
    expect(store.state.results.get(record.runId)).toEqual({
      output: {
        done: true,
      },
    });
  });

  it("records failure and abort metadata", async () => {
    const store = createInMemoryWorkflowStore<TestState, TestMessage>();

    await store.createRun(createRun({ runId: "run_failed" }));
    await store.markRunFailed("run_failed", {
      message: "boom",
    });

    expect(store.state.runs.get("run_failed")).toEqual(
      expect.objectContaining({
        status: "failed",
        metadata: {
          attempt: 1,
          lastError: "boom",
        },
      }),
    );

    await store.createRun(createRun({ runId: "run_aborted" }));
    await store.markRunAborted("run_aborted", "cancelled");

    expect(store.state.runs.get("run_aborted")).toEqual(
      expect.objectContaining({
        status: "aborted",
        metadata: {
          attempt: 1,
          abortReason: "cancelled",
        },
      }),
    );

    await store.createRun(createRun({ runId: "run_aborted_null" }));
    await store.markRunAborted("run_aborted_null");

    expect(
      store.state.runs.get("run_aborted_null")?.metadata?.abortReason,
    ).toBeNull();
  });

  it("appends events as clones and returns cloned event arrays", async () => {
    const store = createInMemoryWorkflowStore<TestState, TestMessage>();
    const event = createWorkflowStartEvent();

    await store.appendEvent("run_1", event);

    event.data.threadId = "thread_changed";

    const firstRead = store.getEvents("run_1");
    expect(firstRead).toEqual([
      expect.objectContaining({
        type: "workflow-start",
        data: expect.objectContaining({
          threadId: "thread_1",
        }),
      }),
    ]);

    const storedEvent = firstRead[0];
    if (storedEvent?.type === "workflow-start") {
      storedEvent.data.threadId = "thread_read_mutation";
    }
    firstRead.push(createWorkflowStartEvent());

    const secondRead = store.getEvents("run_1");
    expect(secondRead).toHaveLength(1);
    expect(secondRead[0]).toEqual(
      expect.objectContaining({
        type: "workflow-start",
        data: expect.objectContaining({
          threadId: "thread_1",
        }),
      }),
    );
  });

  it("saves checkpoints and returns cloned checkpoint-derived state", async () => {
    const store = createInMemoryWorkflowStore<TestState, TestMessage>();
    const checkpoint = createCheckpoint();

    await store.saveCheckpoint(checkpoint);

    checkpoint.executionState.state.nested.label = "mutated";
    // biome-ignore lint/style/noNonNullAssertion: guaranteed by createCheckpoint to have at least one message
    checkpoint.executionState.messages[0]!.id = "msg_changed";

    const loaded = await store.loadCheckpoint("run_1");

    expect(loaded).toEqual(
      expect.objectContaining({
        executionState: expect.objectContaining({
          state: {
            count: 1,
            nested: {
              label: "initial",
            },
          },
          messages: [
            expect.objectContaining({
              id: "msg_1",
            }),
          ],
        }),
        pendingEvents: [
          {
            type: "step.ready",
            data: {
              step: 1,
            },
          },
        ],
      }),
    );

    // biome-ignore lint/style/noNonNullAssertion: guaranteed by createCheckpoint to have executionState
    loaded!.executionState.state.nested.label = "loaded-mutation";
    // biome-ignore lint/style/noNonNullAssertion: guaranteed by createCheckpoint to have executionState with at least one message
    loaded!.executionState.messages[0]!.id = "loaded_msg_changed";

    const executionState = store.getExecutionState("run_1");
    const state = store.getState("run_1");

    expect(executionState).toEqual({
      state: {
        count: 1,
        nested: {
          label: "initial",
        },
      },
      messages: [
        expect.objectContaining({
          id: "msg_1",
        }),
      ],
    });
    expect(state).toEqual({
      count: 1,
      nested: {
        label: "initial",
      },
    });

    // biome-ignore lint/style/noNonNullAssertion: guaranteed by createCheckpoint to have executionState
    executionState!.state.nested.label = "execution-mutation";
    // biome-ignore lint/style/noNonNullAssertion: guaranteed by createCheckpoint to have executionState with at least one message
    state!.nested.label = "state-mutation";

    expect(store.getExecutionState("run_1")?.state.nested.label).toBe(
      "initial",
    );
    expect(store.getState("run_1")?.nested.label).toBe("initial");
  });

  it("returns empty or null values for missing runs and checkpoints", async () => {
    const store = createInMemoryWorkflowStore<TestState, TestMessage>();

    await store.markRunRunning("missing");
    await store.markRunCompleted("missing", {
      ok: true,
    });
    await store.markRunFailed("missing", {
      message: "boom",
    });
    await store.markRunPaused("missing", {
      kind: "pause",
      reason: "wait",
    });
    await store.markRunAborted("missing", "cancelled");

    expect(store.state.runs.size).toBe(0);
    expect(store.state.results.size).toBe(0);
    expect(await store.loadCheckpoint("missing")).toBeNull();
    expect(store.getExecutionState("missing")).toBeNull();
    expect(store.getState("missing")).toBeNull();
    expect(store.getEvents("missing")).toEqual([]);
  });
});

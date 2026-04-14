import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type {
  RuntimeContext,
  WorkflowDispatchOperation,
  WorkflowDispatchStream,
} from "../index";
import { createWorkflowHierarchy, createWorkflowTool } from "../index";

describe("createWorkflowTool", () => {
  it("emits tool lifecycle events and can update workflow state", async () => {
    const emitted: string[] = [];
    const createEmptyStream = (): WorkflowDispatchStream => {
      const stream: WorkflowDispatchStream = {
        filter() {
          return stream;
        },
        until() {
          return stream;
        },
        async toArray() {
          return [];
        },
        async *[Symbol.asyncIterator]() { },
      };

      return stream;
    };
    const dispatch = (): WorkflowDispatchOperation => {
      const done = Promise.resolve();
      const stream = createEmptyStream();

      return Object.assign(done, {
        done,
        stream,
      });
    };
    const state = {
      calls: 0,
    };
    const context: RuntimeContext<any> = {
      runId: "run_1",
      threadId: "thread_1",
      resourceId: "resource_1",
      mode: "abortable",
      signal: new AbortController().signal,
      state,
      messages: [],
      executionState: {
        state,
        messages: [],
      },
      stream: createEmptyStream(),
      emit(event) {
        emitted.push(event.type);
      },
      dispatch,
      checkpoint: async () => undefined,
      pause(value) {
        return value;
      },
      getHierarchy() {
        return createWorkflowHierarchy("test-workflow", "run_1");
      },
    };

    const factory = createWorkflowTool<
      { a: number; b: number },
      number,
      { calls: number }
    >({
      name: "sum",
      description: "Sums two values",
      inputSchema: z.object({
        a: z.number(),
        b: z.number(),
      }),
      execute: async (
        input: { a: number; b: number },
        _options,
        runtimeContext,
      ) => {
        runtimeContext.state.calls += 1;
        return input.a + input.b;
      },
    });

    const tool = factory(context);
    await tool.onInputStart?.({
      toolCallId: "call_1",
      messages: [],
      abortSignal: undefined,
    });
    const result = await tool.execute?.(
      {
        a: 2,
        b: 3,
      },
      {
        toolCallId: "call_1",
        messages: [],
        abortSignal: undefined,
      },
    );

    expect(result).toBe(5);
    expect(emitted).toEqual(["tool-start", "tool-end"]);
    expect(state.calls).toBe(1);
  });
});

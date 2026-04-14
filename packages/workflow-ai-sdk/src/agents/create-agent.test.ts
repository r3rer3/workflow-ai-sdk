import { describe, expect, it } from "bun:test";

import {
  createAgent,
  createFakeAgent,
  createWorkflowHierarchy,
  type RuntimeContext,
  type WorkflowDispatchOperation,
  type WorkflowDispatchStream,
  type WorkflowUIMessage,
} from "../index";

describe("createAgent", () => {
  it("emits lifecycle and ui chunk events", async () => {
    const events: string[] = [];
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
      turnCount: 1,
    };
    const messages: WorkflowUIMessage[] = [
      {
        id: "msg_1",
        role: "user",
        parts: [
          {
            type: "text",
            text: "Hello",
          },
        ],
      },
    ];
    const context: RuntimeContext<any, WorkflowUIMessage> = {
      runId: "run_1",
      threadId: "thread_1",
      resourceId: "resource_1",
      mode: "abortable",
      signal: new AbortController().signal,
      state,
      messages,
      executionState: {
        state,
        messages,
      },
      emit(event) {
        events.push(event.type);
      },
      stream: createEmptyStream(),
      dispatch,
      checkpoint: async () => undefined,
      pause(value) {
        return value;
      },
      getHierarchy() {
        return createWorkflowHierarchy("test-workflow", "run_1");
      },
    };

    const fakeAgent = createFakeAgent<WorkflowUIMessage>({
      chunks: [
        {
          type: "text-start",
          id: "text_1",
        },
        {
          type: "text-delta",
          id: "text_1",
          delta: "Hello there",
        },
        {
          type: "text-end",
          id: "text_1",
        },
      ],
      text: "Hello there",
      usage: {
        inputTokens: 10,
        inputTokenDetails: {
          noCacheTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        outputTokens: 4,
        outputTokenDetails: {
          textTokens: 4,
          reasoningTokens: 0,
        },
        totalTokens: 14,
      },
    });

    const wrapped = createAgent({
      name: "assistant",
      model: "openai:gpt-4.1-mini",
      agent: fakeAgent,
    });

    const result = await wrapped.run(messages, context);

    expect(result.success).toBe(true);
    expect(events).toEqual([
      "agent-start",
      "ui-message-chunk",
      "ui-message-chunk",
      "ui-message-chunk",
      "agent-end",
    ]);
  });
});

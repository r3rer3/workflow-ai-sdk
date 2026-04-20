import { describe, expect, it } from "bun:test";
import { convertArrayToReadableStream, MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

import {
  createAgent,
  createWorkflowHierarchy,
  createWorkflowTool,
  type RuntimeContext,
  type WorkflowDispatchOperation,
  type WorkflowDispatchStream,
  type WorkflowStreamEvent,
  type WorkflowUIMessage,
} from "../index";

function createEmptyStream(): WorkflowDispatchStream {
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
    toAsyncIterator() {
      return this[Symbol.asyncIterator]();
    },
  };

  return stream;
}

function createDispatch(): WorkflowDispatchOperation {
  const done = Promise.resolve();
  const stream = createEmptyStream();

  return Object.assign(done, {
    done,
    stream,
  });
}

function createContext<TState extends Record<string, unknown>>(
  state: TState,
  messages: WorkflowUIMessage[],
) {
  const events: WorkflowStreamEvent[] = [];
  const context: RuntimeContext<TState, WorkflowUIMessage> = {
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
      events.push(event);
    },
    stream: createEmptyStream(),
    dispatch: createDispatch,
    checkpoint: async () => undefined,
    pause(value) {
      return value;
    },
    getHierarchy() {
      return createWorkflowHierarchy("test-workflow", "run_1");
    },
  };

  return {
    context,
    events,
  };
}

describe("createAgent", () => {
  it("emits lifecycle and ui chunk events", async () => {
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
    const { context, events } = createContext(state, messages);

    const mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: convertArrayToReadableStream([
          { type: "text-start" as const, id: "text_1" },
          { type: "text-delta" as const, id: "text_1", delta: "Hello there" },
          { type: "text-end" as const, id: "text_1" },
          {
            type: "finish" as const,
            finishReason: { unified: "stop" as const, raw: "stop" },
            usage: {
              inputTokens: {
                total: 10,
                noCache: 10,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 4, text: 4, reasoning: 0 },
            },
          },
        ]),
      }),
    });

    const wrapped = createAgent({
      name: "assistant",
      model: mockModel,
    });

    const result = await wrapped.run(messages, context);

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);

    expect(events.map((e) => e.type)).toEqual([
      "agent-start",
      "ui-message-chunk",
      "ui-message-chunk",
      "ui-message-chunk",
      "ui-message-chunk",
      "ui-message-chunk",
      "agent-end",
    ]);
    expect(
      events
        .filter((e) => e.type === "ui-message-chunk")
        .map((e) => e.data.chunk.type),
    ).toEqual([
      "start-step",
      "text-start",
      "text-delta",
      "text-end",
      "finish-step",
    ]);

    expect(result.usage).toEqual({
      finishReason: "stop",
      model: "mock-model-id",
      rawFinishReason: "stop",
      totalUsage: {
        cachedInputTokens: 0,
        inputTokenDetails: {
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          noCacheTokens: 10,
        },
        inputTokens: 10,
        outputTokenDetails: {
          reasoningTokens: 0,
          textTokens: 4,
        },
        outputTokens: 4,
        reasoningTokens: 0,
        totalTokens: 14,
      },
    });
  });

  it("scopes tool lifecycle events to the agent hierarchy during tool loops", async () => {
    const state = {
      toolCalls: 0,
    };
    const messages: WorkflowUIMessage[] = [
      {
        id: "msg_1",
        role: "user",
        parts: [
          {
            type: "text",
            text: "Use the tool and then answer",
          },
        ],
      },
    ];
    const { context, events } = createContext(state, messages);

    const lookupTool = createWorkflowTool<
      { topic: string },
      { note: string },
      { toolCalls: number }
    >({
      name: "lookup_fact",
      inputSchema: z.object({
        topic: z.string(),
      }),
      execute: async (input, _options, runtimeContext) => {
        runtimeContext.state.toolCalls += 1;
        return {
          note: `fact:${input.topic}`,
        };
      },
    });

    let streamCallCount = 0;
    const mockModel = new MockLanguageModelV3({
      doStream: async () => {
        streamCallCount += 1;

        return streamCallCount === 1
          ? {
            stream: convertArrayToReadableStream([
              {
                type: "tool-call" as const,
                toolCallId: "call_1",
                toolName: "lookup_fact",
                input: JSON.stringify({
                  topic: "weather",
                }),
              },
              {
                type: "finish" as const,
                finishReason: {
                  unified: "tool-calls" as const,
                  raw: "tool-calls",
                },
                usage: {
                  inputTokens: {
                    total: 4,
                    noCache: 4,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: {
                    total: 2,
                    text: 0,
                    reasoning: 0,
                  },
                },
              },
            ]),
          }
          : {
            stream: convertArrayToReadableStream([
              { type: "text-start" as const, id: "text_1" },
              {
                type: "text-delta" as const,
                id: "text_1",
                delta: "Done",
              },
              { type: "text-end" as const, id: "text_1" },
              {
                type: "finish" as const,
                finishReason: {
                  unified: "stop" as const,
                  raw: "stop",
                },
                usage: {
                  inputTokens: {
                    total: 5,
                    noCache: 5,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: {
                    total: 3,
                    text: 3,
                    reasoning: 0,
                  },
                },
              },
            ]),
          };
      },
    });

    const wrapped = createAgent<{ toolCalls: number }>({
      name: "assistant",
      model: mockModel,
      tools: [lookupTool],
    });

    const result = await wrapped.run(messages, context);
    await result.streamResult.consumeStream();

    const agentStartEvent = events.find(
      (event) => event.type === "agent-start",
    );
    const toolStartEvent = events.find((event) => event.type === "tool-start");
    const toolEndEvent = events.find((event) => event.type === "tool-end");
    const toolStartIndex = events.findIndex(
      (event) => event.type === "tool-start",
    );
    const toolOutputChunkIndex = events.findIndex(
      (event) =>
        event.type === "ui-message-chunk" &&
        event.data.chunk.type === "tool-output-available",
    );
    const toolEndIndex = events.findIndex((event) => event.type === "tool-end");

    expect(result.success).toBe(true);
    expect(state.toolCalls).toBe(1);
    expect(events.map((event) => event.type)).toEqual([
      "agent-start",
      "tool-start",
      "ui-message-chunk",
      "ui-message-chunk",
      "ui-message-chunk",
      "tool-end",
      "ui-message-chunk",
      "ui-message-chunk",
      "ui-message-chunk",
      "ui-message-chunk",
      "ui-message-chunk",
      "ui-message-chunk",
      "agent-end",
    ]);
    expect(
      events
        .filter((event) => event.type === "ui-message-chunk")
        .map((event) => event.data.chunk.type),
    ).toEqual([
      "start-step",
      "tool-input-available",
      "tool-output-available",
      "finish-step",
      "start-step",
      "text-start",
      "text-delta",
      "text-end",
      "finish-step",
    ]);
    expect(toolStartIndex).toBeLessThan(toolOutputChunkIndex);
    expect(toolOutputChunkIndex).toBeLessThan(toolEndIndex);
    expect(toolStartEvent?.data.hierarchy.agentName).toBe("assistant");
    expect(toolEndEvent?.data.hierarchy.agentName).toBe("assistant");
    expect(toolStartEvent?.data.hierarchy.agentRunId).toBe(
      agentStartEvent?.data.agentRunId,
    );
    expect(toolEndEvent?.data.hierarchy.agentRunId).toBe(
      agentStartEvent?.data.agentRunId,
    );
  });

  it("returns a failure result and emits a failed agent-end event when streaming throws", async () => {
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
    const { context, events } = createContext({ turnCount: 1 }, messages);

    const mockModel = new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: "text-start" as const,
              id: "text_1",
            });
            controller.error(new Error("chunk failure"));
          },
        }),
      }),
    });

    const wrapped = createAgent({
      name: "assistant",
      model: mockModel,
    });

    const result = await wrapped.run(messages, context);

    expect(result.error).toBe("chunk failure");
    expect(result.success).toBe(false);

    expect(events.map((e) => e.type)).toEqual(["agent-start", "agent-end"]);
  });
});

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type {
  RuntimeContext,
  WorkflowDispatchOperation,
  WorkflowDispatchStream,
  WorkflowStreamEvent,
  WorkflowUIMessage,
} from "../index";
import { createWorkflowHierarchy, createWorkflowTool } from "../index";

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

function createContext<TState extends Record<string, unknown>>(state: TState) {
  const emitted: WorkflowStreamEvent<WorkflowUIMessage>[] = [];
  const context: RuntimeContext<TState, WorkflowUIMessage> = {
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
      emitted.push(event);
    },
    dispatch: createDispatch,
    checkpoint: async () => undefined,
    getHierarchy() {
      return createWorkflowHierarchy("test-workflow", "run_1");
    },
  };

  return {
    context,
    emitted,
  };
}

describe("createWorkflowTool", () => {
  it("emits tool lifecycle events and can update workflow state", async () => {
    const state = {
      calls: 0,
    };
    const { context, emitted } = createContext(state);

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

    const toolEndEvent = emitted.find((e) => e.type === "tool-end");

    expect(result).toBe(5);
    expect(emitted.map((e) => e.type)).toEqual(["tool-start", "tool-end"]);
    expect(toolEndEvent?.data.success).toBe(true);
    expect(state.calls).toBe(1);
  });

  it("emits a failed tool-end event when execution throws", async () => {
    const { context, emitted } = createContext({
      calls: 0,
    });
    const factory = createWorkflowTool<
      { a: number },
      number,
      { calls: number }
    >({
      name: "explode",
      inputSchema: z.object({
        a: z.number(),
      }),
      execute: async () => {
        throw new Error("boom");
      },
    });
    const tool = factory(context);

    await tool.onInputStart?.({
      toolCallId: "call_1",
      messages: [],
      abortSignal: undefined,
    });

    expect(
      tool.execute?.(
        {
          a: 1,
        },
        {
          toolCallId: "call_1",
          messages: [],
          abortSignal: undefined,
        },
      ),
    ).rejects.toThrow("boom");

    const toolEndEvent = emitted.find((e) => e.type === "tool-end");

    expect(emitted.map((e) => e.type)).toEqual(["tool-start", "tool-end"]);
    expect(toolEndEvent?.data.success).toBe(false);
  });

  it("emits tool-start from onInputAvailable exactly once before execution", async () => {
    const state = {
      calls: 0,
    };
    const { context, emitted } = createContext(state);

    const factory = createWorkflowTool<
      { city: string },
      { forecast: string },
      { calls: number }
    >({
      name: "lookup_weather",
      inputSchema: z.object({
        city: z.string(),
      }),
      execute: async (input, _options, runtimeContext) => {
        runtimeContext.state.calls += 1;
        return {
          forecast: `Sunny in ${input.city}`,
        };
      },
    });

    const tool = factory(context);
    await tool.onInputAvailable?.({
      input: {
        city: "Boston",
      },
      toolCallId: "call_1",
      messages: [],
      abortSignal: undefined,
    });

    const result = await tool.execute?.(
      {
        city: "Boston",
      },
      {
        toolCallId: "call_1",
        messages: [],
        abortSignal: undefined,
      },
    );

    expect(result).toEqual({
      forecast: "Sunny in Boston",
    });
    expect(emitted.map((event) => event.type)).toEqual([
      "tool-start",
      "tool-end",
    ]);
    expect(state.calls).toBe(1);
  });

  it("creates tools without execute handlers", async () => {
    const { context, emitted } = createContext({
      calls: 0,
    });
    const factory = createWorkflowTool<
      { city: string },
      never,
      { calls: number }
    >({
      name: "lookup",
      inputSchema: z.object({
        city: z.string(),
      }),
      description: "Looks up a city",
    });
    const tool = factory(context);

    expect(tool.execute).toBeUndefined();

    await tool.onInputStart?.({
      toolCallId: "call_1",
      messages: [],
      abortSignal: undefined,
    });

    expect(emitted.map((e) => e.type)).toEqual(["tool-start"]);
  });
});

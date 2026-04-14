import type {
  Agent,
  AsyncIterableStream,
  FinishReason,
  InferUIMessageChunk,
  LanguageModelResponseMetadata,
  LanguageModelUsage,
  StreamTextResult,
  TextStreamPart,
  ToolSet,
  UIMessage,
  UIMessageStreamOptions,
} from "ai";

type FakeStreamOptions<UI_MESSAGE extends UIMessage> = {
  chunks: InferUIMessageChunk<UI_MESSAGE>[];
  text?: string;
  usage?: LanguageModelUsage;
  response?: LanguageModelResponseMetadata;
  finishReason?: FinishReason;
};

function createAsyncIterableStream<T>(
  values: T[] = [],
): AsyncIterableStream<T> {
  const stream = new ReadableStream<T>({
    start(controller) {
      for (const value of values) {
        controller.enqueue(value);
      }

      controller.close();
    },
  });

  return Object.assign(stream, {
    async *[Symbol.asyncIterator]() {
      const reader = stream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            return;
          }

          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  });
}

export function createFakeAgent<
  UI_MESSAGE extends UIMessage,
  TOOLS extends ToolSet = Record<string, never>,
>(options: FakeStreamOptions<UI_MESSAGE>): Agent<never, TOOLS> {
  return {
    version: "agent-v1",
    id: "fake-agent",
    tools: {} as TOOLS,
    async generate() {
      throw new Error("Not implemented in fake agent.");
    },
    async stream(): Promise<StreamTextResult<TOOLS, never>> {
      const uiStream = createAsyncIterableStream(options.chunks);
      const emptyTextStream = createAsyncIterableStream<string>();
      const emptyFullStream =
        createAsyncIterableStream<TextStreamPart<TOOLS>>();
      const emptyOutputStream = createAsyncIterableStream<never>();
      const usage: LanguageModelUsage = options.usage ?? {
        inputTokens: undefined,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokens: undefined,
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
        totalTokens: undefined,
      };
      const response = {
        ...(options.response ?? {
          id: "response_1",
          modelId: "fake-model",
          timestamp: new Date(),
        }),
        messages: [],
      } satisfies Awaited<StreamTextResult<TOOLS, never>["response"]>;
      const output = Promise.reject(new Error("No output."));
      output.catch(() => undefined);

      const streamResult: StreamTextResult<TOOLS, never> = {
        warnings: Promise.resolve([]),
        request: Promise.resolve({}),
        response: Promise.resolve(response),
        toolCalls: Promise.resolve([]),
        staticToolCalls: Promise.resolve([]),
        dynamicToolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([]),
        staticToolResults: Promise.resolve([]),
        dynamicToolResults: Promise.resolve([]),
        finishReason: Promise.resolve(options.finishReason ?? "stop"),
        rawFinishReason: Promise.resolve(undefined),
        usage: Promise.resolve(usage),
        totalUsage: Promise.resolve(usage),
        steps: Promise.resolve([]),
        text: Promise.resolve(options.text ?? ""),
        sources: Promise.resolve([]),
        files: Promise.resolve([]),
        reasoning: Promise.resolve([]),
        reasoningText: Promise.resolve(""),
        providerMetadata: Promise.resolve(undefined),
        content: Promise.resolve([]),
        textStream: emptyTextStream,
        fullStream: emptyFullStream,
        experimental_partialOutputStream: emptyOutputStream,
        partialOutputStream: emptyOutputStream,
        elementStream: emptyOutputStream,
        output,
        toUIMessageStream<STREAM_MESSAGE extends UIMessage>(
          _options?: UIMessageStreamOptions<STREAM_MESSAGE>,
        ) {
          return uiStream as AsyncIterableStream<
            InferUIMessageChunk<STREAM_MESSAGE>
          >;
        },
        consumeStream: async () => undefined,
        pipeUIMessageStreamToResponse() {
          throw new Error("Not implemented in fake agent.");
        },
        pipeTextStreamToResponse() {
          throw new Error("Not implemented in fake agent.");
        },
        toUIMessageStreamResponse() {
          throw new Error("Not implemented in fake agent.");
        },
        toTextStreamResponse() {
          throw new Error("Not implemented in fake agent.");
        },
      };

      return streamResult;
    },
  };
}

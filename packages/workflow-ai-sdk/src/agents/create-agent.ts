import {
  type Agent,
  type AgentStreamParameters,
  convertToModelMessages,
  type InferUITools,
  type LanguageModelResponseMetadata,
  type LanguageModelUsage,
  type StreamTextResult,
  ToolLoopAgent,
  type ToolLoopAgentSettings,
  type ToolSet,
  validateUIMessages,
} from "ai";
import {
  createAgentEndEvent,
  createAgentStartEvent,
  extendHierarchyWithAgent,
} from "../runtime/events";
import type {
  AgentUsageEntry,
  RuntimeContext,
  WorkflowUIMessage,
} from "../runtime/types";
import type { WorkflowTool } from "../tools/create-workflow-tool";

type WorkflowToolList<
  TState extends Record<string, unknown>,
  TMessage extends WorkflowUIMessage,
> = readonly WorkflowTool<any, any, TState, TMessage>[];

type ToolSetFromWorkflowTools<TOOLS extends WorkflowToolList<any, any>> = {
  [INDEX in keyof TOOLS as TOOLS[INDEX] extends WorkflowTool<
    infer _TInput,
    infer _TOutput,
    infer _TState,
    infer _TMessage
  >
  ? ReturnType<TOOLS[INDEX]>["name"]
  : never]: TOOLS[INDEX] extends WorkflowTool<
    infer TInput,
    infer TOutput,
    infer _TState,
    infer _TMessage
  >
  ? ReturnType<TOOLS[INDEX]> & {
    execute?: (
      input: TInput,
      options: Parameters<
        NonNullable<ReturnType<TOOLS[INDEX]>["execute"]>
      >[1],
    ) => Promise<TOutput> | TOutput;
  }
  : never;
};

export interface WorkflowWrappedAgentResult<TOOLS extends ToolSet = ToolSet> {
  success: boolean;
  error?: string;
  streamResult: StreamTextResult<TOOLS, never>;
  usage?: AgentUsageEntry;
}

export interface CreateAgentConfig<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMessage extends WorkflowUIMessage = WorkflowUIMessage,
  CALL_OPTIONS = never,
  TOOLS extends WorkflowToolList<TState, TMessage> = WorkflowToolList<
    TState,
    TMessage
  >,
  TOOL_SET extends ToolSet = ToolSetFromWorkflowTools<TOOLS>,
> extends Omit<ToolLoopAgentSettings<CALL_OPTIONS, TOOL_SET>, "tools" | "id"> {
  name: string;
  description?: string;
  tools?: TOOLS;
  agent?: Agent<CALL_OPTIONS, TOOL_SET>;
}

export interface WorkflowWrappedAgent<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMessage extends WorkflowUIMessage = WorkflowUIMessage,
  CALL_OPTIONS = never,
  TOOL_SET extends ToolSet = ToolSet,
> {
  name: string;
  description?: string;
  run: (
    messages: TMessage[],
    context: RuntimeContext<TState, TMessage>,
    options?: AgentStreamParameters<CALL_OPTIONS, TOOL_SET>,
  ) => Promise<WorkflowWrappedAgentResult<TOOL_SET>>;
}

function createUsageEntry(args: {
  agentName: string;
  agentRunId: string;
  durationMs: number;
  success: boolean;
  totalUsage?: LanguageModelUsage;
  response?: LanguageModelResponseMetadata;
  finishReason?: string | null;
}): AgentUsageEntry {
  return {
    agentName: args.agentName,
    agentRunId: args.agentRunId,
    model: args.response?.modelId,
    promptTokens: args.totalUsage?.inputTokens,
    completionTokens: args.totalUsage?.outputTokens,
    totalTokens: args.totalUsage?.totalTokens,
    finishReason: args.finishReason ?? undefined,
    durationMs: args.durationMs,
    success: args.success,
  };
}

export function createAgent<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMessage extends WorkflowUIMessage = WorkflowUIMessage,
  CALL_OPTIONS = never,
  TOOLS extends WorkflowToolList<TState, TMessage> = WorkflowToolList<
    TState,
    TMessage
  >,
  TOOL_SET extends ToolSet = ToolSetFromWorkflowTools<TOOLS>,
>(
  config: CreateAgentConfig<TState, TMessage, CALL_OPTIONS, TOOLS, TOOL_SET>,
): WorkflowWrappedAgent<TState, TMessage, CALL_OPTIONS, TOOL_SET> {
  return {
    name: config.name,
    description: config.description,
    async run(messages, context, options) {
      const agentRunId = crypto.randomUUID();
      const startedAt = Date.now();
      const hierarchy = extendHierarchyWithAgent(
        context.getHierarchy(),
        config.name,
        agentRunId,
      );

      const tools = (config.tools?.reduce((acc, factory) => {
        const instance = factory(context);
        acc[instance.name] = instance;
        return acc;
      }, {} as ToolSet) ?? {}) as TOOL_SET;

      const agent =
        config.agent ??
        new ToolLoopAgent<CALL_OPTIONS, TOOL_SET>({
          ...config,
          id: config.name,
          tools,
        });

      context.emit(
        createAgentStartEvent({
          agentName: config.name,
          agentRunId,
          hierarchy,
        }),
      );

      const validatedMessages = await validateUIMessages<
        WorkflowUIMessage<InferUITools<TOOL_SET>>
      >({
        messages,
        tools: agent.tools,
      });

      const modelMessages = await convertToModelMessages(validatedMessages, {
        tools: agent.tools,
      });

      const streamResult = await agent.stream({
        prompt: modelMessages,
        ...(options ?? {}),
      });

      let usage: AgentUsageEntry | undefined;

      try {
        for await (const chunk of streamResult.toUIMessageStream<
          WorkflowUIMessage<InferUITools<TOOL_SET>>
        >({
          originalMessages: validatedMessages,
          sendStart: false,
          sendFinish: false,
          sendReasoning: true,
          sendSources: true,
        })) {
          context.emit({
            type: "ui-message-chunk",
            data: {
              chunk,
              hierarchy,
            },
          });
        }

        await streamResult.consumeStream();

        usage = createUsageEntry({
          agentName: config.name,
          agentRunId,
          durationMs: Date.now() - startedAt,
          success: true,
          totalUsage: await streamResult.totalUsage,
          response: await streamResult.response,
          finishReason: await streamResult.finishReason,
        });

        context.emit(
          createAgentEndEvent({
            agentName: config.name,
            agentRunId,
            success: true,
            durationMs: Date.now() - startedAt,
            usage,
            hierarchy,
          }),
        );

        return {
          success: true,
          streamResult,
          usage,
        };
      } catch (error) {
        usage = createUsageEntry({
          agentName: config.name,
          agentRunId,
          durationMs: Date.now() - startedAt,
          success: false,
        });

        context.emit(
          createAgentEndEvent({
            agentName: config.name,
            agentRunId,
            success: false,
            durationMs: Date.now() - startedAt,
            usage,
            hierarchy,
          }),
        );

        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          streamResult,
          usage,
        };
      }
    },
  };
}

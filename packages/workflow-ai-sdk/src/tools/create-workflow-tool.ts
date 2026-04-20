import { type Tool, type ToolExecutionOptions, tool } from "ai";

import {
  createToolEndStreamEvent,
  createToolStartStreamEvent,
  extendHierarchyWithTool,
} from "../runtime/create-stream-event";
import type { RuntimeContext, WorkflowUIMessage } from "../runtime/types";

type MaybePromise<T> = Promise<T> | T;
type ToolInputAvailableOptions<TInput, TOutput> = Parameters<
  NonNullable<Tool<TInput, TOutput>["onInputAvailable"]>
>[0];

export type WorkflowTool<
  TInput = unknown,
  TOutput = unknown,
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMessage extends WorkflowUIMessage = WorkflowUIMessage,
> = (context: RuntimeContext<TState, TMessage>) => Tool<TInput, TOutput> & {
  name: string;
};

export type WorkflowToolConfig<
  TInput,
  TOutput,
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMessage extends WorkflowUIMessage = WorkflowUIMessage,
> = Omit<Tool<TInput, TOutput>, "execute"> & {
  name: string;
  execute?: (
    input: TInput,
    options: ToolExecutionOptions,
    context: RuntimeContext<TState, TMessage>,
  ) => MaybePromise<TOutput>;
};

export function createWorkflowTool<
  TInput,
  TOutput,
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMessage extends WorkflowUIMessage = WorkflowUIMessage,
>(
  config: WorkflowToolConfig<TInput, TOutput, TState, TMessage>,
): WorkflowTool<TInput, TOutput, TState, TMessage> {
  return (context) => {
    const startedAtByCallId = new Map<string, number>();
    const {
      name: _name,
      execute: executeWithContext,
      onInputAvailable,
      onInputStart,
      ...toolConfig
    } = config;

    const emitToolStart = (toolCallId: string) => {
      if (!startedAtByCallId.has(toolCallId)) {
        startedAtByCallId.set(toolCallId, Date.now());

        context.emit(
          createToolStartStreamEvent({
            toolName: config.name,
            toolCallId,
            hierarchy: extendHierarchyWithTool(
              context.getHierarchy(),
              config.name,
              toolCallId,
            ),
          }),
        );
      }
    };

    const emitToolEnd = (toolCallId: string, success: boolean) => {
      const startedAt = startedAtByCallId.get(toolCallId) ?? Date.now();
      startedAtByCallId.delete(toolCallId);

      context.emit(
        createToolEndStreamEvent({
          toolName: config.name,
          toolCallId,
          success,
          durationMs: Date.now() - startedAt,
          hierarchy: extendHierarchyWithTool(
            context.getHierarchy(),
            config.name,
            toolCallId,
          ),
        }),
      );
    };

    const baseTool = {
      ...toolConfig,
      onInputAvailable: async (
        args: ToolInputAvailableOptions<TInput, TOutput>,
      ) => {
        emitToolStart(args.toolCallId);
        await onInputAvailable?.(args);
      },
      onInputStart: async (args: ToolExecutionOptions) => {
        emitToolStart(args.toolCallId);
        await onInputStart?.(args);
      },
    };

    const wrappedTool = executeWithContext
      ? tool({
        ...baseTool,
        execute: async (input: TInput, options: ToolExecutionOptions) => {
          emitToolStart(options.toolCallId);

          try {
            const result = await executeWithContext(input, options, context);

            emitToolEnd(options.toolCallId, true);

            return result;
          } catch (error) {
            emitToolEnd(options.toolCallId, false);

            throw error;
          }
        },
      } as Tool<TInput, TOutput>)
      : tool(baseTool as Tool<TInput, TOutput>);

    return Object.assign(wrappedTool, {
      name: config.name,
      description: config.description,
      title: config.title,
    });
  };
}

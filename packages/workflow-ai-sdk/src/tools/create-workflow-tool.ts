import { type Tool, type ToolExecutionOptions, tool } from "ai";

import {
  createToolEndStreamEvent,
  createToolStartStreamEvent,
  extendHierarchyWithTool,
} from "../runtime/create-stream-event";
import type { RuntimeContext, WorkflowUIMessage } from "../runtime/types";

type MaybePromise<T> = Promise<T> | T;

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
    let startedAt = 0;
    const {
      name: _name,
      execute: executeWithContext,
      onInputStart,
      ...toolConfig
    } = config;

    const baseTool = {
      ...toolConfig,
      onInputStart: async (args: ToolExecutionOptions) => {
        startedAt = Date.now();

        context.emit(
          createToolStartStreamEvent({
            toolName: config.name,
            toolCallId: args.toolCallId,
            hierarchy: extendHierarchyWithTool(
              context.getHierarchy(),
              config.name,
              args.toolCallId,
            ),
          }),
        );

        await onInputStart?.(args);
      },
    };

    const wrappedTool = executeWithContext
      ? tool({
        ...baseTool,
        execute: async (input: TInput, options: ToolExecutionOptions) => {
          const hierarchy = extendHierarchyWithTool(
            context.getHierarchy(),
            config.name,
            options.toolCallId,
          );

          try {
            const result = await executeWithContext(input, options, context);

            context.emit(
              createToolEndStreamEvent({
                toolName: config.name,
                toolCallId: options.toolCallId,
                success: true,
                durationMs: Date.now() - startedAt,
                hierarchy,
              }),
            );

            return result;
          } catch (error) {
            context.emit(
              createToolEndStreamEvent({
                toolName: config.name,
                toolCallId: options.toolCallId,
                success: false,
                durationMs: Date.now() - startedAt,
                hierarchy,
              }),
            );

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

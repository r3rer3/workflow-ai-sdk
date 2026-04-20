import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type InferUIMessageChunk,
} from "ai";

import type {
  WorkflowDataParts,
  WorkflowExecution,
  WorkflowUIMessage,
} from "../runtime/types";

export interface ToUIMessageStreamOptions<TMessage extends WorkflowUIMessage> {
  clientFilter?: (chunk: InferUIMessageChunk<TMessage>) => boolean;
}

type WorkflowDataPartName = keyof WorkflowDataParts & string;

type WorkflowDataChunk<
  TName extends WorkflowDataPartName,
  TMessage extends WorkflowUIMessage,
> = Extract<InferUIMessageChunk<TMessage>, { type: `data-${TName}` }>;

function createWorkflowDataChunk<
  TName extends WorkflowDataPartName,
  TMessage extends WorkflowUIMessage,
>(
  name: TName,
  data: WorkflowDataParts[TName],
): WorkflowDataChunk<TName, TMessage> {
  return {
    type: `data-${name}`,
    data,
  } as WorkflowDataChunk<TName, TMessage>;
}

export class WorkflowUIStream<
  TMessage extends WorkflowUIMessage = WorkflowUIMessage,
> {
  readonly runId: string;
  readonly stream: ReadableStream<InferUIMessageChunk<TMessage>>;

  constructor(
    execution: WorkflowExecution<TMessage>,
    options?: ToUIMessageStreamOptions<TMessage>,
  ) {
    this.runId = execution.runId;

    this.stream = createUIMessageStream({
      originalMessages: execution.messages,
      execute: async ({ writer }) => {
        const reader = execution.stream.getReader();

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          switch (value.type) {
            case "ui-message-chunk":
              if (
                options?.clientFilter &&
                !options.clientFilter(value.data.chunk)
              ) {
                break;
              }

              writer.write(value.data.chunk);
              break;
            default:
              if (value.type === "workflow-start") {
                writer.write({
                  type: "start",
                });
              }

              writer.write(createWorkflowDataChunk(value.type, value.data));
          }
        }
      },
    });
  }

  toResponse(init?: ResponseInit): Response {
    return createUIMessageStreamResponse({
      stream: this.stream,
      ...init,
    });
  }
}

export async function toUIMessageStream<
  TMessage extends WorkflowUIMessage = WorkflowUIMessage,
>(
  execution: WorkflowExecution<TMessage> | Promise<WorkflowExecution<TMessage>>,
  options?: ToUIMessageStreamOptions<TMessage>,
): Promise<WorkflowUIStream<TMessage>> {
  return new WorkflowUIStream(await execution, options);
}

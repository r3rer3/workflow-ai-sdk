import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

import type {
  WorkflowDataParts,
  WorkflowExecution,
  WorkflowUIChunk,
  WorkflowUIMessage,
} from "../runtime/types";

export interface ToUIMessageStreamOptions {
  clientFilter?: (chunk: WorkflowUIChunk) => boolean;
}

type WorkflowDataPartName = keyof WorkflowDataParts & string;

type WorkflowDataChunk<TName extends WorkflowDataPartName> = Extract<
  WorkflowUIChunk,
  { type: `data-${TName}` }
>;

function createWorkflowDataChunk<TName extends WorkflowDataPartName>(
  name: TName,
  data: WorkflowDataParts[TName],
): WorkflowDataChunk<TName> {
  return {
    type: `data-${name}` as `data-${TName}`,
    data,
  } as WorkflowDataChunk<TName>;
}

export class WorkflowUIStream {
  readonly runId: string;
  readonly stream: ReadableStream<WorkflowUIChunk>;

  constructor(
    execution: WorkflowExecution<any>,
    options?: ToUIMessageStreamOptions,
  ) {
    this.runId = execution.runId;

    this.stream = createUIMessageStream<WorkflowUIMessage>({
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

export async function toUIMessageStream(
  execution: WorkflowExecution<any> | Promise<WorkflowExecution<any>>,
  options?: ToUIMessageStreamOptions,
): Promise<WorkflowUIStream> {
  return new WorkflowUIStream(await execution, options);
}

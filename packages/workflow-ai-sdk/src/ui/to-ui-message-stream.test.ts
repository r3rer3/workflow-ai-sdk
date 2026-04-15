import { describe, expect, it } from "bun:test";
import type { WorkflowExecution, WorkflowUIMessage } from "../index";
import { toUIMessageStream } from "../index";

async function collect<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const values: T[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    values.push(value);
  }

  return values;
}

describe("toUIMessageStream", () => {
  it("maps workflow events into AI SDK data chunks", async () => {
    const execution: WorkflowExecution<WorkflowUIMessage> = {
      workflowName: "demo",
      runId: "run_1",
      threadId: "thread_1",
      resourceId: "resource_1",
      mode: "abortable",
      messages: [],
      cancel() { },
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "workflow-start",
            data: {
              workflowName: "demo",
              runId: "run_1",
              threadId: "thread_1",
              resourceId: "resource_1",
              mode: "abortable",
              resumed: false,
              hierarchy: {
                workflowName: "demo",
                workflowRunId: "run_1",
              },
            },
          });
          controller.enqueue({
            type: "custom-event",
            data: {
              name: "progress",
              data: {
                value: 1,
              },
              hierarchy: {
                workflowName: "demo",
                workflowRunId: "run_1",
              },
            },
          });
          controller.enqueue({
            type: "ui-message-chunk",
            data: {
              chunk: {
                type: "text-start",
                id: "text_1",
              },
              hierarchy: {
                workflowName: "demo",
                workflowRunId: "run_1",
              },
            },
          });
          controller.close();
        },
      }),
    };

    const uiStream = await toUIMessageStream(execution);
    const chunks = await collect(uiStream.stream);

    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "data-workflow-start",
      "data-custom-event",
      "text-start",
    ]);
  });
});

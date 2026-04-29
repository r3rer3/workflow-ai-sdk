import { describe, expect, it } from "bun:test";
import type {
  WorkflowCustomEvent,
  WorkflowDataParts,
  WorkflowExecution,
  WorkflowMessageMetadata,
  WorkflowUIMessage,
} from "../index";
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
    type ProgressEvent = WorkflowCustomEvent<"progress", { value: number }>;
    type TestMessage = WorkflowUIMessage<
      WorkflowMessageMetadata,
      WorkflowDataParts<ProgressEvent>
    >;

    const execution: WorkflowExecution<TestMessage> = {
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

    expect(chunks).toHaveLength(4);
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "start",
      "data-workflow-start",
      "data-custom-event",
      "text-start",
    ]);

    const customEventChunk = chunks[2];
    expect(customEventChunk).toBeDefined();
    if (!customEventChunk || customEventChunk.type !== "data-custom-event") {
      throw new Error("Expected data-custom-event chunk.");
    }

    const progressValue = customEventChunk.data.data.value;
    expect(progressValue).toBe(1);
    expect(customEventChunk.data.name).toBe("progress");
  });

  it("filters ui chunks and accepts promised executions", async () => {
    const execution: WorkflowExecution<WorkflowUIMessage> = {
      workflowName: "demo",
      runId: "run_2",
      threadId: "thread_2",
      resourceId: "resource_2",
      mode: "abortable",
      messages: [],
      cancel() { },
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "workflow-start",
            data: {
              workflowName: "demo",
              runId: "run_2",
              threadId: "thread_2",
              resourceId: "resource_2",
              mode: "abortable",
              resumed: false,
              hierarchy: {
                workflowName: "demo",
                workflowRunId: "run_2",
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
                workflowRunId: "run_2",
              },
            },
          });
          controller.close();
        },
      }),
    };

    const uiStream = await toUIMessageStream(Promise.resolve(execution), {
      clientFilter(chunk) {
        return chunk.type !== "text-start";
      },
    });
    const chunks = await collect(uiStream.stream);

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "start",
      "data-workflow-start",
    ]);
  });
});

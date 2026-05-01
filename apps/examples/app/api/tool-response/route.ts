import { openai } from "@ai-sdk/openai";
import {
  createAgent,
  createToolEndStreamEvent,
  createToolStartStreamEvent,
  defineWorkflow,
  extendHierarchyWithTool,
  type RuntimeContext,
  toUIMessageStream,
  type WorkflowUIMessage,
  workflowEvent,
} from "workflow-ai-sdk";
import { z } from "zod";
import { lookupWeatherOffline, lookupWeatherTool } from "@/lib/tools";
import { lastUserText } from "../../../lib/chat-helpers";

// Demonstrates a workflow step that calls a tool, receives a structured
// response, and summarizes it as text. When OPENAI_API_KEY is set, the real
// agent drives the tool call. When it is missing, the step emits the tool
// lifecycle events manually so the example still runs offline.

const startEvent = workflowEvent("tool-response.start");
const endEvent = workflowEvent(
  "tool-response.end",
  z.object({
    summary: z.string(),
  }),
);

const weatherAgent = createAgent({
  name: "weather-assistant",
  model: openai("gpt-4.1-mini"),
  instructions:
    "Call the lookup_weather tool for the requested city and summarize the result in one short sentence.",
  tools: [lookupWeatherTool],
});

function emitTextChunks(
  context: RuntimeContext<Record<string, unknown>, WorkflowUIMessage>,
  text: string,
) {
  const textId = crypto.randomUUID();
  context.emit({
    type: "ui-message-chunk",
    data: {
      chunk: { type: "text-start", id: textId },
      hierarchy: context.getHierarchy(),
    },
  });
  context.emit({
    type: "ui-message-chunk",
    data: {
      chunk: { type: "text-delta", id: textId, delta: text },
      hierarchy: context.getHierarchy(),
    },
  });
  context.emit({
    type: "ui-message-chunk",
    data: {
      chunk: { type: "text-end", id: textId },
      hierarchy: context.getHierarchy(),
    },
  });
}

type RequestBody = {
  messages?: WorkflowUIMessage[];
};

function createToolResponseWorkflow() {
  return defineWorkflow({
    name: "tool-response-workflow",
    trigger: startEvent,
    finish: endEvent,
    initialState() {
      return {};
    },
  }).step(startEvent, async (context) => {
    if (process.env.OPENAI_API_KEY) {
      const result = await weatherAgent.run(context.messages, context);
      const reply = await result.streamResult.text;

      return endEvent.create({
        summary: reply,
      });
    }

    // Offline fallback: emit the tool lifecycle events manually and write a
    // deterministic summary so the example still produces a useful stream.
    const city = lastUserText(context.messages) || "Lisbon";

    const toolCallId = crypto.randomUUID();
    const toolHierarchy = extendHierarchyWithTool(
      context.getHierarchy(),
      "lookup_weather",
      toolCallId,
    );

    const startedAt = Date.now();
    context.emit(
      createToolStartStreamEvent({
        toolName: "lookup_weather",
        toolCallId,
        hierarchy: toolHierarchy,
      }),
    );

    const report = lookupWeatherOffline(city);

    context.emit(
      createToolEndStreamEvent({
        toolName: "lookup_weather",
        toolCallId,
        success: true,
        durationMs: Date.now() - startedAt,
        hierarchy: toolHierarchy,
      }),
    );

    const summary = `The weather in ${report.city} is ${report.condition} at ${report.temperatureC}°C.`;
    emitTextChunks(context, summary);

    return endEvent.create({
      summary,
    });
  });
}

export async function POST(request: Request) {
  const body: RequestBody = await request.json();
  const messages = body.messages || [];

  const execution = await createToolResponseWorkflow().run({
    messages,
    mode: "abortable",
  });

  const stream = await toUIMessageStream(execution);
  return stream.toResponse();
}

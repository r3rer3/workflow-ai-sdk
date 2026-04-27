import { openai } from "@ai-sdk/openai";
import { NextResponse } from "next/server";
import {
  createAgent,
  defineWorkflow,
  toUIMessageStream,
  type WorkflowUIMessage,
  workflowEvent,
} from "workflow-ai-sdk";
import { z } from "zod";

const startEvent = workflowEvent("chat.start");
const endEvent = workflowEvent(
  "chat.end",
  z.object({
    reply: z.string(),
  }),
);

type RequestBody = {
  messages?: WorkflowUIMessage[];
};

function createChatWorkflow() {
  const assistant = createAgent({
    name: "chat-assistant",
    model: openai("gpt-5-nano"),
    instructions:
      "Reply helpfully and concisely to the user's latest message, using the provided conversation history when it matters.",
  });

  return defineWorkflow({
    name: "example-chat-workflow",
    trigger: startEvent,
    finish: endEvent,
    initialState() {
      return {};
    },
  }).step(startEvent, async (context) => {
    const result = await assistant.run(context.messages, context);
    const reply = await result.streamResult.text;

    return endEvent.create({
      reply,
    });
  });
}

export async function handleRequest(request: Request): Promise<Response> {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        error: "Basic chat requires OPENAI_API_KEY.",
        hint: "Set OPENAI_API_KEY in apps/examples/.env.local to run the AI SDK-backed /api/chat example.",
      },
      { status: 503 },
    );
  }

  const body: RequestBody = await request.json();
  const messages = body.messages || [];

  const execution = await createChatWorkflow().run({
    messages,
    mode: "abortable",
  });

  const stream = await toUIMessageStream(execution);
  return stream.toResponse({
    headers: {
      "x-workflow-run-id": execution.runId,
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRequest(request);
}

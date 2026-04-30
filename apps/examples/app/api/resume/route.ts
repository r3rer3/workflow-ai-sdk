import {
  createCustomStreamEvent,
  createInMemoryWorkflowStore,
  defineWorkflow,
  type InMemoryWorkflowStore,
  pauseWorkflow,
  toUIMessageStream,
  workflowEvent,
} from "workflow-ai-sdk";
import { z } from "zod";
import type { ResumeWorkflowMessage } from "../../../lib/workflow-message-types";

// Demonstrates a resumable workflow. Step 1 runs some prep work, then pauses
// the workflow. The client inspects the stream, sees the pause, and issues a
// second POST with action: "resume" to continue with the approval decision.

interface ResumeState {
  topic: string;
  approved: boolean;
  [key: string]: unknown;
}

const startEvent = workflowEvent(
  "resume.start",
  z.object({
    topic: z.string(),
  }),
);
const approvalEvent = workflowEvent(
  "resume.approval",
  z.object({
    approved: z.boolean(),
  }),
);
const endEvent = workflowEvent(
  "resume.end",
  z.object({
    summary: z.string(),
  }),
);

const resumeWorkflow = defineWorkflow({
  name: "resume-example-workflow",
  trigger: startEvent,
  finish: endEvent,
  initialState({ input }) {
    return {
      topic: input.topic,
      approved: false,
    };
  },
})
  .step(startEvent, (context, event) => {
    context.state.topic = event.topic;

    context.emit(
      createCustomStreamEvent({
        name: "prep-complete",
        data: {
          topic: event.topic,
        },
        hierarchy: context.getHierarchy(),
      }),
    );

    return pauseWorkflow({
      reason: "awaiting-approval",
      payload: {
        topic: event.topic,
      },
    });
  })
  .step(approvalEvent, (context, event) => {
    context.state.approved = event.approved;

    const summary = event.approved
      ? `Approved: proceeding with "${context.state.topic}".`
      : `Denied: skipping "${context.state.topic}".`;

    const textId = crypto.randomUUID();

    // Simulate streaming; in a real app you would use an AI SDK Agent or `streamText`.
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
        chunk: { type: "text-delta", id: textId, delta: summary },
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

    return endEvent.create({
      summary,
    });
  });

// Module-level singleton: in a real app, this is where you would plug in the
// Supabase adapter. The in-memory store is kept alive between requests because
// Next.js holds the module in the same process.
const store: InMemoryWorkflowStore<ResumeState, ResumeWorkflowMessage> =
  createInMemoryWorkflowStore<ResumeState, ResumeWorkflowMessage>();

type StartBody = { action: "start"; topic?: string };
type ResumeBody = { action: "resume"; runId: string; approved: boolean };
type RequestBody = StartBody | ResumeBody;

export async function POST(request: Request) {
  const body = (await request.json()) as RequestBody;

  if (body.action === "start") {
    const execution = await resumeWorkflow.run({
      input: {
        topic: body.topic?.trim() || "unspecified",
      },
      mode: "resumable",
      store,
    });

    const stream = await toUIMessageStream(execution);
    return stream.toResponse();
  }

  if (body.action === "resume") {
    const execution = await resumeWorkflow.resume({
      runId: body.runId,
      store,
      event: approvalEvent.create({
        approved: body.approved,
      }),
    });

    const stream = await toUIMessageStream(execution);
    return stream.toResponse();
  }

  return new Response(
    JSON.stringify({
      error: "Unknown action. Expected 'start' or 'resume'.",
    }),
    {
      status: 400,
      headers: {
        "content-type": "application/json",
      },
    },
  );
}

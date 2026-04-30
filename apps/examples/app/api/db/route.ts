import { NextResponse } from "next/server";
import {
  createCustomStreamEvent,
  defineWorkflow,
  pauseWorkflow,
  toUIMessageStream,
  workflowEvent,
} from "workflow-ai-sdk";
import { z } from "zod";
import {
  getSupabaseServerClient,
  readSupabaseExampleEnv,
} from "../../../lib/supabase-server";
import { SupabaseExampleWorkflowStore } from "../../../lib/supabase-workflow-store";
import type { DbWorkflowMessage } from "../../../lib/workflow-message-types";

// Demonstrates persisting a resumable workflow run to Supabase under Row
// Level Security.
//
// The route:
//   1. Requires NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
//   2. Verifies the caller via supabase.auth.getUser() — this re-validates
//      the JWT on the server; getSession() alone only reads cookies.
//   3. Uses user.id as the workflow resourceId, so `auth.uid() = user_id`
//      policies naturally scope everything to the caller.
//   4. Accepts `{ action: "start", topic }` or
//      `{ action: "resume", runId, approved }`. The resume branch relies on
//      RLS: loadCheckpoint() returns null for another user's runId, which
//      we translate into a 404.

export interface DbState {
  topic: string;
  steps: number;
  approved: boolean;
  [key: string]: unknown;
}

const startEvent = workflowEvent(
  "db.start",
  z.object({
    topic: z.string(),
  }),
);
const approvalEvent = workflowEvent(
  "db.approval",
  z.object({
    approved: z.boolean(),
  }),
);
const endEvent = workflowEvent(
  "db.end",
  z.object({
    summary: z.string(),
  }),
);

const dbWorkflow = defineWorkflow({
  name: "db-example-workflow",
  trigger: startEvent,
  finish: endEvent,
  initialState({ input }): DbState {
    return {
      topic: input.topic,
      steps: 0,
      approved: false,
    };
  },
})
  .step(startEvent, (context, event) => {
    context.state.topic = event.topic;
    context.state.steps += 1;

    context.emit(
      createCustomStreamEvent({
        name: "persisting",
        data: {
          topic: event.topic,
          steps: context.state.steps,
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
      ? `Approved: persisted run for "${context.state.topic}".`
      : `Denied: discarded run for "${context.state.topic}".`;

    // Simulate an agent streaming
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

    return endEvent.create({ summary });
  });

type StartBody = { action: "start"; topic?: string };
type ResumeBody = { action: "resume"; runId: string; approved: boolean };
type RequestBody = StartBody | ResumeBody;

export async function handleRequest(request: Request): Promise<Response> {
  const env = readSupabaseExampleEnv();
  if (!env) {
    return NextResponse.json(
      {
        error: "Supabase example is not configured.",
        hint: "Copy apps/examples/.env.local.example to apps/examples/.env.local and set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
      },
      { status: 503 },
    );
  }

  const supabase = await getSupabaseServerClient(env);

  let userId: string;
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      return NextResponse.json(
        {
          error: "Invalid or expired Supabase session.",
        },
        { status: 401 },
      );
    }

    if (!user) {
      return NextResponse.json(
        {
          error: "Authentication required.",
        },
        { status: 401 },
      );
    }

    userId = user.id;
  } catch {
    return NextResponse.json(
      {
        error: "Invalid or expired Supabase session.",
      },
      { status: 401 },
    );
  }

  const body = (await request.json()) as RequestBody;

  const store = new SupabaseExampleWorkflowStore<DbState, DbWorkflowMessage>(
    supabase,
    userId,
  );

  if (body.action === "start") {
    const topic = body.topic?.trim() || "quick-persistence-demo";

    const execution = await dbWorkflow.run({
      input: { topic },
      mode: "resumable",
      resourceId: userId,
      store,
    });

    const stream = await toUIMessageStream(execution);
    return stream.toResponse();
  }

  if (body.action === "resume") {
    const { runId, approved } = body;

    if (typeof runId !== "string" || runId.length === 0) {
      return NextResponse.json(
        {
          error: "runId is required to resume a workflow.",
        },
        { status: 400 },
      );
    }

    // RLS-driven cross-user check: loadCheckpoint() returns null when the
    // row belongs to another user. We translate that to 404 so the caller
    // cannot distinguish between "no such run" and "someone else's run".
    const checkpoint = await store.loadCheckpoint(runId);
    if (!checkpoint) {
      return NextResponse.json(
        {
          error: "Run not found for this user.",
        },
        { status: 404 },
      );
    }

    const execution = await dbWorkflow.resume({
      runId,
      store,
      event: approvalEvent.create({
        approved: Boolean(approved),
      }),
    });

    const stream = await toUIMessageStream(execution);
    return stream.toResponse();
  }

  return NextResponse.json(
    {
      error: "Unknown action. Expected 'start' or 'resume'.",
    },
    { status: 400 },
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleRequest(request);
}

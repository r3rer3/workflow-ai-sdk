import { NextResponse } from "next/server";
import {
  createCustomStreamEvent,
  createInMemoryWorkflowStore,
  createToolEndStreamEvent,
  createToolStartStreamEvent,
  createWorkflowTool,
  defineWorkflow,
  extendHierarchyWithTool,
  type InMemoryWorkflowStore,
  pauseWorkflow,
  type RuntimeContext,
  toUIMessageStream,
  type WorkflowUIMessage,
  workflowEvent,
} from "workflow-ai-sdk";
import { z } from "zod";

// Workflow-owned tool approval.
//
// Contrast with `tool-approval-ai-sdk`: the tool is plain here. The workflow
// step decides that the action needs approval, pauses, and only emits the
// tool lifecycle after an explicit resume with approval.

interface WorkflowApprovalState {
  operation: string;
  approved: boolean;
  [key: string]: unknown;
}

const DELETE_RECORD_TOOL_NAME = "delete_record";
const APPROVAL_REASON = "destructive-action";

const startEvent = workflowEvent(
  "tool-approval-workflow.start",
  z.object({
    operation: z.string(),
  }),
);
const approvalEvent = workflowEvent(
  "tool-approval-workflow.approval",
  z.object({
    approved: z.boolean(),
  }),
);
const endEvent = workflowEvent(
  "tool-approval-workflow.end",
  z.object({
    summary: z.string(),
  }),
);

const deleteRecordTool = createWorkflowTool({
  name: DELETE_RECORD_TOOL_NAME,
  description: "Delete a record by id.",
  inputSchema: z.object({
    recordId: z.string(),
  }),
  execute: async (input: { recordId: string }) => ({
    deleted: input.recordId.length > 0,
  }),
});

// The tool stays plain; the workflow step decides whether it is allowed to run.
void deleteRecordTool;

function emitText(
  context: RuntimeContext<WorkflowApprovalState, WorkflowUIMessage>,
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

function emitToolRun(
  context: RuntimeContext<WorkflowApprovalState, WorkflowUIMessage>,
  toolName: string,
) {
  const toolCallId = crypto.randomUUID();
  const hierarchy = extendHierarchyWithTool(
    context.getHierarchy(),
    toolName,
    toolCallId,
  );
  const startedAt = Date.now();

  context.emit(
    createToolStartStreamEvent({
      toolName,
      toolCallId,
      hierarchy,
    }),
  );
  context.emit(
    createToolEndStreamEvent({
      toolName,
      toolCallId,
      success: true,
      durationMs: Date.now() - startedAt,
      hierarchy,
    }),
  );
}

const toolApprovalWorkflow = defineWorkflow({
  name: "tool-approval-workflow-example",
  trigger: startEvent,
  finish: endEvent,
  initialState({ input }) {
    return {
      operation: input.operation,
      approved: false,
    };
  },
})
  .step(startEvent, (context, event) => {
    context.state.operation = event.operation;

    context.emit(
      createCustomStreamEvent({
        name: "approval-requested",
        data: {
          reason: APPROVAL_REASON,
          operation: event.operation,
        },
        hierarchy: context.getHierarchy(),
      }),
    );

    return pauseWorkflow({
      reason: "awaiting-user-approval",
      payload: {
        operation: event.operation,
        reason: APPROVAL_REASON,
      },
    });
  })
  .step(approvalEvent, (context, event) => {
    context.state.approved = event.approved;

    const summary = event.approved
      ? `Approved. ${DELETE_RECORD_TOOL_NAME} ran for "${context.state.operation}".`
      : `Denied. ${DELETE_RECORD_TOOL_NAME} was not called for "${context.state.operation}".`;

    if (event.approved) {
      emitToolRun(context, DELETE_RECORD_TOOL_NAME);
    }

    emitText(context, summary);

    return endEvent.create({
      summary,
    });
  });

const store: InMemoryWorkflowStore<WorkflowApprovalState, WorkflowUIMessage> =
  createInMemoryWorkflowStore<WorkflowApprovalState, WorkflowUIMessage>();

type StartBody = { action: "start"; operation?: string };
type ApproveBody = { action: "approve"; runId: string; approved: boolean };
type RequestBody = StartBody | ApproveBody;

export async function POST(request: Request) {
  const body = (await request.json()) as RequestBody;

  if (body.action === "start") {
    const execution = await toolApprovalWorkflow.run({
      input: {
        operation: body.operation?.trim() || "delete-legacy-record",
      },
      mode: "resumable",
      store,
    });

    const stream = await toUIMessageStream(execution);
    return stream.toResponse();
  }

  if (body.action === "approve") {
    const execution = await toolApprovalWorkflow.resume({
      runId: body.runId,
      store,
      event: approvalEvent.create({
        approved: body.approved,
      }),
    });

    const stream = await toUIMessageStream(execution);
    return stream.toResponse();
  }

  return NextResponse.json(
    {
      error: "Unknown action. Expected 'start' or 'approve'.",
    },
    {
      status: 400,
    },
  );
}

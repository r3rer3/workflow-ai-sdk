"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { SubmitEvent } from "react";
import { useMemo, useState } from "react";
import type {
  WorkflowDataParts,
  WorkflowMessageMetadata,
  WorkflowUIMessage,
} from "workflow-ai-sdk";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import { Tool, ToolContent, ToolHeader } from "@/components/ai-elements/tool";

/**
 * Frontend for `/api/tool-approval-workflow`.
 *
 * Same start/approve dance as the AI-SDK-style approval page, but the
 * workflow owns the policy. The tool itself is plain; the step emits an
 * `approval-requested` event, pauses, and only runs the tool after a
 * resumed approval.
 */

interface PendingApproval {
  runId: string;
  operation: string;
  reason: string;
}

interface PendingApprovalPayload {
  operation?: unknown;
  reason?: unknown;
}

type ToolApprovalWorkflowMessage = WorkflowUIMessage<
  WorkflowMessageMetadata,
  WorkflowDataParts
>;

type ToolApprovalWorkflowPart = ToolApprovalWorkflowMessage["parts"][number];

function findPendingApproval(
  parts: readonly ToolApprovalWorkflowPart[],
): PendingApproval | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (
      part?.type !== "data-workflow-paused" ||
      part.data.reason !== "awaiting-user-approval"
    ) {
      continue;
    }

    const payload = part.data.payload as PendingApprovalPayload | undefined;

    return {
      runId: part.data.runId,
      operation:
        typeof payload?.operation === "string" ? payload.operation : "",
      reason:
        typeof payload?.reason === "string"
          ? payload.reason
          : "destructive-action",
    };
  }

  return null;
}

export default function ToolApprovalWorkflowPage() {
  const [operation, setOperation] = useState("");
  const [resolvedRunIds, setResolvedRunIds] = useState<Set<string>>(new Set());

  const { messages, sendMessage, status } =
    useChat<ToolApprovalWorkflowMessage>({
      transport: new DefaultChatTransport({
        api: "/api/tool-approval-workflow",
        prepareSendMessagesRequest: ({ body }) => ({
          body: body ?? { action: "start", operation: "delete-legacy-record" },
        }),
      }),
    });

  const assistantParts = useMemo(
    () =>
      messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) => message.parts),
    [messages],
  );

  const pending = useMemo(
    () => findPendingApproval(assistantParts),
    [assistantParts],
  );

  const activePending =
    pending && !resolvedRunIds.has(pending.runId) ? pending : null;

  const isStreaming = status === "streaming" || status === "submitted";

  const handleStart = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = operation.trim();
    if (!trimmed || isStreaming) {
      return;
    }

    sendMessage(
      { text: `Request: ${trimmed}` },
      { body: { action: "start", operation: trimmed } },
    );
    setOperation("");
  };

  const handleDecide = (approved: boolean) => {
    if (!activePending || isStreaming) {
      return;
    }

    setResolvedRunIds((prev) => new Set(prev).add(activePending.runId));
    sendMessage(
      { text: approved ? "Approve" : "Deny" },
      {
        body: {
          action: "approve",
          runId: activePending.runId,
          approved,
        },
      },
    );
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 bg-background p-6 text-foreground">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-700">
          workflow-ai-sdk
        </p>
        <h1 className="font-serif text-4xl leading-tight sm:text-5xl">
          Tool approval (workflow style)
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
          The <code>delete_record</code> tool is plain. The workflow step
          decides to pause with{" "}
          <code>reason: &quot;awaiting-user-approval&quot;</code> before the
          destructive action runs.
        </p>
      </header>

      {activePending && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.12em]">
              Workflow paused
            </p>
            <p className="text-sm">
              {activePending.reason} —{" "}
              <span className="font-mono">
                {activePending.operation || "(unspecified)"}
              </span>
              <br />
              <span className="text-xs opacity-80">
                run {activePending.runId.slice(0, 8)}
              </span>
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleDecide(true)}
              disabled={isStreaming}
              className="inline-flex items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => handleDecide(false)}
              disabled={isStreaming}
              className="inline-flex items-center justify-center rounded-md border border-foreground/30 bg-background px-4 py-2 text-sm font-medium text-foreground transition-opacity disabled:opacity-50"
            >
              Deny
            </button>
          </div>
        </div>
      )}

      <Conversation className="min-h-[320px] flex-1 overflow-y-auto rounded-xl border bg-card/50">
        <ConversationContent>
          {messages.length === 0 && (
            <ConversationEmptyState
              title="Request a destructive operation"
              description="The workflow will pause for approval before calling delete_record."
            />
          )}
          {messages.map((message) => (
            <div key={message.id} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {message.role}
              </p>
              {message.parts.map((part, idx) => {
                const partKey = `${message.id}-p-${idx}`;

                if (part.type === "text") {
                  return (
                    <p
                      key={partKey}
                      className="whitespace-pre-wrap text-sm leading-relaxed"
                    >
                      {part.text}
                    </p>
                  );
                }

                if (part.type === "data-custom-event") {
                  return (
                    <p key={partKey} className="text-xs text-muted-foreground">
                      event: {part.data.name}
                    </p>
                  );
                }

                if (part.type === "data-tool-start") {
                  return (
                    <Tool key={partKey} defaultOpen={false}>
                      <ToolHeader
                        type="dynamic-tool"
                        toolName={part.data.toolName ?? "delete_record"}
                        state="input-available"
                      />
                      <ToolContent>
                        <p className="text-xs text-muted-foreground">
                          Tool started after approval.
                        </p>
                      </ToolContent>
                    </Tool>
                  );
                }

                if (part.type === "data-tool-end") {
                  return (
                    <p key={partKey} className="text-xs text-muted-foreground">
                      tool {part.data.toolName} finished in{" "}
                      {part.data.durationMs ?? 0} ms
                    </p>
                  );
                }

                if (part.type === "data-workflow-paused") {
                  return (
                    <p
                      key={partKey}
                      className="rounded-md border border-dashed border-amber-300 bg-amber-50/60 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-100"
                    >
                      paused — {part.data.reason} (run{" "}
                      {part.data.runId.slice(0, 8)})
                    </p>
                  );
                }

                return null;
              })}
            </div>
          ))}
        </ConversationContent>
      </Conversation>

      <form
        onSubmit={handleStart}
        className="flex flex-col gap-3 rounded-xl border bg-card p-4"
      >
        <label
          htmlFor="operation"
          className="text-xs font-medium text-muted-foreground"
        >
          Operation
        </label>
        <input
          id="operation"
          value={operation}
          onChange={(event) => setOperation(event.target.value)}
          placeholder="delete-legacy-record"
          className="w-full rounded-md border bg-background p-3 text-sm outline-none focus:border-foreground/40"
          disabled={isStreaming || Boolean(activePending)}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {activePending
              ? "Resolve the pending approval first."
              : isStreaming
                ? "Running…"
                : "Submit to request the destructive operation."}
          </span>
          <button
            type="submit"
            disabled={
              isStreaming ||
              Boolean(activePending) ||
              operation.trim().length === 0
            }
            className="inline-flex items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity disabled:opacity-50"
          >
            Start
          </button>
        </div>
      </form>
    </main>
  );
}

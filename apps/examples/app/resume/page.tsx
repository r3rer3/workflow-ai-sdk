"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { SubmitEvent } from "react";
import { useMemo, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import type { ResumeWorkflowMessage } from "../../lib/workflow-message-types";

/**
 * Frontend for `/api/resume`.
 *
 * The route is two-shot:
 *   1. POST `{ action: "start", topic }` → workflow runs step 1, then pauses
 *      (`pauseWorkflow`). The pause arrives on the client as a
 *      `data-workflow-paused` part whose `data.runId` lets us address the
 *      paused run.
 *   2. POST `{ action: "resume", runId, approved }` → workflow runs step 2,
 *      streams the summary text, and finishes.
 *
 * We layer that on top of `useChat` by passing per-call `body` overrides
 * through `prepareSendMessagesRequest`. The same chat thread holds both the
 * pause and the resume output, so the user sees the full timeline.
 */

interface PendingPause {
  runId: string;
  topic: string;
}

type ResumeWorkflowPart = ResumeWorkflowMessage["parts"][number];

function findPendingPause(
  parts: readonly ResumeWorkflowPart[],
): PendingPause | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part?.type !== "data-workflow-paused") {
      continue;
    }

    const payload = part.data.payload as { topic?: unknown } | undefined;
    return {
      runId: part.data.runId,
      topic: typeof payload?.topic === "string" ? payload.topic : "",
    };
  }
  return null;
}

export default function ResumePage() {
  const [topic, setTopic] = useState("");
  const [resumed, setResumed] = useState<Set<string>>(new Set());

  const { messages, sendMessage, status } = useChat<ResumeWorkflowMessage>({
    transport: new DefaultChatTransport({
      api: "/api/resume",
      prepareSendMessagesRequest: ({ body }) => {
        return {
          body: body ?? { action: "start", topic: "unspecified" },
        };
      },
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
    () => findPendingPause(assistantParts),
    [assistantParts],
  );

  // The same paused chunk can stay in scrollback forever; once we've sent a
  // resume for a runId we don't want the approval UI to come back.
  const activePending = pending && !resumed.has(pending.runId) ? pending : null;

  const isStreaming = status === "streaming" || status === "submitted";

  const handleStart = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = topic.trim();
    if (!trimmed || isStreaming) {
      return;
    }
    sendMessage(
      { text: `Start: ${trimmed}` },
      { body: { action: "start", topic: trimmed } },
    );
    setTopic("");
  };

  const handleDecide = (approved: boolean) => {
    if (!activePending || isStreaming) {
      return;
    }
    setResumed((prev) => new Set(prev).add(activePending.runId));
    sendMessage(
      { text: approved ? "Approve" : "Deny" },
      {
        body: {
          action: "resume",
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
          Resumable workflow
        </h1>
      </header>

      {activePending && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.12em]">
              Awaiting approval
            </p>
            <p className="text-sm">
              Run <code>{activePending.runId.slice(0, 8)}</code> paused on topic{" "}
              <span className="font-medium">
                {activePending.topic || "(unspecified)"}
              </span>
              .
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

      {/* conversation */}
      <Conversation className="min-h-[320px] flex-1 overflow-y-auto rounded-xl border bg-card/50">
        <ConversationContent>
          {messages.length === 0 && (
            <ConversationEmptyState
              title="Start a run"
              description="The workflow will pause for approval after step 1."
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

                if (part.type === "data-workflow-paused") {
                  return (
                    <p
                      key={partKey}
                      className="rounded-md border border-dashed border-amber-300 bg-amber-50/60 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-100"
                    >
                      paused — {part.data.reason ?? "awaiting input"} (run{" "}
                      {part.data.runId?.slice(0, 8) ?? "?"})
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
          htmlFor="topic"
          className="text-xs font-medium text-muted-foreground"
        >
          Topic
        </label>
        <input
          id="topic"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="quick-persistence-demo"
          className="w-full rounded-md border bg-background p-3 text-sm outline-none focus:border-foreground/40"
          disabled={isStreaming || Boolean(activePending)}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {activePending
              ? "Resolve the pending approval first."
              : isStreaming
                ? "Running…"
                : "Submit to start a new run."}
          </span>
          <button
            type="submit"
            disabled={
              isStreaming || Boolean(activePending) || topic.trim().length === 0
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

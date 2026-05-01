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
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import type { ToolResponseMessage } from "@/lib/workflow-message-types";

/**
 * Frontend for `/api/tool-response`.
 *
 * The offline path of that route emits the `lookup_weather` tool lifecycle
 * with `createToolStartEvent` + `createToolEndEvent`. Those flow into
 * `toUIMessageStream` as workflow data parts (`data-tool-start` /
 * `data-tool-end`), *not* as AI-SDK `tool-<name>` parts. We collapse the
 * pair into a single ai-elements `Tool` panel so the visual matches the
 * online (agent-driven) path which would emit `tool-lookup_weather` parts.
 */

interface ToolView {
  toolCallId: string;
  toolName: string;
  state: "input-streaming" | "input-available" | "output-available";
  startedAt?: number;
  durationMs?: number;
  success?: boolean;
}

type ResponsePart = ToolResponseMessage["parts"][number];

function deriveToolViews(parts: readonly ResponsePart[]): ToolView[] {
  const order: string[] = [];
  const byCallId = new Map<string, ToolView>();

  for (const part of parts) {
    // Real LLM-driven tool calls (agent path with OPENAI_API_KEY).
    if (part.type === "tool-tool-lookup_weather") {
      if (!byCallId.has(part.toolCallId)) {
        order.push(part.toolCallId);
      }
      byCallId.set(part.toolCallId, {
        toolCallId: part.toolCallId,
        toolName: part.type.slice("tool-".length),
        state:
          part.state === "output-available"
            ? "output-available"
            : part.state === "input-available"
              ? "input-available"
              : "input-streaming",
        success: part.state === "output-available",
      });
      continue;
    }

    // Workflow data parts emitted by the offline fallback path.
    if (part.type === "data-tool-start") {
      if (!part.data.toolCallId || !part.data.toolName) {
        continue;
      }
      if (!byCallId.has(part.data.toolCallId)) {
        order.push(part.data.toolCallId);
      }
      byCallId.set(part.data.toolCallId, {
        toolCallId: part.data.toolCallId,
        toolName: part.data.toolName,
        state: "input-available",
        startedAt: Date.now(),
      });
      continue;
    }

    if (part.type === "data-tool-end") {
      if (!part.data.toolCallId) {
        continue;
      }
      const existing = byCallId.get(part.data.toolCallId);
      byCallId.set(part.data.toolCallId, {
        toolCallId: part.data.toolCallId,
        toolName: part.data.toolName ?? existing?.toolName ?? "tool",
        state: "output-available",
        success: part.data.success ?? true,
        durationMs: part.data.durationMs,
      });
    }
  }

  return order
    .map((id) => byCallId.get(id))
    .filter((entry): entry is ToolView => Boolean(entry));
}

export default function ToolResponsePage() {
  const [input, setInput] = useState("");

  const { messages, sendMessage, status } = useChat<ToolResponseMessage>({
    transport: new DefaultChatTransport({
      api: "/api/tool-response",
    }),
  });

  const assistantParts = useMemo(
    () =>
      messages
        .filter((message) => message.role === "assistant")
        .flatMap((message) => message.parts),
    [messages],
  );

  const toolViews = useMemo(
    () => deriveToolViews(assistantParts),
    [assistantParts],
  );

  const isStreaming = status === "streaming" || status === "submitted";

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || isStreaming) {
      return;
    }
    sendMessage({ text });
    setInput("");
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 bg-background p-6 text-foreground">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-700">
          workflow-ai-sdk
        </p>
        <h1 className="font-serif text-4xl leading-tight sm:text-5xl">
          Tool response
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
          A workflow step calls the <code>lookup_weather</code> tool and
          summarizes the structured result. Without an OpenAI key the route
          drives the tool lifecycle directly so the demo still streams a real
          tool start/end pair.
        </p>
      </header>

      {toolViews.length > 0 && (
        <div className="flex flex-col gap-2">
          {toolViews.map((view) => (
            <Tool key={view.toolCallId} defaultOpen={false}>
              <ToolHeader
                type="dynamic-tool"
                toolName={view.toolName}
                state={view.state}
              />
              <ToolContent>
                <ToolInput
                  input={{
                    toolCallId: view.toolCallId,
                    durationMs: view.durationMs,
                  }}
                />
                <ToolOutput
                  output={
                    view.state === "output-available"
                      ? { success: view.success ?? true }
                      : undefined
                  }
                  errorText={undefined}
                />
              </ToolContent>
            </Tool>
          ))}
        </div>
      )}

      <Conversation className="min-h-[320px] flex-1 overflow-y-auto rounded-xl border bg-card/50">
        <ConversationContent>
          {messages.length === 0 && (
            <ConversationEmptyState
              title="Pick a city"
              description="The workflow will look up its weather and stream a one-line summary."
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
                return null;
              })}
            </div>
          ))}
        </ConversationContent>
      </Conversation>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 rounded-xl border bg-card p-4"
      >
        <label
          htmlFor="city"
          className="text-xs font-medium text-muted-foreground"
        >
          City
        </label>
        <input
          id="city"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Lisbon"
          className="w-full rounded-md border bg-background p-3 text-sm outline-none focus:border-foreground/40"
          disabled={isStreaming}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {isStreaming
              ? "Calling lookup_weather…"
              : "Submit to call the tool."}
          </span>
          <button
            type="submit"
            disabled={isStreaming || input.trim().length === 0}
            className="inline-flex items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity disabled:opacity-50"
          >
            {isStreaming ? "Running…" : "Look up"}
          </button>
        </div>
      </form>
    </main>
  );
}

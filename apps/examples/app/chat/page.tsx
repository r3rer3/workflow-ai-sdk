"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { SubmitEvent } from "react";
import { useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";

export default function ChatPage() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
  });

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
          Basic chat
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
          The minimum AI SDK-backed workflow route: one abortable step runs an
          agent, streams AI SDK UI chunks through the workflow runtime, and
          accepts the default `useChat` request body.
        </p>
      </header>

      <Conversation className="min-h-[320px] flex-1 overflow-y-auto rounded-xl border bg-card/50">
        <ConversationContent>
          {messages.length === 0 && (
            <ConversationEmptyState
              title="Send a message"
              description="Set OPENAI_API_KEY, then the workflow will answer through an AI SDK agent step."
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
          htmlFor="message"
          className="text-xs font-medium text-muted-foreground"
        >
          Message
        </label>
        <textarea
          id="message"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="How should I structure an AI workflow?"
          rows={3}
          className="w-full resize-none rounded-md border bg-background p-3 text-sm outline-none focus:border-foreground/40"
          disabled={isStreaming}
        />
        {error && <p className="text-xs text-red-700">{error.message}</p>}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {isStreaming
              ? "Streaming via the workflow…"
              : "Submit to invoke the workflow agent."}
          </span>
          <button
            type="submit"
            disabled={isStreaming || input.trim().length === 0}
            className="inline-flex items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity disabled:opacity-50"
          >
            {isStreaming ? "Running…" : "Send"}
          </button>
        </div>
      </form>
    </main>
  );
}

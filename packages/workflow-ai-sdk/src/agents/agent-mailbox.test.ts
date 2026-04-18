import { describe, expect, it } from "bun:test";

import {
  type AgentMailboxMessage,
  createAgentMailbox,
} from "./agent-mailbox";
import {
  type WorkflowDispatchStream,
  type RuntimeContext,
  type WorkflowDispatchOperation,
  createWorkflowHierarchy,
} from "../index";

describe("createAgentMailbox", () => {
  it("stores messages, emits custom events, and filters inboxes", () => {
    const emitted: Array<{ type: string; data?: unknown }> = [];
    const stream: WorkflowDispatchStream = {
      filter() {
        return stream;
      },
      until() {
        return stream;
      },
      async toArray() {
        return [];
      },
      toAsyncIterator() {
        return this[Symbol.asyncIterator]();
      },
      async *[Symbol.asyncIterator]() { },
    };

    const dispatch = (): WorkflowDispatchOperation => {
      const done = Promise.resolve();

      return Object.assign(done, {
        done,
        stream,
      });
    };

    const state: {
      mailbox: AgentMailboxMessage[];
    } = {
      mailbox: []
    };

    const context: RuntimeContext<typeof state> = {
      runId: "run_1",
      threadId: "thread_1",
      resourceId: "resource_1",
      mode: "abortable",
      signal: new AbortController().signal,
      state,
      messages: [],
      executionState: {
        state,
        messages: [],
      },
      emit(event) {
        emitted.push(event);
      },
      stream,
      dispatch,
      checkpoint: async () => undefined,
      pause(value) {
        return value;
      },
      getHierarchy() {
        return createWorkflowHierarchy("mailbox-test", "run_1");
      },
    };

    const mailbox = createAgentMailbox(context, state.mailbox, {
      createId: () => "msg_1",
      now: () => new Date("2026-04-10T12:00:00.000Z"),
    });

    const message = mailbox.post({
      from: "agent-a",
      to: "agent-b",
      type: "question",
      payload: {
        prompt: "What risk matters most?",
      },
    });

    mailbox.post({
      from: "agent-c",
      to: "*",
      type: "note",
      payload: {
        text: "Broadcast update",
      },
      createdAt: "2026-04-10T12:01:00.000Z",
    });

    expect(message).toMatchObject({
      id: "msg_1",
      from: "agent-a",
      to: "agent-b",
      type: "question",
      createdAt: "2026-04-10T12:00:00.000Z",
    });
    expect(state.mailbox).toHaveLength(2);
    expect(mailbox.list({ from: "agent-a" })).toHaveLength(1);
    expect(mailbox.inbox("agent-b").map((entry) => entry.from)).toEqual([
      "agent-a",
      "agent-c",
    ]);
    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toMatchObject({
      type: "custom-event",
      data: {
        name: "agent-mailbox",
        data: {
          message: {
            from: "agent-a",
            to: "agent-b",
            type: "question",
          },
        },
      },
    });
  });
});

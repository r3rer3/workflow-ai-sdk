import { nanoid } from "nanoid";
import { safeStructuredClone } from "../runtime/clone";
import { createCustomStreamEvent } from "../runtime/create-stream-event";
import type {
  JsonValue,
  RuntimeContext,
  WorkflowUIMessage,
} from "../runtime/types";

export interface AgentMailboxMessage<TPayload extends JsonValue = JsonValue> {
  [key: string]: JsonValue;
  id: string;
  from: string;
  to: string;
  type: string;
  payload: TPayload;
  createdAt: string;
}

export interface AgentMailboxPostInput<TPayload extends JsonValue = JsonValue> {
  from: string;
  to: string;
  type: string;
  payload: TPayload;
  createdAt?: string;
}

export interface AgentMailboxOptions {
  eventName?: string;
  createId?: () => string;
  now?: () => Date;
}

export interface AgentMailbox<TPayload extends JsonValue = JsonValue> {
  post: (
    input: AgentMailboxPostInput<TPayload>,
  ) => AgentMailboxMessage<TPayload>;
  list: (
    filter?:
      | Partial<Pick<AgentMailboxMessage<TPayload>, "from" | "to" | "type">>
      | ((message: AgentMailboxMessage<TPayload>) => boolean),
  ) => AgentMailboxMessage<TPayload>[];
  inbox: (agentName: string) => AgentMailboxMessage<TPayload>[];
}

export function createAgentMailbox<
  TPayload extends JsonValue = JsonValue,
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMessage extends WorkflowUIMessage = WorkflowUIMessage,
>(
  context: RuntimeContext<TState, TMessage>,
  messages: AgentMailboxMessage<TPayload>[],
  options: AgentMailboxOptions = {},
): AgentMailbox<TPayload> {
  const eventName = options.eventName ?? "agent-mailbox";
  const createId = options.createId ?? (() => nanoid());
  const now = options.now ?? (() => new Date());

  function cloneMessage(message: AgentMailboxMessage<TPayload>) {
    return {
      ...message,
      payload: safeStructuredClone(message.payload),
    };
  }

  return {
    post(input) {
      const message: AgentMailboxMessage<TPayload> = {
        id: createId(),
        from: input.from,
        to: input.to,
        type: input.type,
        payload: input.payload,
        createdAt: input.createdAt ?? now().toISOString(),
      };

      messages.push(message);
      context.emit(
        createCustomStreamEvent({
          name: eventName,
          data: {
            message: cloneMessage(message),
          },
          hierarchy: context.getHierarchy(),
        }),
      );

      return cloneMessage(message);
    },
    list(filter) {
      if (!filter) {
        return messages.map(cloneMessage);
      }

      if (typeof filter === "function") {
        return messages.filter(filter).map(cloneMessage);
      }

      return messages
        .filter((message) => {
          if (filter.from && message.from !== filter.from) {
            return false;
          }
          if (filter.to && message.to !== filter.to) {
            return false;
          }
          if (filter.type && message.type !== filter.type) {
            return false;
          }
          return true;
        })
        .map(cloneMessage);
    },
    inbox(agentName) {
      return messages
        .filter((message) => message.to === agentName || message.to === "*")
        .map(cloneMessage);
    },
  };
}

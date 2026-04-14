import type { InferUIMessageChunk, UIMessage, UITools } from "ai";

import type {
  WorkflowDispatchedEvent,
  WorkflowEventDefinition,
} from "./workflow-event";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | {
    [key: string]: JsonValue;
  };

export type JsonObject = {
  [key: string]: JsonValue;
};

export type WorkflowExecutionMode = "abortable" | "resumable";

export interface ExecutionHierarchy {
  workflowName?: string;
  workflowRunId?: string;
  toolName?: string;
  toolCallId?: string;
}

export interface WorkflowMessageMetadata {
  workflowName?: string;
}

export type WorkflowDataParts = {
  "tool-start": ToolStartEventData;
  "tool-end": ToolEndEventData;
};

export type WorkflowUIMessage<TOOLS extends UITools = UITools> = UIMessage<
  WorkflowMessageMetadata,
  WorkflowDataParts,
  TOOLS
>;

export type WorkflowUIChunk = InferUIMessageChunk<WorkflowUIMessage>;

// Native workflow execution state keeps user-owned workflow data separate from framework-owned messages.
export interface WorkflowExecutionState<
  TState extends Record<string, unknown>,
  TMessage extends UIMessage = WorkflowUIMessage,
> {
  state: TState;
  messages: TMessage[];
}

export interface ToolStartEventData {
  toolName: string;
  toolCallId: string;
  hierarchy: ExecutionHierarchy;
}

export interface ToolEndEventData {
  toolName: string;
  toolCallId: string;
  success: boolean;
  durationMs: number;
  hierarchy: ExecutionHierarchy;
}

export type WorkflowStreamEvent =
  | {
    type: "tool-start";
    data: ToolStartEventData;
  }
  | {
    type: "tool-end";
    data: ToolEndEventData;
  }
  | {
    type: "ui-message-chunk";
    data: {
      chunk: WorkflowUIChunk;
      hierarchy: ExecutionHierarchy;
    };
  };

export interface WorkflowPause {
  kind: "pause";
  reason: string;
  payload?: JsonValue;
}

export interface WorkflowDispatchStream<
  TEvent extends WorkflowDispatchedEvent = WorkflowDispatchedEvent,
> extends AsyncIterable<TEvent> {
  filter<TType extends string, TData>(
    event: WorkflowEventDefinition<TType, TData>,
  ): WorkflowDispatchStream<WorkflowDispatchedEvent<TType, TData>>;
  filter(predicate: (event: TEvent) => boolean): WorkflowDispatchStream<TEvent>;
  until<TType extends string, TData>(
    event: WorkflowEventDefinition<TType, TData>,
  ): WorkflowDispatchStream<TEvent>;
  until(predicate: (event: TEvent) => boolean): WorkflowDispatchStream<TEvent>;
  toArray(): Promise<TEvent[]>;
}

export interface WorkflowDispatchOperation extends Promise<void> {
  readonly done: Promise<void>;
  readonly stream: WorkflowDispatchStream;
}

export interface RuntimeContext<
  TState extends Record<string, unknown>,
  TMessage extends UIMessage = WorkflowUIMessage,
> {
  runId: string;
  threadId: string;
  resourceId: string;
  mode: WorkflowExecutionMode;
  signal: AbortSignal;
  readonly state: TState;
  readonly messages: TMessage[];
  readonly executionState: WorkflowExecutionState<TState, TMessage>;
  readonly stream: WorkflowDispatchStream;
  emit: (event: WorkflowStreamEvent) => void;
  dispatch: (...events: WorkflowDispatchedEvent[]) => WorkflowDispatchOperation;
  checkpoint: () => Promise<void>;
  pause: (pause: WorkflowPause) => WorkflowPause;
  getHierarchy: () => ExecutionHierarchy;
}


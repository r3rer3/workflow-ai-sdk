import type {
  InferUIMessageChunk,
  LanguageModelUsage,
  UIMessage,
  UITools,
} from "ai";

import type {
  WorkflowDispatchedEvent,
  WorkflowEventDefinition,
  WorkflowStepInput,
  WorkflowTriggerLike,
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
  workflowName: string;
  workflowRunId: string;
  agentName?: string;
  agentRunId?: string;
  toolName?: string;
  toolCallId?: string;
}

export interface WorkflowMessageMetadata {
  workflowName?: string;
  runId?: string;
  threadId?: string;
  agentName?: string;
}

export type WorkflowDataParts = {
  "workflow-start": WorkflowStartEventData;
  "workflow-step": WorkflowStepEventData;
  "workflow-end": WorkflowEndEventData;
  "workflow-error": WorkflowErrorEventData;
  "workflow-paused": WorkflowPausedEventData;
  "workflow-aborted": WorkflowAbortedEventData;
  "agent-start": AgentStartEventData;
  "agent-end": AgentEndEventData;
  "tool-start": ToolStartEventData;
  "tool-end": ToolEndEventData;
  "custom-event": WorkflowCustomEventData;
};

export type WorkflowUIMessage<TOOLS extends UITools = UITools> = UIMessage<
  WorkflowMessageMetadata,
  WorkflowDataParts,
  TOOLS
>;

// Native workflow execution state keeps user-owned workflow data separate from framework-owned messages.
export interface WorkflowExecutionState<
  TState extends Record<string, unknown>,
  TMessage extends UIMessage,
> {
  state: TState;
  messages: TMessage[];
}

export interface WorkflowStartEventData {
  workflowName: string;
  runId: string;
  threadId: string;
  resourceId: string;
  mode: WorkflowExecutionMode;
  resumed: boolean;
  hierarchy: ExecutionHierarchy;
}

export interface WorkflowStepEventData {
  workflowName: string;
  runId: string;
  stepName: string;
  eventType: string;
  inputEventTypes: string[];
  hierarchy: ExecutionHierarchy;
}

export interface WorkflowEndEventData {
  workflowName: string;
  runId: string;
  durationMs: number;
  result?: JsonValue;
  hierarchy: ExecutionHierarchy;
}

export interface WorkflowErrorEventData {
  workflowName: string;
  runId: string;
  message: string;
  retryable: boolean;
  hierarchy: ExecutionHierarchy;
}

export interface WorkflowPausedEventData {
  workflowName: string;
  runId: string;
  reason: string;
  payload?: JsonValue;
  hierarchy: ExecutionHierarchy;
}

export interface WorkflowAbortedEventData {
  workflowName: string;
  runId: string;
  reason?: string;
  hierarchy: ExecutionHierarchy;
}

export interface WorkflowCustomEventData {
  name: string;
  data: JsonValue;
  hierarchy: ExecutionHierarchy;
}

export interface AgentUsageEntry {
  model?: string;
  totalUsage?: LanguageModelUsage;
  finishReason?: string;
  rawFinishReason?: string;
}

export interface AgentStartEventData {
  agentName: string;
  agentRunId: string;
  hierarchy: ExecutionHierarchy;
}

export interface AgentEndEventData {
  agentName: string;
  agentRunId: string;
  success: boolean;
  durationMs: number;
  usage?: AgentUsageEntry;
  hierarchy: ExecutionHierarchy;
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

export type WorkflowStreamEventFromParts = {
  [K in keyof WorkflowDataParts]: { type: K; data: WorkflowDataParts[K] };
}[keyof WorkflowDataParts];

export type WorkflowStreamEvent<TMessage extends UIMessage> =
  | WorkflowStreamEventFromParts
  | {
    type: "ui-message-chunk";
    data: {
      chunk: InferUIMessageChunk<TMessage>;
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
  toAsyncIterator(): AsyncIterator<TEvent>;
}

export interface WorkflowDispatchOperation extends Promise<void> {
  readonly done: Promise<void>;
  readonly stream: WorkflowDispatchStream;
}

export type WorkflowStepResult =
  | void
  | WorkflowPause
  | WorkflowDispatchedEvent
  | WorkflowDispatchedEvent[];

export interface WorkflowRunRecord<
  TState extends Record<string, unknown>,
  TMessage extends UIMessage,
> {
  workflowName: string;
  runId: string;
  threadId: string;
  resourceId: string;
  mode: WorkflowExecutionMode;
  executionState: WorkflowExecutionState<TState, TMessage>;
  status: "running" | "paused" | "completed" | "failed" | "aborted";
  metadata?: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowCheckpoint<
  TState extends Record<string, unknown>,
  TMessage extends UIMessage,
> {
  workflowName: string;
  runId: string;
  mode: WorkflowExecutionMode;
  threadId: string;
  resourceId: string;
  executionState: WorkflowExecutionState<TState, TMessage>;
  pendingEvents: WorkflowDispatchedEvent[];
  pause?: WorkflowPause;
  metadata?: JsonObject;
  runtime?: WorkflowRuntimeCheckpoint;
  updatedAt: string;
}

export interface WorkflowRuntimeCheckpointEvent {
  id: number;
  event: WorkflowDispatchedEvent;
}

export interface WorkflowStepRuntimeCheckpoint {
  history: WorkflowRuntimeCheckpointEvent[];
}

export interface WorkflowRuntimeCheckpoint {
  nextOccurrenceId: number;
  pendingEvents: WorkflowRuntimeCheckpointEvent[];
  stepStates: WorkflowStepRuntimeCheckpoint[];
}

export interface WorkflowStore<
  TState extends Record<string, unknown>,
  TMessage extends UIMessage,
> {
  createRun(record: WorkflowRunRecord<TState, TMessage>): Promise<void>;
  markRunRunning(runId: string): Promise<void>;
  markRunCompleted(runId: string, result?: JsonValue): Promise<void>;
  markRunFailed(runId: string, error: { message: string }): Promise<void>;
  markRunPaused(runId: string, pause: WorkflowPause): Promise<void>;
  markRunAborted(runId: string, reason?: string): Promise<void>;
  appendEvent(
    runId: string,
    event: WorkflowStreamEvent<TMessage>,
  ): Promise<void>;
  saveCheckpoint(
    checkpoint: WorkflowCheckpoint<TState, TMessage>,
  ): Promise<void>;
  loadCheckpoint(
    runId: string,
  ): Promise<WorkflowCheckpoint<TState, TMessage> | null>;
}

export interface RuntimeContext<
  TState extends Record<string, unknown>,
  TMessage extends UIMessage,
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
  emit: (event: WorkflowStreamEvent<TMessage>) => void;
  dispatch: (...events: WorkflowDispatchedEvent[]) => WorkflowDispatchOperation;
  checkpoint: () => Promise<void>;
  pause: (pause: WorkflowPause) => WorkflowPause;
  getHierarchy: () => ExecutionHierarchy;
}

export type WorkflowStepHandler<
  TState extends Record<string, unknown>,
  TTrigger extends WorkflowTriggerLike,
  TMessage extends UIMessage,
  TEventData = WorkflowStepInput<TTrigger>,
> = (
  context: RuntimeContext<TState, TMessage>,
  event: TEventData,
) => Promise<WorkflowStepResult> | WorkflowStepResult;

export interface WorkflowStep<
  TState extends Record<string, unknown>,
  TTrigger extends WorkflowTriggerLike,
  TMessage extends UIMessage,
  TEventData = WorkflowStepInput<TTrigger>,
> {
  name: string;
  event: TTrigger;
  handler: WorkflowStepHandler<TState, TTrigger, TMessage, TEventData>;
}

export interface DefineWorkflowOptions<
  TInput,
  TState extends Record<string, unknown>,
  TResult extends JsonValue,
  TMessage extends UIMessage,
  TTrigger extends WorkflowEventDefinition<string, TInput>,
  TFinish extends WorkflowEventDefinition<string, TResult>,
> {
  name: string;
  description?: string;
  trigger: TTrigger;
  finish: TFinish;
  initialState: (
    args: WorkflowInitialStateFactoryOptions<TInput, TMessage>,
  ) => Promise<TState> | TState;
}

export interface WorkflowInitialStateFactoryOptions<
  TInput,
  TMessage extends UIMessage,
> {
  input: TInput;
  threadId: string;
  resourceId: string;
  messages: TMessage[];
  metadata?: JsonObject;
}

export interface WorkflowRunOptions<
  TInput,
  TState extends Record<string, unknown>,
  TMessage extends UIMessage,
> {
  input: TInput;
  messages?: TMessage[];
  threadId?: string;
  resourceId?: string;
  mode?: WorkflowExecutionMode;
  metadata?: JsonObject;
  store?: WorkflowStore<TState, TMessage>;
}

export interface WorkflowResumeOptions<
  TState extends Record<string, unknown>,
  TMessage extends UIMessage,
> {
  runId: string;
  store: WorkflowStore<TState, TMessage>;
  event?: WorkflowDispatchedEvent;
  metadata?: JsonObject;
}

export interface WorkflowExecution<TMessage extends UIMessage> {
  workflowName: string;
  runId: string;
  threadId: string;
  resourceId: string;
  mode: WorkflowExecutionMode;
  messages: TMessage[];
  stream: ReadableStream<WorkflowStreamEvent<TMessage>>;
  cancel: (reason?: string) => void;
}

export type WorkflowRunOptionsFor<
  TInput,
  TState extends Record<string, unknown>,
  TMessage extends UIMessage,
> = [TInput] extends [never]
  ? Omit<WorkflowRunOptions<TInput, TState, TMessage>, "input">
  : WorkflowRunOptions<TInput, TState, TMessage>;

export interface DefinedWorkflow<
  TInput,
  TState extends Record<string, unknown>,
  TResult extends JsonValue,
  TMessage extends UIMessage,
  TTrigger extends WorkflowEventDefinition<string, TInput>,
  TFinish extends WorkflowEventDefinition<string, TResult>,
> {
  name: string;
  description?: string;
  trigger: TTrigger;
  finish: TFinish;
  readonly steps: ReadonlyArray<
    WorkflowStep<TState, WorkflowTriggerLike, TMessage, unknown>
  >;
  step<TStepTrigger extends WorkflowTriggerLike>(
    event: TStepTrigger,
    handler: WorkflowStepHandler<TState, TStepTrigger, TMessage>,
    options?: { name?: string },
  ): this;
  run: (
    options: WorkflowRunOptionsFor<TInput, TState, TMessage>,
  ) => Promise<WorkflowExecution<TMessage>>;
  resume: (
    options: WorkflowResumeOptions<TState, TMessage>,
  ) => Promise<WorkflowExecution<TMessage>>;
}

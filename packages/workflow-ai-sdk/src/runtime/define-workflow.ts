import { nanoid } from "nanoid";
import { safeStructuredClone } from "./clone";
import {
  createWorkflowAbortedStreamEvent,
  createWorkflowEndStreamEvent,
  createWorkflowErrorStreamEvent,
  createWorkflowHierarchy,
  createWorkflowPausedStreamEvent,
  createWorkflowStartStreamEvent,
  createWorkflowStepStreamEvent,
} from "./create-stream-event";
import {
  createDispatchOperation,
  createWorkflowDispatchStream,
  DispatchTraceSource,
  WorkflowExecutionInterruptedError,
} from "./dispatch-stream";
import type {
  DefinedWorkflow,
  WorkflowInitialStateFactoryOptions,
  JsonObject,
  JsonValue,
  RuntimeContext,
  WorkflowCheckpoint,
  WorkflowDispatchOperation,
  WorkflowExecution,
  WorkflowExecutionMode,
  WorkflowExecutionState,
  WorkflowPause,
  WorkflowRunOptions,
  WorkflowRunOptionsFor,
  WorkflowRuntimeCheckpoint,
  WorkflowStep,
  WorkflowStepHandler,
  WorkflowStepResult,
  WorkflowStore,
  WorkflowStreamEvent,
  WorkflowUIMessage,
} from "./types";
import {
  type AnyWorkflowEventDefinition,
  decorateWorkflowEvent,
  describeWorkflowTrigger,
  isWorkflowEventDefinition,
  type NormalizeWorkflowTrigger,
  normalizeWorkflowTrigger,
  validateWorkflowEvent,
  type WorkflowDispatchedEvent,
  type WorkflowEventDefinition,
  WorkflowEventValidationError,
  type WorkflowTriggerLike,
} from "./workflow-event";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function isWorkflowPause(value: WorkflowStepResult): value is WorkflowPause {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "pause"
  );
}

function normalizeDispatchedEvents(
  value: WorkflowStepResult,
): WorkflowDispatchedEvent[] {
  if (value == null || isWorkflowPause(value)) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function cloneWorkflowEvent<TType extends string = string, TData = unknown>(
  event: WorkflowDispatchedEvent<TType, TData>,
): WorkflowDispatchedEvent<TType, TData> {
  return decorateWorkflowEvent(safeStructuredClone(event));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isExecutionInterruptedError(
  error: unknown,
): error is WorkflowExecutionInterruptedError {
  return error instanceof WorkflowExecutionInterruptedError;
}

function isWorkflowEventValidationError(
  error: unknown,
): error is WorkflowEventValidationError {
  return error instanceof WorkflowEventValidationError;
}

type NormalizedWorkflowTrigger = NormalizeWorkflowTrigger<WorkflowTriggerLike>;
type WorkflowEventDefinitionMap = Map<string, AnyWorkflowEventDefinition[]>;
type RuntimeDispatchOperation = WorkflowDispatchOperation & {
  queued: Promise<void>;
};

interface TriggerHistoryEntry {
  id: number;
  event: WorkflowDispatchedEvent;
}

interface MatchCandidate {
  value: unknown;
  historyIndexes: number[];
  firstIndex: number;
  lastIndex: number;
  flattenedEvents: WorkflowDispatchedEvent[];
}

interface CompiledWorkflowStep<
  TState extends Record<string, unknown>,
  TMessage extends WorkflowUIMessage,
> {
  name: string;
  event: NormalizedWorkflowTrigger;
  handler: (
    context: RuntimeContext<TState, TMessage>,
    event: unknown,
  ) => Promise<WorkflowStepResult> | WorkflowStepResult;
  mentionedTypes: Set<string>;
  history: TriggerHistoryEntry[];
  isSingleEvent: boolean;
}

interface RuntimeOccurrence {
  id: number;
  parentId?: number;
  ancestors: number[];
  event: WorkflowDispatchedEvent;
  started: boolean;
  settled: boolean;
  handlerSettled: boolean;
  pendingChildren: number;
  done: ReturnType<typeof deferred<void>>;
}

type StopState<TResult> =
  | {
    kind: "running";
  }
  | {
    kind: "finished";
    result?: TResult;
  }
  | {
    kind: "paused";
    pause: WorkflowPause;
  }
  | {
    kind: "aborted";
    reason?: string;
  }
  | {
    kind: "errored";
    message: string;
    retryable?: boolean;
  };

function collectMentionedTypes(
  trigger: NormalizedWorkflowTrigger,
  types: Set<string> = new Set(),
): Set<string> {
  if (isWorkflowEventDefinition(trigger)) {
    types.add(trigger.type);
    return types;
  }

  for (const child of trigger.triggers) {
    collectMentionedTypes(child, types);
  }

  return types;
}

function collectEventDefinitions(
  trigger: NormalizedWorkflowTrigger,
  definitions: WorkflowEventDefinitionMap = new Map(),
): WorkflowEventDefinitionMap {
  if (isWorkflowEventDefinition(trigger)) {
    const existing = definitions.get(trigger.type) ?? [];

    if (!existing.includes(trigger)) {
      existing.push(trigger);
      definitions.set(trigger.type, existing);
    }

    return definitions;
  }

  for (const child of trigger.triggers) {
    collectEventDefinitions(child, definitions);
  }

  return definitions;
}

async function validateRegisteredEvent(
  definitions: WorkflowEventDefinitionMap,
  event: WorkflowDispatchedEvent,
): Promise<WorkflowDispatchedEvent> {
  const matchingDefinitions = definitions.get(event.type);

  if (!matchingDefinitions || matchingDefinitions.length === 0) {
    return cloneWorkflowEvent(event);
  }

  let validated = cloneWorkflowEvent(event);

  for (const definition of matchingDefinitions) {
    validated = await validateWorkflowEvent(definition, validated);
  }

  return validated;
}

function compileSteps<
  TState extends Record<string, unknown>,
  TMessage extends WorkflowUIMessage,
>(
  steps: WorkflowStep<TState, WorkflowTriggerLike, TMessage, unknown>[],
  runtime?: WorkflowRuntimeCheckpoint,
): CompiledWorkflowStep<TState, TMessage>[] {
  return steps.map((step, index) => {
    const event = normalizeWorkflowTrigger(step.event);
    const savedHistory = runtime?.stepStates[index]?.history ?? [];

    return {
      name: step.name,
      event,
      handler: step.handler,
      mentionedTypes: collectMentionedTypes(event),
      history: savedHistory.map((entry) => ({
        id: entry.id,
        event: cloneWorkflowEvent(entry.event),
      })),
      isSingleEvent: isWorkflowEventDefinition(event),
    };
  });
}

function buildMatchCandidate(
  value: unknown,
  historyIndexes: number[],
  flattenedEvents: WorkflowDispatchedEvent[],
): MatchCandidate {
  const sortedIndexes = [...historyIndexes].sort((left, right) => left - right);

  return {
    value,
    historyIndexes: sortedIndexes,
    firstIndex: sortedIndexes[0] ?? -1,
    lastIndex: sortedIndexes.at(-1) ?? -1,
    flattenedEvents,
  };
}

function* iterateMatches(
  trigger: NormalizedWorkflowTrigger,
  history: TriggerHistoryEntry[],
  minIndex = 0,
  usedIndexes = new Set<number>(),
): Generator<MatchCandidate> {
  if (isWorkflowEventDefinition(trigger)) {
    for (let index = minIndex; index < history.length; index += 1) {
      if (usedIndexes.has(index)) {
        continue;
      }

      const entry = history[index];

      if (!entry) {
        continue;
      }

      if (!trigger.is(entry.event)) {
        continue;
      }

      yield buildMatchCandidate(entry.event, [index], [entry.event]);
    }

    return;
  }

  switch (trigger.kind) {
    case "or":
      for (const child of trigger.triggers) {
        yield* iterateMatches(child, history, minIndex, usedIndexes);
      }
      return;
    case "and":
      yield* iterateAndMatches(
        trigger.triggers,
        history,
        minIndex,
        usedIndexes,
      );
      return;
    case "order":
      yield* iterateOrderedMatches(
        trigger.triggers,
        history,
        minIndex,
        usedIndexes,
      );
      return;
  }
}

function* iterateAndMatches(
  triggers: readonly NormalizedWorkflowTrigger[],
  history: TriggerHistoryEntry[],
  minIndex: number,
  usedIndexes: Set<number>,
  triggerIndex = 0,
  values: unknown[] = [],
  historyIndexes: number[] = [],
  flattenedEvents: WorkflowDispatchedEvent[] = [],
): Generator<MatchCandidate> {
  if (triggerIndex >= triggers.length) {
    if (historyIndexes.length > 0) {
      yield buildMatchCandidate(values, historyIndexes, flattenedEvents);
    }
    return;
  }

  const trigger = triggers[triggerIndex];

  if (!trigger) {
    return;
  }

  for (const match of iterateMatches(trigger, history, minIndex, usedIndexes)) {
    const nextUsedIndexes = new Set(usedIndexes);

    for (const index of match.historyIndexes) {
      nextUsedIndexes.add(index);
    }

    yield* iterateAndMatches(
      triggers,
      history,
      minIndex,
      nextUsedIndexes,
      triggerIndex + 1,
      [...values, match.value],
      [...historyIndexes, ...match.historyIndexes],
      [...flattenedEvents, ...match.flattenedEvents],
    );
  }
}

function* iterateOrderedMatches(
  triggers: readonly NormalizedWorkflowTrigger[],
  history: TriggerHistoryEntry[],
  minIndex: number,
  usedIndexes: Set<number>,
  triggerIndex = 0,
  values: unknown[] = [],
  historyIndexes: number[] = [],
  flattenedEvents: WorkflowDispatchedEvent[] = [],
): Generator<MatchCandidate> {
  if (triggerIndex >= triggers.length) {
    if (historyIndexes.length > 0) {
      yield buildMatchCandidate(values, historyIndexes, flattenedEvents);
    }
    return;
  }

  const trigger = triggers[triggerIndex];

  if (!trigger) {
    return;
  }

  for (const match of iterateMatches(trigger, history, minIndex, usedIndexes)) {
    const nextUsedIndexes = new Set(usedIndexes);

    for (const index of match.historyIndexes) {
      nextUsedIndexes.add(index);
    }

    yield* iterateOrderedMatches(
      triggers,
      history,
      match.lastIndex + 1,
      nextUsedIndexes,
      triggerIndex + 1,
      [...values, match.value],
      [...historyIndexes, ...match.historyIndexes],
      [...flattenedEvents, ...match.flattenedEvents],
    );
  }
}

function consumeStepMatch<
  TState extends Record<string, unknown>,
  TMessage extends WorkflowUIMessage,
>(
  step: CompiledWorkflowStep<TState, TMessage>,
  occurrence: RuntimeOccurrence,
): MatchCandidate | null {
  if (!step.mentionedTypes.has(occurrence.event.type)) {
    return null;
  }

  step.history.push({
    id: occurrence.id,
    event: cloneWorkflowEvent(occurrence.event),
  });

  const match = iterateMatches(step.event, step.history).next().value ?? null;
  if (!match) {
    return null;
  }

  step.history = step.history.filter(
    (_entry, index) => index > match.lastIndex,
  );

  return match;
}

function toStepInput<
  TState extends Record<string, unknown>,
  TMessage extends WorkflowUIMessage,
>(
  step: CompiledWorkflowStep<TState, TMessage>,
  match: MatchCandidate,
): unknown {
  if (step.isSingleEvent) {
    return match.flattenedEvents[0]?.data;
  }

  return match.value;
}

function stopMessage<TResult>(state: StopState<TResult>): string {
  switch (state.kind) {
    case "finished":
      return "Workflow finished.";
    case "paused":
      return `Workflow paused: ${state.pause.reason}`;
    case "aborted":
      return state.reason
        ? `Workflow aborted: ${state.reason}`
        : "Workflow aborted.";
    case "errored":
      return `Workflow errored: ${state.message}`;
    case "running":
      return "Workflow interrupted.";
  }
}

function hasWorkflowRunInput<
  TInput,
  TState extends Record<string, unknown>,
  TMessage extends WorkflowUIMessage,
>(
  runOptions: WorkflowRunOptionsFor<TInput, TState, TMessage>,
): runOptions is WorkflowRunOptions<TInput, TState, TMessage> {
  return "input" in runOptions;
}

function createInitialWorkflowEvent<
  TInput,
  TTrigger extends WorkflowEventDefinition<string, TInput>,
>(
  trigger: TTrigger,
  args: [TInput] extends [never] ? [] : [TInput],
): ReturnType<TTrigger["create"]> {
  return trigger.create(...args) as ReturnType<TTrigger["create"]>;
}

export function pauseWorkflow(args: {
  reason: string;
  payload?: WorkflowPause["payload"];
}): WorkflowPause {
  return {
    kind: "pause",
    ...args,
  };
}

async function createExecutionState<
  TInput,
  TState extends Record<string, unknown>,
  TMessage extends WorkflowUIMessage,
>(args: {
  input: TInput;
  threadId: string;
  resourceId: string;
  messages: TMessage[];
  metadata?: JsonObject;
  options: {
    name: string;
    initialState: (options: {
      input: TInput;
      threadId: string;
      resourceId: string;
      messages: TMessage[];
      metadata?: JsonObject;
    }) => Promise<TState> | TState;
  };
}): Promise<WorkflowExecutionState<TState, TMessage>> {
  const state = await args.options.initialState({
    input: args.input,
    threadId: args.threadId,
    resourceId: args.resourceId,
    messages: safeStructuredClone(args.messages),
    metadata: args.metadata,
  });

  if (state === undefined) {
    throw new Error(
      `Workflow "${args.options.name}" requires state. Provide defineWorkflow({ initialState }).`,
    );
  }

  return {
    state: safeStructuredClone(state),
    messages: safeStructuredClone(args.messages),
  };
}

export function defineWorkflow<
  TInput,
  TState extends Record<string, unknown>,
  TTriggerType extends string,
  TResult extends JsonValue,
  TMessage extends WorkflowUIMessage,
  TFinishType extends string,
>(
  options: {
    name: string;
    description?: string;
    trigger: WorkflowEventDefinition<TTriggerType, TInput>;
    finish: WorkflowEventDefinition<TFinishType, TResult>;
    initialState: (
      args: WorkflowInitialStateFactoryOptions<TInput, TMessage>,
    ) => Promise<TState> | TState;
  },
): DefinedWorkflow<
  TInput,
  TState,
  TResult,
  TMessage,
  WorkflowEventDefinition<TTriggerType, TInput>,
  WorkflowEventDefinition<TFinishType, TResult>
> {
  const collectedSteps: WorkflowStep<
    TState,
    WorkflowTriggerLike,
    TMessage,
    unknown
  >[] = [];

  async function startExecution(args: {
    runId: string;
    threadId: string;
    resourceId: string;
    mode: WorkflowExecutionMode;
    metadata?: JsonObject;
    input?: TInput;
    initialMessages: TMessage[];
    resumed: boolean;
    store?: WorkflowStore<TState, TMessage>;
    pendingEvents: WorkflowDispatchedEvent[];
    initialExecutionState?: WorkflowExecutionState<TState, TMessage>;
    initialRuntime?: WorkflowRuntimeCheckpoint;
    resumeEvent?: WorkflowDispatchedEvent;
  }): Promise<WorkflowExecution<TMessage>> {
    const abortController = new AbortController();
    const workflowStart = Date.now();
    const hierarchy = createWorkflowHierarchy(options.name, args.runId);
    let executionState = args.initialExecutionState
      ? safeStructuredClone(args.initialExecutionState)
      : null;
    let messages =
      executionState?.messages ?? safeStructuredClone(args.initialMessages);
    const steps = compileSteps(collectedSteps, args.initialRuntime);
    const eventDefinitions = collectEventDefinitions(
      normalizeWorkflowTrigger(options.trigger),
    );
    collectEventDefinitions(
      normalizeWorkflowTrigger(options.finish),
      eventDefinitions,
    );
    for (const step of steps) {
      collectEventDefinitions(step.event, eventDefinitions);
    }
    const pendingQueue: RuntimeOccurrence[] = [];
    const activeOccurrences = new Map<number, RuntimeOccurrence>();
    const traceSource = new DispatchTraceSource();
    const executionDone = deferred<void>();
    let controller!: ReadableStreamDefaultController<
      WorkflowStreamEvent<TMessage>
    >;
    let processingCount = 0;
    let pumpScheduled = false;
    let finalized = false;
    let stopState: StopState<TResult> = {
      kind: "running",
    };
    let stopPromise: Promise<void> | null = null;
    let interruptionError: WorkflowExecutionInterruptedError | null = null;
    let nextOccurrenceId = args.initialRuntime?.nextOccurrenceId ?? 1;

    const emitEvent = async (event: WorkflowStreamEvent<TMessage>) => {
      controller.enqueue(event);
      await args.store?.appendEvent(args.runId, event);
    };

    const emitEventAsync = (event: WorkflowStreamEvent<TMessage>) => {
      controller.enqueue(event);
      void args.store?.appendEvent(args.runId, event);
    };

    const buildRuntimeCheckpoint = (): WorkflowRuntimeCheckpoint => ({
      nextOccurrenceId,
      pendingEvents: pendingQueue.map((occurrence) => ({
        id: occurrence.id,
        event: safeStructuredClone(occurrence.event),
      })),
      stepStates: steps.map((step) => ({
        history: step.history.map((entry) => ({
          id: entry.id,
          event: safeStructuredClone(entry.event),
        })),
      })),
    });

    const persistCheckpoint = async (
      pause?: WorkflowPause,
      metadataOverride?: JsonObject,
    ) => {
      if (args.mode !== "resumable" || !args.store || executionState === null) {
        return;
      }

      const runtime = buildRuntimeCheckpoint();
      const checkpoint: WorkflowCheckpoint<TState, TMessage> = {
        workflowName: options.name,
        runId: args.runId,
        mode: args.mode,
        threadId: args.threadId,
        resourceId: args.resourceId,
        executionState: safeStructuredClone(executionState),
        pause,
        metadata: metadataOverride ?? args.metadata,
        runtime,
        updatedAt: new Date().toISOString(),
      };

      await args.store.saveCheckpoint(checkpoint);
    };

    const resolveOccurrence = (occurrence: RuntimeOccurrence) => {
      if (occurrence.settled) {
        return;
      }

      occurrence.settled = true;
      activeOccurrences.delete(occurrence.id);
      occurrence.done.resolve();
    };

    const rejectOccurrence = (
      occurrence: RuntimeOccurrence,
      error: WorkflowExecutionInterruptedError,
    ) => {
      if (occurrence.settled) {
        return;
      }

      occurrence.settled = true;
      activeOccurrences.delete(occurrence.id);
      occurrence.done.reject(error);
    };

    const finalizeOccurrence = (occurrence: RuntimeOccurrence) => {
      if (occurrence.settled) {
        return;
      }

      if (stopState.kind !== "running") {
        rejectOccurrence(
          occurrence,
          interruptionError ??
          new WorkflowExecutionInterruptedError(stopMessage(stopState)),
        );
        return;
      }

      if (occurrence.handlerSettled && occurrence.pendingChildren === 0) {
        resolveOccurrence(occurrence);
      }
    };

    const createOccurrence = (args: {
      event: WorkflowDispatchedEvent;
      parent?: RuntimeOccurrence;
      id?: number;
    }): RuntimeOccurrence => {
      const id = args.id ?? nextOccurrenceId;

      if (args.id === undefined) {
        nextOccurrenceId += 1;
      } else if (args.id >= nextOccurrenceId) {
        nextOccurrenceId = args.id + 1;
      }

      const occurrence: RuntimeOccurrence = {
        id,
        parentId: args.parent?.id,
        ancestors: args.parent
          ? [...args.parent.ancestors, args.parent.id]
          : [],
        event: cloneWorkflowEvent(args.event),
        started: false,
        settled: false,
        handlerSettled: false,
        pendingChildren: 0,
        done: deferred<void>(),
      };

      activeOccurrences.set(occurrence.id, occurrence);
      void occurrence.done.promise.catch(() => { });

      if (args.parent) {
        const parent = args.parent;

        parent.pendingChildren += 1;
        void occurrence.done.promise
          .finally(() => {
            parent.pendingChildren = Math.max(0, parent.pendingChildren - 1);
            finalizeOccurrence(parent);
          })
          .catch(() => { });
      }

      return occurrence;
    };

    const scopeForRoots =
      (rootIds: Set<number>) =>
        (record: { id: number; ancestors: number[] }) => {
          return (
            rootIds.has(record.id) ||
            record.ancestors.some((id) => rootIds.has(id))
          );
        };

    const schedulePump = () => {
      if (pumpScheduled || finalized || stopState.kind !== "running") {
        return;
      }

      pumpScheduled = true;

      queueMicrotask(() => {
        pumpScheduled = false;

        while (
          stopState.kind === "running" &&
          pendingQueue.length > 0 &&
          !finalized
        ) {
          const occurrence = pendingQueue.shift();

          if (!occurrence || occurrence.started) {
            continue;
          }

          occurrence.started = true;
          processingCount += 1;

          void processOccurrence(occurrence)
            .catch(async (error) => {
              if (isExecutionInterruptedError(error)) {
                return;
              }

              await requestStop({
                kind: "errored",
                message: toErrorMessage(error),
                retryable: !isWorkflowEventValidationError(error),
              });
            })
            .finally(async () => {
              processingCount = Math.max(0, processingCount - 1);
              await maybeFinalizeExecution();
            });
        }
      });
    };

    const validateStepHistories = async () => {
      for (const step of steps) {
        for (const entry of step.history) {
          entry.event = await validateRegisteredEvent(
            eventDefinitions,
            entry.event,
          );
        }
      }
    };

    const queueOccurrence = (args: {
      event: WorkflowDispatchedEvent;
      parent?: RuntimeOccurrence;
      id?: number;
      beforePublish?: (occurrence: RuntimeOccurrence) => void;
    }) => {
      const occurrence = createOccurrence({
        event: args.event,
        parent: args.parent,
        id: args.id,
      });

      args.beforePublish?.(occurrence);

      traceSource.publish({
        id: occurrence.id,
        parentId: occurrence.parentId,
        ancestors: occurrence.ancestors,
        event: cloneWorkflowEvent(occurrence.event),
      });

      pendingQueue.push(occurrence);
      schedulePump();
      return occurrence;
    };

    const createInterruptedOperation = (): RuntimeDispatchOperation => {
      const stream = createWorkflowDispatchStream({
        source: traceSource,
        startIndex: traceSource.size,
        scope: () => false,
      });
      const done = Promise.reject(
        interruptionError ??
        new WorkflowExecutionInterruptedError(
          "Workflow execution has stopped.",
        ),
      );

      void done.catch(() => { });

      const operation = createDispatchOperation({
        done,
        stream,
      });
      return Object.assign(operation, {
        queued: Promise.resolve(),
      });
    };

    const createCompletedDispatchStream = () => {
      const source = new DispatchTraceSource();
      source.close();

      return createWorkflowDispatchStream({
        source,
        startIndex: 0,
        scope: () => true,
      });
    };

    const dispatchFromOccurrence = (
      occurrence: RuntimeOccurrence,
      events: WorkflowDispatchedEvent[],
    ): RuntimeDispatchOperation => {
      if (events.length === 0) {
        const operation = createDispatchOperation({
          done: Promise.resolve(),
          stream: createCompletedDispatchStream(),
        });
        return Object.assign(operation, {
          queued: Promise.resolve(),
        });
      }

      if (stopState.kind !== "running") {
        return createInterruptedOperation();
      }

      const startIndex = traceSource.size;
      const rootIds = new Set<number>();
      const stream = createWorkflowDispatchStream({
        source: traceSource,
        startIndex,
        scope: scopeForRoots(rootIds),
      });
      const rootsPromise = Promise.all(
        events.map((event) => validateRegisteredEvent(eventDefinitions, event)),
      ).then((validatedEvents) =>
        validatedEvents.map((event) =>
          queueOccurrence({
            event,
            parent: occurrence,
            beforePublish(nextOccurrence) {
              rootIds.add(nextOccurrence.id);
            },
          }),
        ),
      );
      const queued = rootsPromise.then(() => {
        return undefined;
      });
      const done = rootsPromise
        .then((roots) => {
          return Promise.all(
            roots.map(async (root) => {
              await root.done.promise;
            }),
          );
        })
        .then(() => undefined);

      void done.catch(() => { });

      const operation = createDispatchOperation({
        done,
        stream,
      });
      return Object.assign(operation, {
        queued,
      });
    };

    const createScopedStepStream = (occurrence: RuntimeOccurrence) =>
      createWorkflowDispatchStream({
        source: traceSource,
        startIndex: traceSource.size,
        scope: (record) => record.ancestors.includes(occurrence.id),
      });

    const maybeFinalizeExecution = async () => {
      if (finalized) {
        return;
      }

      if (stopState.kind !== "running") {
        if (processingCount > 0) {
          return;
        }

        finalized = true;
        await stopPromise;
        executionDone.resolve();
        return;
      }

      if (processingCount > 0 || pendingQueue.length > 0) {
        return;
      }

      finalized = true;

      await persistCheckpoint();

      traceSource.close();
      executionDone.resolve();
    };

    const requestStop = async (nextState: StopState<TResult>) => {
      if (stopState.kind !== "running") {
        await stopPromise;
        return;
      }

      stopState = nextState;
      pendingQueue.length = 0;
      interruptionError = new WorkflowExecutionInterruptedError(
        stopMessage(nextState),
      );

      if (!abortController.signal.aborted) {
        abortController.abort(interruptionError.message);
      }

      traceSource.interrupt(interruptionError);

      for (const occurrence of [...activeOccurrences.values()]) {
        rejectOccurrence(occurrence, interruptionError);
      }

      stopPromise = (async () => {
        switch (nextState.kind) {
          case "finished":
            await emitEvent(
              createWorkflowEndStreamEvent({
                workflowName: options.name,
                runId: args.runId,
                durationMs: Date.now() - workflowStart,
                result: nextState.result,
                hierarchy,
              }),
            );
            await persistCheckpoint();
            await args.store?.markRunCompleted(args.runId, nextState.result);
            return;
          case "paused":
            await emitEvent(
              createWorkflowPausedStreamEvent({
                workflowName: options.name,
                runId: args.runId,
                reason: nextState.pause.reason,
                payload: nextState.pause.payload,
                hierarchy,
              }),
            );
            await persistCheckpoint(nextState.pause);
            await args.store?.markRunPaused(args.runId, nextState.pause);
            return;
          case "aborted":
            await emitEvent(
              createWorkflowAbortedStreamEvent({
                workflowName: options.name,
                runId: args.runId,
                reason: nextState.reason,
                hierarchy,
              }),
            );
            await persistCheckpoint();
            await args.store?.markRunAborted(args.runId, nextState.reason);
            return;
          case "errored":
            await emitEvent(
              createWorkflowErrorStreamEvent({
                workflowName: options.name,
                runId: args.runId,
                message: nextState.message,
                retryable: nextState.retryable,
                hierarchy,
              }),
            );
            await persistCheckpoint();
            await args.store?.markRunFailed(args.runId, {
              message: nextState.message,
            });
            return;
          case "running":
            return;
        }
      })();

      await stopPromise;
    };

    const processOccurrence = async (occurrence: RuntimeOccurrence) => {
      if (stopState.kind !== "running") {
        throw (
          interruptionError ??
          new WorkflowExecutionInterruptedError(
            "Workflow execution has stopped.",
          )
        );
      }

      const event = occurrence.event;

      if (options.finish.is(event)) {
        occurrence.handlerSettled = true;
        resolveOccurrence(occurrence);
        await requestStop({
          kind: "finished",
          result: event.data,
        });
        return;
      }

      for (const step of steps) {
        if (stopState.kind !== "running") {
          break;
        }

        const match = consumeStepMatch(step, occurrence);
        if (!match) {
          continue;
        }

        if (executionState === null) {
          throw new Error(
            `Workflow "${options.name}" execution state is not initialized.`,
          );
        }

        const queuedDispatches: Promise<void>[] = [];
        const currentState = executionState.state;

        const context: RuntimeContext<TState, TMessage> = {
          runId: args.runId,
          threadId: args.threadId,
          resourceId: args.resourceId,
          mode: args.mode,
          signal: abortController.signal,
          state: currentState,
          messages,
          executionState,
          stream: createScopedStepStream(occurrence),
          emit(event) {
            emitEventAsync(event);
          },
          dispatch(...events) {
            const operation = dispatchFromOccurrence(occurrence, events);
            queuedDispatches.push(operation.queued);
            return operation;
          },
          checkpoint() {
            return persistCheckpoint();
          },
          getHierarchy() {
            return hierarchy;
          },
        };

        await emitEvent(
          createWorkflowStepStreamEvent({
            workflowName: options.name,
            runId: args.runId,
            stepName: step.name,
            eventType: occurrence.event.type,
            inputEventTypes: match.flattenedEvents.map((event) => event.type),
            hierarchy,
          }),
        );

        const result = await step.handler(context, toStepInput(step, match));
        await Promise.all(queuedDispatches);

        if (isWorkflowPause(result)) {
          occurrence.handlerSettled = true;
          finalizeOccurrence(occurrence);
          await requestStop({
            kind: "paused",
            pause: result,
          });
          return;
        }

        if (abortController.signal.aborted && stopState.kind === "running") {
          occurrence.handlerSettled = true;
          finalizeOccurrence(occurrence);
          await requestStop({
            kind: "aborted",
            reason: abortController.signal.reason
              ? String(abortController.signal.reason)
              : undefined,
          });
          return;
        }

        const implicitDispatch = normalizeDispatchedEvents(result);
        if (implicitDispatch.length > 0) {
          await dispatchFromOccurrence(occurrence, implicitDispatch).queued;
        }
      }

      occurrence.handlerSettled = true;
      finalizeOccurrence(occurrence);
      await persistCheckpoint();
    };

    const stream = new ReadableStream<WorkflowStreamEvent<TMessage>>({
      start(streamController) {
        controller = streamController;

        void (async () => {
          try {
            if (args.resumed) {
              await args.store?.markRunRunning(args.runId);
            }

            await emitEvent(
              createWorkflowStartStreamEvent({
                workflowName: options.name,
                runId: args.runId,
                threadId: args.threadId,
                resourceId: args.resourceId,
                mode: args.mode,
                resumed: args.resumed,
                hierarchy,
              }),
            );

            if (!args.resumed) {
              const [triggerEvent, ...restPendingEvents] = args.pendingEvents;

              if (!triggerEvent) {
                throw new Error(
                  `Workflow "${options.name}" requires an initial trigger event.`,
                );
              }

              const validatedTrigger = await validateWorkflowEvent(
                options.trigger,
                triggerEvent,
              );

              executionState = await createExecutionState({
                input: validatedTrigger.data,
                threadId: args.threadId,
                resourceId: args.resourceId,
                messages,
                metadata: args.metadata,
                options,
              });
              messages = executionState.messages;
              args.pendingEvents = [validatedTrigger, ...restPendingEvents];

              await args.store?.createRun({
                workflowName: options.name,
                runId: args.runId,
                threadId: args.threadId,
                resourceId: args.resourceId,
                mode: args.mode,
                executionState: safeStructuredClone(executionState),
                status: "running",
                metadata: args.metadata,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
            } else {
              await validateStepHistories();
            }

            await persistCheckpoint();

            if (args.resumeEvent) {
              queueOccurrence({
                event: await validateRegisteredEvent(
                  eventDefinitions,
                  args.resumeEvent,
                ),
              });
            }

            if (args.initialRuntime?.pendingEvents.length) {
              const validatedPendingEvents = await Promise.all(
                args.initialRuntime.pendingEvents.map(async (pendingEvent) => ({
                  id: pendingEvent.id,
                  event: await validateRegisteredEvent(
                    eventDefinitions,
                    pendingEvent.event,
                  ),
                })),
              );

              for (const pendingEvent of validatedPendingEvents) {
                queueOccurrence({
                  id: pendingEvent.id,
                  event: pendingEvent.event,
                });
              }
            } else {
              const validatedPendingEvents = await Promise.all(
                args.pendingEvents.map((pendingEvent) =>
                  validateRegisteredEvent(eventDefinitions, pendingEvent),
                ),
              );

              for (const pendingEvent of validatedPendingEvents) {
                queueOccurrence({
                  event: pendingEvent,
                });
              }
            }

            await maybeFinalizeExecution();
            await executionDone.promise;
          } catch (error) {
            if (!isExecutionInterruptedError(error)) {
              await requestStop({
                kind: "errored",
                message: toErrorMessage(error),
                retryable: !isWorkflowEventValidationError(error),
              });
            }
          } finally {
            controller.close();
          }
        })();
      },
    });

    return {
      workflowName: options.name,
      runId: args.runId,
      threadId: args.threadId,
      resourceId: args.resourceId,
      mode: args.mode,
      messages,
      stream,
      cancel(reason) {
        if (!abortController.signal.aborted) {
          abortController.abort(reason);
        }

        void requestStop({
          kind: "aborted",
          reason: reason ? String(reason) : undefined,
        });
      },
    };
  }

  const workflow: DefinedWorkflow<
    TInput,
    TState,
    TResult,
    TMessage,
    WorkflowEventDefinition<TTriggerType, TInput>,
    WorkflowEventDefinition<TFinishType, TResult>
  > = {
    name: options.name,
    description: options.description,
    trigger: options.trigger,
    finish: options.finish,
    get steps() {
      return collectedSteps;
    },
    step(event, handler, stepOptions) {
      collectedSteps.push({
        name: stepOptions?.name ?? describeWorkflowTrigger(event),
        event,
        handler: handler as WorkflowStepHandler<
          TState,
          WorkflowTriggerLike,
          TMessage,
          unknown
        >,
      });
      return workflow;
    },
    async run(runOptions) {
      const runId = nanoid();
      const threadId = runOptions.threadId ?? nanoid();
      const resourceId = runOptions.resourceId ?? nanoid();
      const mode = runOptions.mode ?? "abortable";

      if (mode === "resumable" && !runOptions.store) {
        throw new Error("A resumable workflow requires a store.");
      }

      const messages = safeStructuredClone(runOptions.messages ?? []);
      const initialTriggerArgs = (
        hasWorkflowRunInput(runOptions) ? [runOptions.input] : []
      ) as [TInput] extends [never] ? [] : [TInput];

      return startExecution({
        runId,
        threadId,
        resourceId,
        mode,
        metadata: runOptions.metadata,
        input: hasWorkflowRunInput(runOptions) ? runOptions.input : undefined,
        initialMessages: messages,
        resumed: false,
        store: runOptions.store,
        pendingEvents: [
          createInitialWorkflowEvent(options.trigger, initialTriggerArgs),
        ],
      });
    },
    async resume(resumeOptions) {
      const checkpoint = await resumeOptions.store.loadCheckpoint(
        resumeOptions.runId,
      );

      if (!checkpoint) {
        throw new Error(
          `No checkpoint found for workflow run "${resumeOptions.runId}".`,
        );
      }

      return startExecution({
        runId: checkpoint.runId,
        threadId: checkpoint.threadId,
        resourceId: checkpoint.resourceId,
        mode: checkpoint.mode,
        metadata: resumeOptions.metadata ?? checkpoint.metadata,
        pendingEvents:
          checkpoint.runtime?.pendingEvents.map(
            (pendingEvent) => pendingEvent.event,
          ) ?? [],
        initialRuntime: checkpoint.runtime,
        resumeEvent: resumeOptions.event,
        initialMessages: checkpoint.executionState.messages,
        initialExecutionState: checkpoint.executionState,
        resumed: true,
        store: resumeOptions.store,
      });
    },
  };

  return workflow;
}

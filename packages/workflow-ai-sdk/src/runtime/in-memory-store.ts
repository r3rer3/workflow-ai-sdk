import { safeStructuredClone } from "./clone";
import type {
  JsonValue,
  WorkflowCheckpoint,
  WorkflowExecutionState,
  WorkflowPause,
  WorkflowRunRecord,
  WorkflowStore,
  WorkflowStreamEvent,
  WorkflowUIMessage,
} from "./types";

export interface InMemoryWorkflowStoreState<
  TState extends Record<string, unknown>,
  TMessage extends WorkflowUIMessage,
> {
  runs: Map<string, WorkflowRunRecord<TState, TMessage>>;
  checkpoints: Map<string, WorkflowCheckpoint<TState, TMessage>>;
  events: Map<string, WorkflowStreamEvent<TMessage>[]>;
  results: Map<string, JsonValue | undefined>;
}

export class InMemoryWorkflowStore<
  TState extends Record<string, unknown>,
  TMessage extends WorkflowUIMessage,
> implements WorkflowStore<TState, TMessage> {
  readonly state: InMemoryWorkflowStoreState<TState, TMessage> = {
    runs: new Map(),
    checkpoints: new Map(),
    events: new Map(),
    results: new Map(),
  };

  async createRun(record: WorkflowRunRecord<TState, TMessage>): Promise<void> {
    this.state.runs.set(record.runId, safeStructuredClone(record));
  }

  async markRunRunning(runId: string): Promise<void> {
    const run = this.state.runs.get(runId);

    if (!run) {
      return;
    }

    run.status = "running";
    run.updatedAt = new Date().toISOString();
  }

  async markRunCompleted(runId: string, result?: JsonValue): Promise<void> {
    const run = this.state.runs.get(runId);

    if (!run) {
      return;
    }

    run.status = "completed";
    run.updatedAt = new Date().toISOString();
    this.state.results.set(runId, safeStructuredClone(result));
  }

  async markRunFailed(
    runId: string,
    error: {
      message: string;
    },
  ): Promise<void> {
    const run = this.state.runs.get(runId);

    if (!run) {
      return;
    }

    run.status = "failed";
    run.updatedAt = new Date().toISOString();
    run.metadata = {
      ...(run.metadata ?? {}),
      lastError: error.message,
    };
  }

  async markRunPaused(runId: string, _pause: WorkflowPause): Promise<void> {
    const run = this.state.runs.get(runId);

    if (!run) {
      return;
    }

    run.status = "paused";
    run.updatedAt = new Date().toISOString();
  }

  async markRunAborted(runId: string, reason?: string): Promise<void> {
    const run = this.state.runs.get(runId);

    if (!run) {
      return;
    }

    run.status = "aborted";
    run.updatedAt = new Date().toISOString();
    run.metadata = {
      ...(run.metadata ?? {}),
      abortReason: reason ?? null,
    };
  }

  async appendEvent(
    runId: string,
    event: WorkflowStreamEvent<TMessage>,
  ): Promise<void> {
    const events = this.state.events.get(runId) ?? [];
    events.push(safeStructuredClone(event));
    this.state.events.set(runId, events);
  }

  async saveCheckpoint(
    checkpoint: WorkflowCheckpoint<TState, TMessage>,
  ): Promise<void> {
    this.state.checkpoints.set(
      checkpoint.runId,
      safeStructuredClone(checkpoint),
    );
  }

  async loadCheckpoint(
    runId: string,
  ): Promise<WorkflowCheckpoint<TState, TMessage> | null> {
    return safeStructuredClone(this.state.checkpoints.get(runId) ?? null);
  }

  getExecutionState(
    runId: string,
  ): WorkflowExecutionState<TState, TMessage> | null {
    const checkpoint = this.state.checkpoints.get(runId);
    return checkpoint ? safeStructuredClone(checkpoint.executionState) : null;
  }

  getState(runId: string): TState | null {
    const checkpoint = this.state.checkpoints.get(runId);
    return checkpoint
      ? safeStructuredClone(checkpoint.executionState.state)
      : null;
  }

  getEvents(runId: string): WorkflowStreamEvent<TMessage>[] {
    return safeStructuredClone(this.state.events.get(runId) ?? []);
  }
}

export function createInMemoryWorkflowStore<
  TState extends Record<string, unknown>,
  TMessage extends WorkflowUIMessage,
>(): InMemoryWorkflowStore<TState, TMessage> {
  return new InMemoryWorkflowStore<TState, TMessage>();
}

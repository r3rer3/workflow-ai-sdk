import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  JsonObject,
  JsonValue,
  WorkflowCheckpoint,
  WorkflowExecutionState,
  WorkflowPause,
  WorkflowRunRecord,
  WorkflowStore,
  WorkflowStreamEvent,
  WorkflowUIMessage,
} from "workflow-ai-sdk";

// Example-local WorkflowStore implementation backed by Supabase.
//
// Constructor takes an authenticated Supabase client plus the caller's
// auth.uid(). Every insert stamps `user_id` so Postgres RLS can enforce
// cross-tenant denial: forbidden rows are simply invisible to reads.
//
// This file intentionally lives under apps/examples (not packages/) so it
// can be copied into your own app and adapted. The core library exposes
// only the WorkflowStore interface — persistence is your concern.

function nowIso(): string {
  return new Date().toISOString();
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null) {
    return null;
  }

  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : null;
    case "bigint":
      return value.toString();
    case "undefined":
    case "function":
    case "symbol":
      return null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry));
  }

  if (typeof value !== "object") {
    return null;
  }

  if ("toJSON" in value && typeof value.toJSON === "function") {
    return toJsonValue(value.toJSON());
  }

  const result: Record<string, JsonValue> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) {
      continue;
    }

    result[key] = toJsonValue(entry);
  }

  return result;
}

export class SupabaseExampleWorkflowStore<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TMessage extends WorkflowUIMessage = WorkflowUIMessage,
> implements WorkflowStore<TState, TMessage> {
  constructor(
    private readonly client: SupabaseClient,
    private readonly userId: string,
  ) { }

  async createRun(record: WorkflowRunRecord<TState, TMessage>): Promise<void> {
    const { error } = await this.client.from("workflow_runs").insert({
      user_id: this.userId,
      workflow_name: record.workflowName,
      run_id: record.runId,
      thread_id: record.threadId,
      resource_id: record.resourceId,
      mode: record.mode,
      state: toJsonValue(record.executionState),
      status: record.status,
      metadata: toJsonValue(record.metadata ?? null),
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });

    if (error) {
      throw error;
    }
  }

  async markRunRunning(runId: string): Promise<void> {
    await this.updateRun(runId, {
      status: "running",
      updated_at: nowIso(),
    });
  }

  async markRunCompleted(runId: string, result?: JsonValue): Promise<void> {
    await this.updateRun(runId, {
      status: "completed",
      result: toJsonValue(result ?? null),
      updated_at: nowIso(),
    });
  }

  async markRunFailed(
    runId: string,
    error: { message: string },
  ): Promise<void> {
    await this.updateRun(runId, {
      status: "failed",
      metadata: { lastError: error.message },
      updated_at: nowIso(),
    });
  }

  async markRunPaused(runId: string, pause: WorkflowPause): Promise<void> {
    await this.updateRun(runId, {
      status: "paused",
      metadata: { pause: toJsonValue(pause) },
      updated_at: nowIso(),
    });
  }

  async markRunAborted(runId: string, reason?: string): Promise<void> {
    await this.updateRun(runId, {
      status: "aborted",
      metadata: { abortReason: reason ?? null },
      updated_at: nowIso(),
    });
  }

  async appendEvent(
    runId: string,
    event: WorkflowStreamEvent<TMessage>,
  ): Promise<void> {
    const { error } = await this.client.from("workflow_events").insert({
      user_id: this.userId,
      run_id: runId,
      event: toJsonValue(event),
    });

    if (error) {
      throw error;
    }
  }

  async saveCheckpoint(
    checkpoint: WorkflowCheckpoint<TState, TMessage>,
  ): Promise<void> {
    const { error } = await this.client.from("workflow_checkpoints").upsert({
      user_id: this.userId,
      workflow_name: checkpoint.workflowName,
      run_id: checkpoint.runId,
      mode: checkpoint.mode,
      thread_id: checkpoint.threadId,
      resource_id: checkpoint.resourceId,
      state: toJsonValue(checkpoint.executionState),
      pause: toJsonValue(checkpoint.pause ?? null),
      metadata: toJsonValue(checkpoint.metadata ?? null),
      runtime: toJsonValue(checkpoint.runtime ?? null),
      updated_at: checkpoint.updatedAt,
    });

    if (error) {
      throw error;
    }
  }

  async loadCheckpoint(
    runId: string,
  ): Promise<WorkflowCheckpoint<TState, TMessage> | null> {
    // RLS makes this safe by construction: if `runId` belongs to another
    // user, the select returns zero rows and we return null. The calling
    // route translates null into a 404 for the request.
    const { data, error } = await this.client
      .from("workflow_checkpoints")
      .select("*")
      .eq("run_id", runId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    return {
      workflowName: data.workflow_name as string,
      runId: data.run_id as string,
      mode: data.mode as WorkflowCheckpoint<TState, TMessage>["mode"],
      threadId: data.thread_id as string,
      resourceId: data.resource_id as string,
      executionState: data.state as WorkflowExecutionState<TState, TMessage>,
      pause: (data.pause ?? undefined) as WorkflowCheckpoint<
        TState,
        TMessage
      >["pause"],
      metadata: (data.metadata ?? undefined) as JsonObject | undefined,
      runtime: (data.runtime ?? undefined) as WorkflowCheckpoint<
        TState,
        TMessage
      >["runtime"],
      updatedAt: data.updated_at as string,
    };
  }

  private async updateRun(
    runId: string,
    patch: Record<string, JsonValue>,
  ): Promise<void> {
    const { error } = await this.client
      .from("workflow_runs")
      .update(patch)
      .eq("run_id", runId);

    if (error) {
      throw error;
    }
  }
}

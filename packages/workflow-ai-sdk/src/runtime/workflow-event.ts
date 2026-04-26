import type { StandardSchemaV1 } from "@standard-schema/spec";

export type WorkflowDispatchedEvent<
  TType extends string = string,
  TData = unknown,
> = {
  type: TType;
  data: TData;
};

export type WorkflowEventSchema<TInput, TOutput = TInput> = StandardSchemaV1<
  TInput,
  TOutput
>;

export interface WorkflowEventDefinition<TType extends string, TData> {
  readonly type: TType;
  readonly schema?: WorkflowEventSchema<unknown, TData>;
  create(
    ...args: [TData] extends [never] ? [] : [data: TData]
  ): WorkflowDispatchedEvent<TType, TData>;
  is(
    event: WorkflowDispatchedEvent<string, unknown>,
  ): event is WorkflowDispatchedEvent<TType, TData>;
}

const workflowEventInspectSymbol = Symbol.for("nodejs.util.inspect.custom");

function formatDebugValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatWorkflowEvent(
  event: WorkflowDispatchedEvent<string, unknown>,
): string {
  return event.data === undefined
    ? `WorkflowEvent(${JSON.stringify(event.type)})`
    : `WorkflowEvent(${JSON.stringify(event.type)}, data=${formatDebugValue(event.data)})`;
}

export function decorateWorkflowEvent<TType extends string, TData>(
  event: WorkflowDispatchedEvent<TType, TData>,
): WorkflowDispatchedEvent<TType, TData> {
  const __toString = () => formatWorkflowEvent(event);

  const inspect = (
    _depth?: number,
    _options?: unknown,
    customInspect?: (value: unknown) => string,
  ) =>
    event.data === undefined
      ? `WorkflowEvent(${JSON.stringify(event.type)})`
      : `WorkflowEvent(${JSON.stringify(event.type)}, data=${typeof customInspect === "function"
        ? customInspect(event.data)
        : formatDebugValue(event.data)
      })`;

  Object.defineProperty(event, "toString", {
    configurable: true,
    enumerable: false,
    value: __toString,
  });
  Object.defineProperty(event, "inspect", {
    configurable: true,
    enumerable: false,
    value: inspect,
  });
  Object.defineProperty(event, workflowEventInspectSymbol, {
    configurable: true,
    enumerable: false,
    value: inspect,
  });
  Object.defineProperty(event, Symbol.toPrimitive, {
    configurable: true,
    enumerable: false,
    value: __toString,
  });

  return event;
}

export function workflowEvent<TType extends string>(
  type: TType,
): WorkflowEventDefinition<TType, never>;
export function workflowEvent<
  TType extends string,
  TSchema extends WorkflowEventSchema<unknown, unknown>,
>(
  type: TType,
  schema: TSchema,
): WorkflowEventDefinition<TType, StandardSchemaV1.InferOutput<TSchema>>;
export function workflowEvent<TType extends string, TData = undefined>(
  type: TType,
  schema?: WorkflowEventSchema<unknown, TData>,
): WorkflowEventDefinition<TType, TData> {
  return {
    type,
    schema,
    create(...args) {
      return decorateWorkflowEvent({
        type,
        data: (args[0] ?? undefined) as TData,
      });
    },
    is(event): event is WorkflowDispatchedEvent<TType, TData> {
      return event.type === type;
    },
  };
}

export class WorkflowEventValidationError extends Error {
  readonly eventType: string;
  readonly issues: readonly StandardSchemaV1.Issue[];

  constructor(eventType: string, issues: readonly StandardSchemaV1.Issue[]) {
    super(
      `Workflow event ${JSON.stringify(eventType)} failed validation: ${formatValidationIssues(issues)}`,
    );
    this.name = "WorkflowEventValidationError";
    this.eventType = eventType;
    this.issues = issues;
  }
}

export async function validateWorkflowEvent<TType extends string, TData>(
  definition: WorkflowEventDefinition<TType, TData>,
  event: WorkflowDispatchedEvent<string, unknown>,
): Promise<WorkflowDispatchedEvent<TType, TData>> {
  if (event.type !== definition.type) {
    throw new Error(
      `Cannot validate workflow event ${JSON.stringify(event.type)} against ${JSON.stringify(definition.type)}.`,
    );
  }

  if (!definition.schema) {
    return decorateWorkflowEvent({
      type: definition.type,
      data: event.data as TData,
    });
  }

  const result = await definition.schema["~standard"].validate(event.data);

  if (result.issues) {
    throw new WorkflowEventValidationError(definition.type, result.issues);
  }

  return decorateWorkflowEvent({
    type: definition.type,
    data: result.value,
  });
}

function formatIssuePath(path: StandardSchemaV1.Issue["path"]): string | null {
  if (!path || path.length === 0) {
    return null;
  }

  const rendered = path
    .map((segment) => {
      if (typeof segment === "object" && segment !== null && "key" in segment) {
        return String(segment.key);
      }

      return String(segment);
    })
    .join(".");

  return rendered.length > 0 ? rendered : null;
}

function formatValidationIssues(
  issues: readonly StandardSchemaV1.Issue[],
): string {
  return issues
    .map((issue) => {
      const path = formatIssuePath(issue.path);
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

export type AnyWorkflowEventDefinition = WorkflowEventDefinition<any, any>;

export interface WorkflowAndExpression<
  TTriggers extends
  readonly WorkflowTriggerLike[] = readonly WorkflowTriggerLike[],
> {
  readonly kind: "and";
  readonly triggers: TTriggers;
}

export interface WorkflowOrExpression<
  TTriggers extends
  readonly WorkflowTriggerLike[] = readonly WorkflowTriggerLike[],
> {
  readonly kind: "or";
  readonly triggers: TTriggers;
}

export interface WorkflowOrderExpression<
  TTriggers extends
  readonly WorkflowTriggerLike[] = readonly WorkflowTriggerLike[],
> {
  readonly kind: "order";
  readonly triggers: TTriggers;
}

export type WorkflowTriggerExpression =
  | WorkflowAndExpression
  | WorkflowOrExpression
  | WorkflowOrderExpression;

export type WorkflowTriggerLike =
  | AnyWorkflowEventDefinition
  | WorkflowTriggerExpression
  | readonly WorkflowTriggerLike[];

type NormalizeWorkflowTriggerTuple<T extends readonly unknown[]> = {
  [K in keyof T]: T[K] extends WorkflowTriggerLike
  ? NormalizeWorkflowTrigger<T[K]>
  : never;
};

export type NormalizeWorkflowTrigger<T> = T extends AnyWorkflowEventDefinition
  ? T
  : T extends WorkflowAndExpression<infer TTriggers>
  ? WorkflowAndExpression<NormalizeWorkflowTriggerTuple<TTriggers>>
  : T extends WorkflowOrExpression<infer TTriggers>
  ? WorkflowOrExpression<NormalizeWorkflowTriggerTuple<TTriggers>>
  : T extends WorkflowOrderExpression<infer TTriggers>
  ? WorkflowOrderExpression<NormalizeWorkflowTriggerTuple<TTriggers>>
  : T extends readonly unknown[]
  ? WorkflowAndExpression<
    NormalizeWorkflowTriggerTuple<
      Extract<T, readonly WorkflowTriggerLike[]>
    >
  >
  : never;

export type WorkflowTriggerMatch<T> =
  T extends WorkflowEventDefinition<infer TType, infer TData>
  ? WorkflowDispatchedEvent<TType, TData>
  : T extends WorkflowAndExpression<infer TTriggers>
  ? {
    [K in keyof TTriggers]: WorkflowTriggerMatch<TTriggers[K]>;
  }
  : T extends WorkflowOrderExpression<infer TTriggers>
  ? {
    [K in keyof TTriggers]: WorkflowTriggerMatch<TTriggers[K]>;
  }
  : T extends WorkflowOrExpression<infer TTriggers>
  ? WorkflowTriggerMatch<TTriggers[number]>
  : never;

export type WorkflowStepInput<TTrigger extends WorkflowTriggerLike> =
  TTrigger extends WorkflowEventDefinition<any, infer TData>
  ? TData
  : WorkflowTriggerMatch<NormalizeWorkflowTrigger<TTrigger>>;

function normalizeTriggerList<
  const TTriggers extends readonly WorkflowTriggerLike[],
>(triggers: TTriggers): NormalizeWorkflowTriggerTuple<TTriggers> {
  return triggers.map((trigger) =>
    normalizeWorkflowTrigger(trigger),
  ) as NormalizeWorkflowTriggerTuple<TTriggers>;
}

export function isWorkflowEventDefinition(
  value: unknown,
): value is AnyWorkflowEventDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "create" in value &&
    "is" in value
  );
}

export function isWorkflowTriggerExpression(
  value: unknown,
): value is WorkflowTriggerExpression {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "triggers" in value &&
    Array.isArray(value.triggers) &&
    (value.kind === "and" || value.kind === "or" || value.kind === "order")
  );
}

export function normalizeWorkflowTrigger<T extends WorkflowTriggerLike>(
  trigger: T,
): NormalizeWorkflowTrigger<T> {
  if (Array.isArray(trigger)) {
    return And(trigger) as NormalizeWorkflowTrigger<T>;
  }

  if (isWorkflowTriggerExpression(trigger)) {
    switch (trigger.kind) {
      case "and":
        return And(trigger.triggers) as NormalizeWorkflowTrigger<T>;
      case "or":
        return Or(trigger.triggers) as NormalizeWorkflowTrigger<T>;
      case "order":
        return Order(trigger.triggers) as NormalizeWorkflowTrigger<T>;
    }
  }

  return trigger as NormalizeWorkflowTrigger<T>;
}

export function And<const TTriggers extends readonly WorkflowTriggerLike[]>(
  triggers: TTriggers,
): WorkflowAndExpression<NormalizeWorkflowTriggerTuple<TTriggers>> {
  return {
    kind: "and",
    triggers: normalizeTriggerList(triggers),
  };
}

export function Or<const TTriggers extends readonly WorkflowTriggerLike[]>(
  triggers: TTriggers,
): WorkflowOrExpression<NormalizeWorkflowTriggerTuple<TTriggers>> {
  return {
    kind: "or",
    triggers: normalizeTriggerList(triggers),
  };
}

export function Order<const TTriggers extends readonly WorkflowTriggerLike[]>(
  triggers: TTriggers,
): WorkflowOrderExpression<NormalizeWorkflowTriggerTuple<TTriggers>> {
  return {
    kind: "order",
    triggers: normalizeTriggerList(triggers),
  };
}

export function describeWorkflowTrigger(trigger: WorkflowTriggerLike): string {
  const normalized = normalizeWorkflowTrigger(trigger);

  if (isWorkflowEventDefinition(normalized)) {
    return normalized.type;
  }

  const children = normalized.triggers
    .map((child) => describeWorkflowTrigger(child))
    .join(", ");

  return `${normalized.kind}(${children})`;
}

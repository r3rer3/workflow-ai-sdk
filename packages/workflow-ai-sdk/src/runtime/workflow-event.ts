import type { StandardSchemaV1 } from "@standard-schema/spec";

export type WorkflowDispatchedEvent<
  TType extends string = string,
  TData = unknown,
> = {
  type: TType;
  data: TData;
};

export type WorkflowEventSchema<
  TInput = unknown,
  TOutput = TInput,
> = StandardSchemaV1<TInput, TOutput>;

export interface WorkflowEventDefinition<
  TType extends string = string,
  TData = unknown,
> {
  readonly type: TType;
  readonly schema?: WorkflowEventSchema<unknown, TData>;
  create: (
    ...args: [TData] extends [never] ? [] : [data: TData]
  ) => WorkflowDispatchedEvent<TType, TData>;
  is: (
    event: WorkflowDispatchedEvent<string, unknown>,
  ) => event is WorkflowDispatchedEvent<TType, TData>;
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

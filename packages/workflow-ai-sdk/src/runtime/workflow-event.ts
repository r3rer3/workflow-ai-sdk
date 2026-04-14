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

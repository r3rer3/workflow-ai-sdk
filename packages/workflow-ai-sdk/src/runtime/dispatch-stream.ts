import type {
  WorkflowDispatchOperation,
  WorkflowDispatchStream,
} from "./types";
import type {
  WorkflowDispatchedEvent,
  WorkflowEventDefinition,
} from "./workflow-event";

export interface DispatchTraceRecord {
  id: number;
  parentId?: number;
  ancestors: number[];
  event: WorkflowDispatchedEvent;
}

interface DispatchTraceSubscriber {
  next: (record: DispatchTraceRecord) => void;
  close: () => void;
  error: (error: Error) => void;
}

type DispatchTracePredicate = (record: DispatchTraceRecord) => boolean;
type EventPredicate = (event: WorkflowDispatchedEvent) => boolean;

function toEventPredicate(
  predicate:
    | WorkflowEventDefinition<string, unknown>
    | ((event: WorkflowDispatchedEvent) => boolean),
): EventPredicate {
  if (typeof predicate === "function") {
    return predicate;
  }

  return (event) => predicate.is(event);
}

export class WorkflowExecutionInterruptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowExecutionInterruptedError";
  }
}

export class DispatchTraceSource {
  private readonly history: DispatchTraceRecord[] = [];
  private readonly subscribers = new Set<DispatchTraceSubscriber>();
  private closed = false;
  private failure?: Error;

  get size(): number {
    return this.history.length;
  }

  publish(record: DispatchTraceRecord): void {
    if (this.closed) {
      return;
    }

    this.history.push(record);

    for (const subscriber of this.subscribers) {
      subscriber.next(record);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;

    for (const subscriber of this.subscribers) {
      subscriber.close();
    }

    this.subscribers.clear();
  }

  interrupt(error: Error): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.failure = error;

    for (const subscriber of this.subscribers) {
      subscriber.error(error);
    }

    this.subscribers.clear();
  }

  subscribe(
    subscriber: DispatchTraceSubscriber,
    startIndex: number,
  ): () => void {
    const replay = this.history.slice(startIndex);

    for (const record of replay) {
      subscriber.next(record);
    }

    if (this.closed) {
      if (this.failure) {
        subscriber.error(this.failure);
      } else {
        subscriber.close();
      }

      return () => {};
    }

    this.subscribers.add(subscriber);

    return () => {
      this.subscribers.delete(subscriber);
    };
  }
}

class WorkflowDispatchStreamImpl
  implements WorkflowDispatchStream<WorkflowDispatchedEvent>
{
  constructor(
    private readonly source: DispatchTraceSource,
    private readonly startIndex: number,
    private readonly recordFilter: DispatchTracePredicate,
    private readonly eventFilter: EventPredicate,
    private readonly stopWhen?: EventPredicate,
  ) {}

  filter<TType extends string, TData>(
    event: WorkflowEventDefinition<TType, TData>,
  ): WorkflowDispatchStream<WorkflowDispatchedEvent<TType, TData>>;
  filter(
    predicate: (event: WorkflowDispatchedEvent) => boolean,
  ): WorkflowDispatchStream<WorkflowDispatchedEvent>;
  filter(
    predicate:
      | WorkflowEventDefinition<string, unknown>
      | ((event: WorkflowDispatchedEvent) => boolean),
  ): WorkflowDispatchStream {
    const eventFilter = toEventPredicate(predicate);

    return new WorkflowDispatchStreamImpl(
      this.source,
      this.startIndex,
      this.recordFilter,
      (event) => this.eventFilter(event) && eventFilter(event),
      this.stopWhen,
    );
  }

  until<TType extends string, TData>(
    event: WorkflowEventDefinition<TType, TData>,
  ): WorkflowDispatchStream;
  until(
    predicate: (event: WorkflowDispatchedEvent) => boolean,
  ): WorkflowDispatchStream;
  until(
    predicate:
      | WorkflowEventDefinition<string, unknown>
      | ((event: WorkflowDispatchedEvent) => boolean),
  ): WorkflowDispatchStream {
    const stopWhen = toEventPredicate(predicate);

    return new WorkflowDispatchStreamImpl(
      this.source,
      this.startIndex,
      this.recordFilter,
      this.eventFilter,
      (event) => (this.stopWhen?.(event) ?? false) || stopWhen(event),
    );
  }

  async toArray(): Promise<WorkflowDispatchedEvent[]> {
    const values: WorkflowDispatchedEvent[] = [];

    for await (const event of this) {
      values.push(event);
    }

    return values;
  }

  toAsyncIterator(): AsyncIterator<WorkflowDispatchedEvent, void> {
    return this[Symbol.asyncIterator]();
  }

  [Symbol.asyncIterator](): AsyncIterator<WorkflowDispatchedEvent, void> {
    const queue: WorkflowDispatchedEvent[] = [];
    const waiters: Array<{
      resolve: (value: IteratorResult<WorkflowDispatchedEvent, void>) => void;
      reject: (reason: unknown) => void;
    }> = [];
    let unsubscribe = () => {};
    let done = false;
    let failure: Error | null = null;

    const close = () => {
      if (done) {
        return;
      }

      done = true;
      unsubscribe();

      while (waiters.length > 0) {
        waiters.shift()?.resolve({
          done: true,
          value: undefined,
        });
      }
    };

    const fail = (error: Error) => {
      if (done) {
        return;
      }

      done = true;
      failure = error;
      unsubscribe();

      while (waiters.length > 0) {
        waiters.shift()?.reject(error);
      }
    };

    const push = (event: WorkflowDispatchedEvent) => {
      if (done) {
        return;
      }

      if (waiters.length > 0) {
        waiters.shift()?.resolve({
          done: false,
          value: event,
        });
      } else {
        queue.push(event);
      }

      if (this.stopWhen?.(event)) {
        close();
      }
    };

    unsubscribe = this.source.subscribe(
      {
        next: (record) => {
          if (!this.recordFilter(record)) {
            return;
          }

          const event = record.event;

          if (!this.eventFilter(event)) {
            return;
          }

          push(event);
        },
        close,
        error: fail,
      },
      this.startIndex,
    );

    return {
      next: () => {
        if (queue.length > 0) {
          // biome-ignore lint/style/noNonNullAssertion: length check guarantees shift() won't return undefined
          const value = queue.shift()!;

          return Promise.resolve({
            done: false,
            value,
          });
        }

        if (done) {
          if (failure) {
            return Promise.reject(failure);
          }

          return Promise.resolve({
            done: true,
            value: undefined,
          });
        }

        return new Promise((resolve, reject) => {
          waiters.push({
            resolve,
            reject,
          });
        });
      },
      return: async () => {
        close();

        return {
          done: true,
          value: undefined,
        };
      },
      throw: async (error) => {
        fail(
          error instanceof Error
            ? error
            : new Error(String(error ?? "Unknown error")),
        );

        return Promise.reject(error);
      },
    };
  }
}

export function createWorkflowDispatchStream(args: {
  source: DispatchTraceSource;
  startIndex: number;
  scope: DispatchTracePredicate;
}): WorkflowDispatchStream {
  return new WorkflowDispatchStreamImpl(
    args.source,
    args.startIndex,
    args.scope,
    () => true,
  );
}

export function createDispatchOperation(args: {
  done: Promise<void>;
  stream: WorkflowDispatchStream;
}): WorkflowDispatchOperation {
  return Object.assign(args.done, {
    done: args.done,
    stream: args.stream,
  });
}

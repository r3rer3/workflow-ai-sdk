import { describe, expect, it } from "bun:test";
import { workflowEvent } from "../index";
import type { DispatchTraceRecord } from "./dispatch-stream";
import {
  createDispatchOperation,
  createWorkflowDispatchStream,
  DispatchTraceSource,
  WorkflowExecutionInterruptedError,
} from "./dispatch-stream";

function record(id: number, type: string, data?: unknown): DispatchTraceRecord {
  return { id, ancestors: [], event: { type, data } };
}

describe("DispatchTraceSource", () => {
  it("publish adds records and notifies subscribers", () => {
    const source = new DispatchTraceSource();
    const received: DispatchTraceRecord[] = [];

    source.subscribe(
      {
        next: (r) => received.push(r),
        close: () => {},
        error: () => {},
      },
      0,
    );

    const r1 = record(0, "a", 1);
    const r2 = record(1, "b", 2);
    source.publish(r1);
    source.publish(r2);

    expect(received).toEqual([r1, r2]);
    expect(source.size).toBe(2);
  });

  it("close signals completion, prevents further publishes, is idempotent", () => {
    const source = new DispatchTraceSource();
    let closedCount = 0;

    source.subscribe(
      {
        next: () => {},
        close: () => {
          closedCount++;
        },
        error: () => {},
      },
      0,
    );

    source.close();
    // Idempotent: calling close again should not trigger subscriber again
    // (subscribers are cleared on first close)
    source.close();

    expect(closedCount).toBe(1);

    // Publishes after close are silently ignored
    source.publish(record(0, "x"));
    expect(source.size).toBe(0);
  });

  it("interrupt signals error to subscribers, is idempotent", () => {
    const source = new DispatchTraceSource();
    const errors: Error[] = [];

    source.subscribe(
      {
        next: () => {},
        close: () => {},
        error: (err) => {
          errors.push(err);
        },
      },
      0,
    );

    const err = new WorkflowExecutionInterruptedError("boom");
    source.interrupt(err);
    // Idempotent: second call should not notify again
    source.interrupt(new Error("second"));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(err);

    // Publishes after interrupt are silently ignored
    source.publish(record(0, "x"));
    expect(source.size).toBe(0);
  });

  it("subscribe replays history from startIndex", () => {
    const source = new DispatchTraceSource();
    source.publish(record(0, "a"));
    source.publish(record(1, "b"));
    source.publish(record(2, "c"));

    const received: DispatchTraceRecord[] = [];
    source.subscribe(
      {
        next: (r) => received.push(r),
        close: () => {},
        error: () => {},
      },
      1,
    );

    // Should replay records at index 1 and 2 (not 0)
    expect(received).toHaveLength(2);
    expect(received[0]?.event.type).toBe("b");
    expect(received[1]?.event.type).toBe("c");
  });

  it("subscribe to already-closed source replays and immediately closes", () => {
    const source = new DispatchTraceSource();
    source.publish(record(0, "a"));
    source.close();

    const received: DispatchTraceRecord[] = [];
    let closed = false;

    source.subscribe(
      {
        next: (r) => received.push(r),
        close: () => {
          closed = true;
        },
        error: () => {},
      },
      0,
    );

    expect(received).toHaveLength(1);
    expect(received[0]?.event.type).toBe("a");
    expect(closed).toBe(true);
  });

  it("subscribe to already-interrupted source replays and immediately errors", () => {
    const source = new DispatchTraceSource();
    source.publish(record(0, "a"));
    const err = new WorkflowExecutionInterruptedError("fail");
    source.interrupt(err);

    const received: DispatchTraceRecord[] = [];
    let receivedError: unknown = null;

    source.subscribe(
      {
        next: (r) => received.push(r),
        close: () => {},
        error: (e) => {
          receivedError = e;
        },
      },
      0,
    );

    expect(received).toHaveLength(1);
    expect(received[0]?.event.type).toBe("a");
    expect(receivedError).toBe(err);
  });

  it("size reflects published record count", () => {
    const source = new DispatchTraceSource();
    expect(source.size).toBe(0);

    source.publish(record(0, "x"));
    expect(source.size).toBe(1);

    source.publish(record(1, "y"));
    expect(source.size).toBe(2);
  });

  it("unsubscribe function removes subscriber", () => {
    const source = new DispatchTraceSource();
    const received: DispatchTraceRecord[] = [];
    let closed = false;

    const unsub = source.subscribe(
      {
        next: (r) => received.push(r),
        close: () => {
          closed = true;
        },
        error: () => {},
      },
      0,
    );

    source.publish(record(0, "a"));
    expect(received).toHaveLength(1);

    unsub();

    // After unsubscribe, no more notifications
    source.publish(record(1, "b"));
    expect(received).toHaveLength(1);

    // Closing source should not reach removed subscriber
    source.close();
    expect(closed).toBe(false);
  });
});

describe("WorkflowDispatchStream", () => {
  it("iterates events matching scope predicate", async () => {
    const source = new DispatchTraceSource();
    const stream = createWorkflowDispatchStream({
      source,
      startIndex: 0,
      scope: (r) => r.id % 2 === 0,
    });

    source.publish(record(0, "even"));
    source.publish(record(1, "odd"));
    source.publish(record(2, "even-again"));
    source.close();

    const events: Array<{ type: string }> = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("even");
    expect(events[1]?.type).toBe("even-again");
  });

  it("toArray collects all matching events", async () => {
    const source = new DispatchTraceSource();
    const stream = createWorkflowDispatchStream({
      source,
      startIndex: 0,
      scope: () => true,
    });

    source.publish(record(0, "a", 1));
    source.publish(record(1, "b", 2));
    source.publish(record(2, "c", 3));
    source.close();

    const events = await stream.toArray();

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.type)).toEqual(["a", "b", "c"]);
  });

  it("filter by event definition narrows stream", async () => {
    const fooEvent = workflowEvent("foo");

    const source = new DispatchTraceSource();
    const stream = createWorkflowDispatchStream({
      source,
      startIndex: 0,
      scope: () => true,
    });

    const filtered = stream.filter(fooEvent);

    source.publish(record(0, "foo", "hello"));
    source.publish(record(1, "bar", "world"));
    source.publish(record(2, "foo", "again"));
    source.close();

    const events = await filtered.toArray();

    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("foo");
    expect(events[1]?.type).toBe("foo");
  });

  it("filter by predicate narrows stream", async () => {
    const source = new DispatchTraceSource();
    const stream = createWorkflowDispatchStream({
      source,
      startIndex: 0,
      scope: () => true,
    });

    const filtered = stream.filter((event) => event.data === "keep");

    source.publish(record(0, "a", "keep"));
    source.publish(record(1, "b", "drop"));
    source.publish(record(2, "c", "keep"));
    source.close();

    const events = await filtered.toArray();

    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("a");
    expect(events[1]?.type).toBe("c");
  });

  it("chaining multiple filter calls applies AND logic", async () => {
    const source = new DispatchTraceSource();
    const stream = createWorkflowDispatchStream({
      source,
      startIndex: 0,
      scope: () => true,
    });

    const filtered = stream
      .filter((event) => event.type.startsWith("x"))
      .filter((event) => (event.data as number) > 5);

    source.publish(record(0, "x-low", 2));
    source.publish(record(1, "y-high", 10));
    source.publish(record(2, "x-high", 10));
    source.publish(record(3, "x-mid", 3));
    source.close();

    const events = await filtered.toArray();

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("x-high");
    expect(events[0]?.data).toBe(10);
  });

  it("until stops iteration at the matching event", async () => {
    const stopEvent = workflowEvent("stop");

    const source = new DispatchTraceSource();
    const stream = createWorkflowDispatchStream({
      source,
      startIndex: 0,
      scope: () => true,
    });

    const bounded = stream.until(stopEvent);

    source.publish(record(0, "a"));
    source.publish(record(1, "b"));
    source.publish(record(2, "stop"));
    source.publish(record(3, "c")); // should not appear
    source.close();

    const events = await bounded.toArray();

    // The stop event itself is yielded, then iteration ends
    expect(events).toHaveLength(3);
    expect(events[0]?.type).toBe("a");
    expect(events[1]?.type).toBe("b");
    expect(events[2]?.type).toBe("stop");
  });

  it("combining filter and until", async () => {
    const stopEvent = workflowEvent("done");

    const source = new DispatchTraceSource();
    const stream = createWorkflowDispatchStream({
      source,
      startIndex: 0,
      scope: () => true,
    });

    const bounded = stream
      .filter((event) => event.type !== "noise")
      .until(stopEvent);

    source.publish(record(0, "a"));
    source.publish(record(1, "noise"));
    source.publish(record(2, "b"));
    source.publish(record(3, "done"));
    source.publish(record(4, "c")); // after until, should not appear
    source.close();

    const events = await bounded.toArray();

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.type)).toEqual(["a", "b", "done"]);
  });

  it("empty source yields empty iteration", async () => {
    const source = new DispatchTraceSource();
    const stream = createWorkflowDispatchStream({
      source,
      startIndex: 0,
      scope: () => true,
    });

    source.close();

    const events = await stream.toArray();
    expect(events).toHaveLength(0);
  });

  it("interrupted source propagates error through async iteration", async () => {
    const source = new DispatchTraceSource();
    const stream = createWorkflowDispatchStream({
      source,
      startIndex: 0,
      scope: () => true,
    });

    source.publish(record(0, "a"));
    const err = new WorkflowExecutionInterruptedError("interrupted");
    source.interrupt(err);

    const events: Array<{ type: string }> = [];
    let caughtError: Error | null = null;

    try {
      for await (const event of stream) {
        events.push(event);
      }
    } catch (e) {
      caughtError = e as Error;
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("a");
    expect(caughtError).toBe(err);
    expect(caughtError).toBeInstanceOf(WorkflowExecutionInterruptedError);
  });

  it("iterator return() unsubscribes cleanly", async () => {
    const source = new DispatchTraceSource();
    const stream = createWorkflowDispatchStream({
      source,
      startIndex: 0,
      scope: () => true,
    });

    source.publish(record(0, "a"));
    source.publish(record(1, "b"));

    const events: Array<{ type: string }> = [];
    for await (const event of stream) {
      events.push(event);
      if (event.type === "a") {
        break; // triggers iterator return()
      }
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("a");

    // Source can still be closed without issue (subscriber was removed)
    source.close();
  });

  it("events published after subscribe but before iteration are queued", async () => {
    const source = new DispatchTraceSource();
    const stream = createWorkflowDispatchStream({
      source,
      startIndex: 0,
      scope: () => true,
    });

    // Start the iterator (which subscribes internally)
    const iterator = stream.toAsyncIterator();

    // Publish events before we call next()
    source.publish(record(0, "queued-1"));
    source.publish(record(1, "queued-2"));
    source.close();

    const r1 = await iterator.next();
    const r2 = await iterator.next();
    const r3 = await iterator.next();

    expect(r1.done).toBe(false);
    expect(r1.value?.type).toBe("queued-1");

    expect(r2.done).toBe(false);
    expect(r2.value?.type).toBe("queued-2");

    expect(r3.done).toBe(true);
  });

  it("events published while next() is waiting resolve waiters directly", async () => {
    const source = new DispatchTraceSource();
    const stream = createWorkflowDispatchStream({
      source,
      startIndex: 0,
      scope: () => true,
    });

    const iterator = stream.toAsyncIterator();

    const pendingEvent = iterator.next();
    source.publish(record(0, "direct-to-waiter"));

    const eventResult = await pendingEvent;
    expect(eventResult.done).toBe(false);
    expect(eventResult.value?.type).toBe("direct-to-waiter");

    const pendingDone = iterator.next();
    source.close();

    const doneResult = await pendingDone;
    expect(doneResult).toEqual({
      done: true,
      value: undefined,
    });
  });
});

describe("createDispatchOperation", () => {
  it("preserves promise identity and fulfillment behavior", async () => {
    const source = new DispatchTraceSource();
    const stream = createWorkflowDispatchStream({
      source,
      startIndex: 0,
      scope: () => true,
    });

    let resolveDone: (() => void) | undefined;
    const donePromise = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const operation = createDispatchOperation({
      done: donePromise,
      stream,
    });

    expect(Object.is(operation, donePromise)).toBe(true);
    expect(typeof operation.then).toBe("function");
    expect(operation.done).toBe(donePromise);
    expect(operation.stream).toBe(stream);

    source.close();
    resolveDone?.();

    expect(operation).resolves.toBeUndefined();
    expect(operation.done).resolves.toBeUndefined();
    expect(operation.then(() => "fulfilled")).resolves.toBe("fulfilled");
  });

  it("preserves rejection behavior and attached stream metadata", async () => {
    const source = new DispatchTraceSource();
    const stream = createWorkflowDispatchStream({
      source,
      startIndex: 0,
      scope: () => true,
    });
    const error = new Error("dispatch failed");
    const donePromise = Promise.reject<void>(error);

    void donePromise.catch(() => {});

    const operation = createDispatchOperation({
      done: donePromise,
      stream,
    });

    expect(Object.is(operation, donePromise)).toBe(true);
    expect(operation.done).toBe(donePromise);
    expect(operation.stream).toBe(stream);

    expect(operation).rejects.toBe(error);
    expect(operation.done).rejects.toBe(error);
  });
});

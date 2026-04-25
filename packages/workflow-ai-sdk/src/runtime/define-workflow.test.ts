import { describe, expect, it } from "bun:test";
import { z } from "zod";

import type { WorkflowStreamEvent, WorkflowUIMessage } from "../index";
import {
  And,
  createInMemoryWorkflowStore,
  defineWorkflow,
  Or,
  Order,
  pauseWorkflow,
  workflowEvent,
} from "../index";

type Equal<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2
  ? true
  : false;

type Expect<T extends true> = T;

async function collectStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const values: T[] = [];

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    values.push(value);
  }

  return values;
}

describe("defineWorkflow", () => {
  it("keeps workflow state native across multiple step boundaries", async () => {
    const startEvent = workflowEvent(
      "start",
      z.object({
        seed: z.number(),
      }),
    );
    const incrementEvent = workflowEvent("increment");
    const endEvent = workflowEvent(
      "end",
      z.object({
        total: z.number(),
      }),
    );

    const workflow = defineWorkflow({
      name: "native-state",
      trigger: startEvent,
      finish: endEvent,
      initialState({ input }) {
        const seed = input.seed;

        return {
          all: seed,
        };
      },
    })
      .step(startEvent, (context, _e) => {
        context.state.all += 1;
        return incrementEvent.create();
      })
      .step(incrementEvent, (context) => {
        context.state.all += 2;
        return endEvent.create({
          total: context.state.all,
        });
      });

    type InferredInput = Parameters<typeof workflow.run>[0]["input"];
    type InferredResult = ReturnType<typeof workflow.finish.create>["data"];
    type _InputMatchesTrigger = Expect<Equal<InferredInput, { seed: number }>>;
    type _ResultMatchesFinish = Expect<
      Equal<InferredResult, { total: number }>
    >;

    const execution = await workflow.run({
      input: {
        seed: 2,
      },
      mode: "abortable",
    });

    const events = await collectStream(execution.stream);

    expect(events.map((event) => event.type)).toEqual([
      "workflow-start",
      "workflow-step",
      "workflow-step",
      "workflow-end",
    ]);

    expect(events.at(-1)).toMatchObject({
      type: "workflow-end",
      data: {
        result: {
          total: 5,
        },
      },
    });
  });

  it("infers no-payload trigger and finish events as never", () => {
    const startEvent = workflowEvent("start");
    const endEvent = workflowEvent("end");
    const workflow = defineWorkflow({
      name: "no-payload",
      trigger: startEvent,
      finish: endEvent,
      initialState() {
        return {
          total: 0,
        };
      },
    }).step(startEvent, (context) => {
      context.state.total += 1;
      return endEvent.create();
    });

    type RunOptions = Parameters<typeof workflow.run>[0];
    type _InputIsOmitted = Expect<
      Equal<"input" extends keyof RunOptions ? true : false, false>
    >;
    type InferredResult = ReturnType<typeof workflow.finish.create>["data"];
    type _ResultIsNever = Expect<Equal<InferredResult, never>>;

    expect(workflow.finish.create().type).toBe("end");
  });

  it("fails the run when a step dispatches an invalid event payload", async () => {
    const startEvent = workflowEvent("start");
    const nextEvent = workflowEvent(
      "next",
      z.object({
        amount: z.number(),
      }),
    );
    const endEvent = workflowEvent(
      "end",
      z.object({
        total: z.number(),
      }),
    );

    const workflow = defineWorkflow({
      name: "invalid-dispatch",
      trigger: startEvent,
      finish: endEvent,
      initialState() {
        return {
          total: 0,
        };
      },
    })
      .step(startEvent, () =>
        nextEvent.create({
          amount: "bad",
        } as unknown as { amount: number }),
      )
      .step(nextEvent, (context, event) =>
        endEvent.create({
          total: context.state.total + event.amount,
        }),
      );

    const execution = await workflow.run({
      mode: "abortable",
    });
    const events = await collectStream(execution.stream);

    expect(events.map((event) => event.type)).toEqual([
      "workflow-start",
      "workflow-step",
      "workflow-error",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "workflow-error",
      data: {
        retryable: false,
      },
    });
  });

  it("reports validation errors for invalid run input before any step executes", async () => {
    const startEvent = workflowEvent(
      "start",
      z.object({
        prompt: z.string(),
      }),
    );
    const endEvent = workflowEvent("end");

    let initialStateCalls = 0;
    let stepCalls = 0;

    const workflow = defineWorkflow({
      name: "invalid-run-input",
      trigger: startEvent,
      finish: endEvent,
      initialState({ input }) {
        initialStateCalls += 1;

        return {
          count: input.prompt.length,
        };
      },
    }).step(startEvent, () => {
      stepCalls += 1;
    });

    const execution = await workflow.run({
      input: {
        prompt: 123,
      } as unknown as { prompt: string },
      mode: "abortable",
    });
    const events = await collectStream(execution.stream);

    expect(events.map((event) => event.type)).toEqual([
      "workflow-start",
      "workflow-error",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "workflow-error",
      data: {
        retryable: false,
      },
    });
    expect(initialStateCalls).toBe(0);
    expect(stepCalls).toBe(0);
  });

  it("fails resume when the resume event payload does not satisfy the schema", async () => {
    const startEvent = workflowEvent(
      "start",
      z.object({
        task: z.string(),
      }),
    );
    const approvalEvent = workflowEvent(
      "approval",
      z.object({
        approved: z.boolean(),
      }),
    );
    const endEvent = workflowEvent(
      "end",
      z.object({
        approved: z.boolean(),
      }),
    );
    const store = createInMemoryWorkflowStore<
      {
        approved: boolean;
      },
      WorkflowUIMessage
    >();

    const workflow = defineWorkflow({
      name: "invalid-resume-event",
      trigger: startEvent,
      finish: endEvent,
      initialState() {
        return {
          approved: false,
        };
      },
    })
      .step(startEvent, () =>
        pauseWorkflow({
          reason: "approval-required",
        }),
      )
      .step(approvalEvent, (_context, event) =>
        endEvent.create({
          approved: event.approved,
        }),
      );

    const firstExecution = await workflow.run({
      input: {
        task: "review",
      },
      mode: "resumable",
      store,
    });

    const eventsOnPause = await collectStream(firstExecution.stream);
    expect(eventsOnPause.map((event) => event.type)).toEqual([
      "workflow-start",
      "workflow-step",
      "workflow-paused",
    ]);

    expect(store.state.runs.get(firstExecution.runId)?.status).toBe("paused");
    expect(
      (await store.loadCheckpoint(firstExecution.runId))?.pause,
    ).toMatchObject({
      kind: "pause",
      reason: "approval-required",
    });

    const resumed = await workflow.resume({
      runId: firstExecution.runId,
      store,
      event: approvalEvent.create({
        approved: "yes",
      } as unknown as { approved: boolean }),
    });
    const resumedEvents = await collectStream(resumed.stream);

    expect(resumedEvents.map((event) => event.type)).toEqual([
      "workflow-start",
      "workflow-error",
    ]);
    expect(resumedEvents.at(-1)).toMatchObject({
      type: "workflow-error",
      data: {
        retryable: false,
      },
    });
    expect(store.state.runs.get(firstExecution.runId)?.status).toBe("failed");
  });

  it("runs a workflow end to end and persists resumable checkpoints", async () => {
    const startEvent = workflowEvent(
      "start",
      z.object({
        prompt: z.string(),
      }),
    );
    const nextEvent = workflowEvent(
      "next",
      z.object({
        prompt: z.string(),
      }),
    );
    const endEvent = workflowEvent(
      "end",
      z.object({
        text: z.string(),
      }),
    );
    const store = createInMemoryWorkflowStore<
      {
        count: number;
      },
      WorkflowUIMessage
    >();

    const workflow = defineWorkflow({
      name: "example-workflow",
      trigger: startEvent,
      finish: endEvent,
      initialState({ input }) {
        return {
          count: input.prompt.length - input.prompt.length,
        };
      },
    })
      .step(startEvent, (context, event) => {
        context.state.count += 1;
        context.emit({
          type: "custom-event",
          data: {
            name: "progress",
            data: {
              prompt: event.prompt,
              count: context.state.count,
            },
            hierarchy: context.getHierarchy(),
          },
        });

        return nextEvent.create({
          prompt: event.prompt,
        });
      })
      .step(nextEvent, (context, event) => {
        return endEvent.create({
          text: `${event.prompt}:${context.state.count}`,
        });
      });

    const execution = await workflow.run({
      input: {
        prompt: "hello",
      },
      mode: "resumable",
      store,
    });

    const events = await collectStream(execution.stream);

    expect(events.map((event) => event.type)).toEqual([
      "workflow-start",
      "workflow-step",
      "custom-event",
      "workflow-step",
      "workflow-end",
    ]);

    expect(store.getEvents(execution.runId).map((e) => e.type)).toEqual([
      "workflow-start",
      "workflow-step",
      "custom-event",
      "workflow-step",
      "workflow-end",
    ]);

    expect(store.state.runs.get(execution.runId)?.status).toBe("completed");
    expect(store.state.results.get(execution.runId)).toEqual({
      text: "hello:1",
    });

    expect(store.getState(execution.runId)?.count).toBe(1);
  });

  it("pauses and resumes from the saved checkpoint", async () => {
    const startEvent = workflowEvent(
      "start",
      z.object({
        task: z.string(),
      }),
    );
    const approvalEvent = workflowEvent(
      "approval",
      z.object({
        approved: z.boolean(),
      }),
    );
    const endEvent = workflowEvent(
      "end",
      z.object({
        approved: z.boolean(),
      }),
    );

    const store = createInMemoryWorkflowStore<
      {
        approved: boolean;
      },
      WorkflowUIMessage
    >();

    const workflow = defineWorkflow({
      name: "approval-workflow",
      trigger: startEvent,
      finish: endEvent,
      initialState() {
        return {
          approved: false,
        };
      },
    })
      .step(startEvent, () =>
        pauseWorkflow({
          reason: "approval-required",
          payload: {
            task: "review",
          },
        }),
      )
      .step(approvalEvent, (context, event) => {
        context.state.approved = event.approved;

        return endEvent.create({
          approved: event.approved,
        });
      });

    const firstExecution = await workflow.run({
      input: {
        task: "review",
      },
      mode: "resumable",
      store,
    });

    const firstEvents = await collectStream(firstExecution.stream);

    expect(firstEvents.at(-1)?.type).toBe("workflow-paused");
    expect(store.state.runs.get(firstExecution.runId)?.status).toBe("paused");

    const resumed = await workflow.resume({
      runId: firstExecution.runId,
      store,
      event: approvalEvent.create({
        approved: true,
      }),
    });

    const resumedEvents = await collectStream(resumed.stream);

    expect(resumedEvents.map((event) => event.type)).toEqual([
      "workflow-start",
      "workflow-step",
      "workflow-end",
    ]);
    expect(store.getState(firstExecution.runId)?.approved).toBe(true);
    expect(store.state.runs.get(firstExecution.runId)?.status).toBe(
      "completed",
    );
  });

  it("supports abortable workflows with native state", async () => {
    const startEvent = workflowEvent("start");
    const endEvent = workflowEvent("end");

    const workflow = defineWorkflow({
      name: "abortable-workflow",
      trigger: startEvent,
      finish: endEvent,
      initialState(): Record<string, never> {
        return {};
      },
    }).step(startEvent, async (context) => {
      while (!context.signal.aborted) {
        await Bun.sleep(10);
      }
    });

    const execution = await workflow.run({
      mode: "abortable",
    });

    const reader = execution.stream.getReader();
    const evs: WorkflowStreamEvent<WorkflowUIMessage>[] = [];

    const first = await reader.read();
    if (!first.done) {
      evs.push(first.value);
    }

    const second = await reader.read();
    if (!second.done) {
      evs.push(second.value);
      execution.cancel("user aborted");
    }

    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }

      evs.push(next.value);
    }

    expect(evs.map((e) => e.type)).toEqual([
      "workflow-start",
      "workflow-step",
      "workflow-aborted",
    ]);
    expect(evs.at(-1)).toMatchObject({
      type: "workflow-aborted",
      data: {
        reason: "user aborted",
      },
    });
  });

  it("matches unordered composite triggers across pause and resume", async () => {
    const startEvent = workflowEvent(
      "start",
      z.object({
        ticket: z.string(),
      }),
    );
    const approvalEvent = workflowEvent(
      "approval",
      z.object({
        approved: z.boolean(),
      }),
    );
    const endEvent = workflowEvent(
      "end",
      z.object({
        pair: z.string(),
      }),
    );
    const store = createInMemoryWorkflowStore<
      Record<string, never>,
      WorkflowUIMessage
    >();

    const workflow = defineWorkflow({
      name: "and-across-resume",
      trigger: startEvent,
      finish: endEvent,
      initialState(): Record<string, never> {
        return {};
      },
    })
      .step([startEvent, approvalEvent], (_context, matched) => {
        const pair = (matched as Array<{ type: string }>)
          .map((event) => event.type)
          .join(">");

        return endEvent.create({
          pair,
        });
      })
      .step(startEvent, () =>
        pauseWorkflow({
          reason: "awaiting-approval",
        }),
      );

    const firstExecution = await workflow.run({
      input: {
        ticket: "T-100",
      },
      mode: "resumable",
      store,
    });
    const firstEvents = await collectStream(firstExecution.stream);

    expect(firstEvents.at(-1)?.type).toBe("workflow-paused");

    expect(
      store.state.checkpoints.get(firstExecution.runId)?.runtime?.stepStates[0]
        ?.history,
    ).toEqual([
      {
        id: 1,
        event: {
          type: "start",
          data: {
            ticket: "T-100",
          },
        },
      },
    ]);

    const resumed = await workflow.resume({
      runId: firstExecution.runId,
      store,
      event: approvalEvent.create({
        approved: true,
      }),
    });
    const resumedEvents = await collectStream(resumed.stream);

    expect(resumedEvents.at(-1)).toMatchObject({
      type: "workflow-end",
      data: {
        result: {
          pair: "start>approval",
        },
      },
    });
  });

  it("requires ordered composite triggers to arrive in sequence", async () => {
    const startEvent = workflowEvent("start");
    const eventA = workflowEvent("a");
    const eventB = workflowEvent("b");
    const endEvent = workflowEvent(
      "end",
      z.object({
        matched: z.string(),
      }),
    );

    const workflow = defineWorkflow({
      name: "ordered-trigger",
      trigger: startEvent,
      finish: endEvent,
      initialState(): { ordered: string[] } {
        return {
          ordered: [],
        };
      },
    })
      .step(startEvent, async (context) => {
        await context.dispatch(eventB.create());
        await context.dispatch(eventA.create());
        await context.dispatch(eventB.create());
      })
      .step(eventA, (context) => {
        context.state.ordered.push("a");
      })
      .step(eventB, (context) => {
        context.state.ordered.push("b");
      })
      .step(Order([eventA, eventB]), (_context, matched) => {
        return endEvent.create({
          matched: matched.map((event) => event.type).join(">"),
        });
      });

    const execution = await workflow.run({
      mode: "abortable",
    });
    const events = await collectStream(execution.stream);

    expect(events.map((event) => event.type)).toEqual([
      "workflow-start",
      "workflow-step",
      "workflow-step",
      "workflow-step",
      "workflow-step",
      "workflow-step",
      "workflow-end",
    ]);

    expect(events.at(-1)).toMatchObject({
      type: "workflow-end",
      data: {
        result: {
          matched: "a>b",
        },
      },
    });
  });

  it("uses declaration order when multiple nested or branches complete together", async () => {
    const startEvent = workflowEvent("start");
    const eventA = workflowEvent("a");
    const eventB = workflowEvent("b");
    const endEvent = workflowEvent(
      "end",
      z.object({
        selected: z.string(),
      }),
    );

    const workflow = defineWorkflow({
      name: "or-priority",
      trigger: startEvent,
      finish: endEvent,
      initialState(): Record<string, never> {
        return {};
      },
    })
      .step(startEvent, async (context) => {
        await context.dispatch(eventA.create());
        await context.dispatch(eventB.create());
      })
      .step(
        Or([And([eventB, eventA]), Order([eventA, eventB])]),
        (_context, matched) =>
          endEvent.create({
            selected: matched.map((event) => event.type).join(">"),
          }),
      );

    const execution = await workflow.run({
      mode: "abortable",
    });
    const events = await collectStream(execution.stream);

    expect(events.at(-1)).toMatchObject({
      type: "workflow-end",
      data: {
        result: {
          selected: "b>a",
        },
      },
    });
  });

  it("matches And triggers after all component events arrive and preserves declaration order", async () => {
    const startEvent = workflowEvent("start");
    const alphaEvent = workflowEvent(
      "alpha",
      z.object({
        label: z.string(),
      }),
    );
    const betaEvent = workflowEvent(
      "beta",
      z.object({
        label: z.string(),
      }),
    );
    const endEvent = workflowEvent(
      "end",
      z.object({
        matched: z.string(),
      }),
    );

    const workflow = defineWorkflow({
      name: "and-trigger",
      trigger: startEvent,
      finish: endEvent,
      initialState(): Record<string, never> {
        return {};
      },
    })
      .step(startEvent, async (context) => {
        await context.dispatch(
          betaEvent.create({
            label: "second",
          }),
        );
        await context.dispatch(
          alphaEvent.create({
            label: "first",
          }),
        );
      })
      .step(And([alphaEvent, betaEvent]), (_context, matched) =>
        endEvent.create({
          matched: matched.map((event) => event.data.label).join(">"),
        }),
      );

    const execution = await workflow.run({
      mode: "abortable",
    });
    const events = await collectStream(execution.stream);

    expect(events.at(-1)).toMatchObject({
      type: "workflow-end",
      data: {
        result: {
          matched: "first>second",
        },
      },
    });
  });

  it("matches Or triggers with whichever branch arrives first", async () => {
    const startEvent = workflowEvent("start");
    const alphaEvent = workflowEvent(
      "alpha",
      z.object({
        label: z.string(),
      }),
    );
    const betaEvent = workflowEvent(
      "beta",
      z.object({
        label: z.string(),
      }),
    );
    const endEvent = workflowEvent(
      "end",
      z.object({
        matched: z.string(),
      }),
    );

    const workflow = defineWorkflow({
      name: "or-trigger",
      trigger: startEvent,
      finish: endEvent,
      initialState(): Record<string, never> {
        return {};
      },
    })
      .step(startEvent, async (context) => {
        await context.dispatch(
          betaEvent.create({
            label: "beta-branch",
          }),
        );
      })
      .step(Or([alphaEvent, betaEvent]), (_context, matched) =>
        endEvent.create({
          matched: matched.data.label,
        }),
      );

    const execution = await workflow.run({
      mode: "abortable",
    });
    const events = await collectStream(execution.stream);

    expect(events.at(-1)).toMatchObject({
      type: "workflow-end",
      data: {
        result: {
          matched: "beta-branch",
        },
      },
    });
  });

  it("matches Order triggers only when events arrive in sequence", async () => {
    const startEvent = workflowEvent("start");
    const alphaEvent = workflowEvent(
      "alpha",
      z.object({
        step: z.string(),
      }),
    );
    const betaEvent = workflowEvent(
      "beta",
      z.object({
        step: z.string(),
      }),
    );
    const endEvent = workflowEvent(
      "end",
      z.object({
        matched: z.string(),
      }),
    );

    const workflow = defineWorkflow({
      name: "order-trigger",
      trigger: startEvent,
      finish: endEvent,
      initialState(): Record<string, never> {
        return {};
      },
    })
      .step(startEvent, async (context) => {
        await context.dispatch(
          betaEvent.create({
            step: "out-of-order",
          }),
        );
        await context.dispatch(
          alphaEvent.create({
            step: "first",
          }),
        );
        await context.dispatch(
          betaEvent.create({
            step: "second",
          }),
        );
      })
      .step(Order([alphaEvent, betaEvent]), (_context, matched) =>
        endEvent.create({
          matched: matched.map((event) => event.data.step).join(">"),
        }),
      );

    const execution = await workflow.run({
      mode: "abortable",
    });
    const events = await collectStream(execution.stream);

    expect(events.at(-1)).toMatchObject({
      type: "workflow-end",
      data: {
        result: {
          matched: "first>second",
        },
      },
    });
  });

  it("dispatches multiple event types inside loops and waits for each branch", async () => {
    const startEvent = workflowEvent("start");
    const alphaEvent = workflowEvent(
      "alpha",
      z.object({
        amount: z.number(),
      }),
    );
    const betaEvent = workflowEvent(
      "beta",
      z.object({
        amount: z.number(),
      }),
    );
    const endEvent = workflowEvent(
      "end",
      z.object({
        alpha: z.number(),
        beta: z.number(),
      }),
    );

    const workflow = defineWorkflow({
      name: "loop-dispatch",
      trigger: startEvent,
      finish: endEvent,
      initialState() {
        return {
          alpha: 0,
          beta: 0,
        };
      },
    })
      .step(startEvent, async (context) => {
        const branches = [
          alphaEvent.create({
            amount: 2,
          }),
          betaEvent.create({
            amount: 3,
          }),
          alphaEvent.create({
            amount: 5,
          }),
        ].map((event) => context.dispatch(event));

        await Promise.all(branches);

        return endEvent.create({
          alpha: context.state.alpha,
          beta: context.state.beta,
        });
      })
      .step(alphaEvent, (context, event) => {
        context.state.alpha += event.amount;
      })
      .step(betaEvent, (context, event) => {
        context.state.beta += event.amount;
      });

    const execution = await workflow.run({
      mode: "abortable",
    });
    const events = await collectStream(execution.stream);

    expect(events.at(-1)).toMatchObject({
      type: "workflow-end",
      data: {
        result: {
          alpha: 7,
          beta: 3,
        },
      },
    });
  });

  it("starts child dispatches immediately and exposes a branch stream", async () => {
    const startEvent = workflowEvent("start");
    const childEvent = workflowEvent(
      "child",
      z.object({
        count: z.number(),
      }),
    );
    const grandchildEvent = workflowEvent("grandchild");
    const endEvent = workflowEvent(
      "end",
      z.object({
        trace: z.array(z.string()),
      }),
    );
    const trace: string[] = [];

    const workflow = defineWorkflow({
      name: "dispatch-stream",
      trigger: startEvent,
      finish: endEvent,
      initialState(): Record<string, never> {
        return {};
      },
    })
      .step(startEvent, async (context) => {
        trace.push("start:before");
        const operation = context.dispatch(
          childEvent.create({
            count: 1,
          }),
        );
        const branchEventsPromise = operation.stream
          .until(grandchildEvent)
          .toArray();

        trace.push("start:after-dispatch");
        await operation;
        trace.push("start:after-await");
        trace.push(
          (await branchEventsPromise).map((event) => event.type).join(">"),
        );

        return endEvent.create({
          trace,
        });
      })
      .step(childEvent, async (_context, event) => {
        trace.push(`child:${event.count}`);
        await Bun.sleep(1);
        return grandchildEvent.create();
      })
      .step(grandchildEvent, () => {
        trace.push("grandchild");
      });

    const execution = await workflow.run({
      mode: "abortable",
    });
    const events = await collectStream(execution.stream);

    expect(events.at(-1)).toMatchObject({
      type: "workflow-end",
      data: {
        result: {
          trace: [
            "start:before",
            "start:after-dispatch",
            "child:1",
            "grandchild",
            "start:after-await",
            "child>grandchild",
          ],
        },
      },
    });
  });

  it("revalidates restored step history when resuming", async () => {
    const startEvent = workflowEvent(
      "start",
      z.object({
        ticket: z.string(),
      }),
    );
    const approvalEvent = workflowEvent(
      "approval",
      z.object({
        approved: z.boolean(),
      }),
    );
    const endEvent = workflowEvent(
      "end",
      z.object({
        pair: z.string(),
      }),
    );
    const store = createInMemoryWorkflowStore<
      Record<string, never>,
      WorkflowUIMessage
    >();

    const workflow = defineWorkflow({
      name: "invalid-resume-history",
      trigger: startEvent,
      finish: endEvent,
      initialState(): Record<string, never> {
        return {};
      },
    })
      .step([startEvent, approvalEvent], (_context, matched) =>
        endEvent.create({
          pair: (matched as Array<{ type: string }>)
            .map((event) => event.type)
            .join(">"),
        }),
      )
      .step(startEvent, () =>
        pauseWorkflow({
          reason: "awaiting-approval",
        }),
      );

    const firstExecution = await workflow.run({
      input: {
        ticket: "T-100",
      },
      mode: "resumable",
      store,
    });
    await collectStream(firstExecution.stream);

    const checkpoint = store.state.checkpoints.get(firstExecution.runId);

    if (!checkpoint?.runtime?.stepStates[0]?.history[0]) {
      throw new Error("Expected saved step history for the resume test.");
    }

    checkpoint.runtime.stepStates[0].history[0].event = {
      type: "start",
      data: {
        ticket: 404,
      },
    } as unknown as { type: "start"; data: { ticket: string } };

    const resumed = await workflow.resume({
      runId: firstExecution.runId,
      store,
      event: approvalEvent.create({
        approved: true,
      }),
    });
    const resumedEvents = await collectStream(resumed.stream);

    expect(resumedEvents.map((event) => event.type)).toEqual([
      "workflow-start",
      "workflow-error",
    ]);
    expect(resumedEvents.at(-1)).toMatchObject({
      type: "workflow-error",
      data: {
        retryable: false,
      },
    });
  });
});

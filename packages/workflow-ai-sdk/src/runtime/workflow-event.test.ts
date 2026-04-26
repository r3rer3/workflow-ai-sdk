import { describe, expect, it } from "bun:test";
import { inspect } from "node:util";
import { z } from "zod";

import {
  And,
  decorateWorkflowEvent,
  describeWorkflowTrigger,
  formatWorkflowEvent,
  isWorkflowEventDefinition,
  isWorkflowTriggerExpression,
  type NormalizeWorkflowTrigger,
  normalizeWorkflowTrigger,
  Or,
  Order,
  validateWorkflowEvent,
  type WorkflowAndExpression,
  type WorkflowDispatchedEvent,
  WorkflowEventValidationError,
  type WorkflowOrderExpression,
  type WorkflowStepInput,
  workflowEvent,
} from "./workflow-event";

type Equal<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2
  ? true
  : false;

function assertType<_T extends true>() { }

const alphaEvent = workflowEvent(
  "alpha",
  z.object({
    label: z.string(),
  }),
);
const betaEvent = workflowEvent(
  "beta",
  z.object({
    count: z.number(),
  }),
);
const gammaEvent = workflowEvent("gamma");
const deltaEvent = workflowEvent(
  "delta",
  z.object({
    step: z.string(),
  }),
);

const alphaAndBeta = And([alphaEvent, betaEvent] as const);
const orderedAlphaThenDelta = Order([alphaEvent, deltaEvent] as const);
const alphaOrBeta = Or([alphaEvent, betaEvent] as const);

type AlphaMatch = WorkflowDispatchedEvent<"alpha", { label: string }>;
type BetaMatch = WorkflowDispatchedEvent<"beta", { count: number }>;
type DeltaMatch = WorkflowDispatchedEvent<"delta", { step: string }>;

assertType<
  Equal<
    NormalizeWorkflowTrigger<readonly [typeof alphaEvent, typeof betaEvent]>,
    WorkflowAndExpression<readonly [typeof alphaEvent, typeof betaEvent]>
  >
>();
assertType<Equal<WorkflowStepInput<typeof alphaEvent>, { label: string }>>();
assertType<
  Equal<
    WorkflowStepInput<readonly [typeof alphaEvent, typeof betaEvent]>,
    readonly [AlphaMatch, BetaMatch]
  >
>();
assertType<
  Equal<
    WorkflowStepInput<typeof alphaAndBeta>,
    readonly [AlphaMatch, BetaMatch]
  >
>();
assertType<
  Equal<
    WorkflowStepInput<typeof orderedAlphaThenDelta>,
    readonly [AlphaMatch, DeltaMatch]
  >
>();
assertType<
  Equal<WorkflowStepInput<typeof alphaOrBeta>, AlphaMatch | BetaMatch>
>();
assertType<
  Equal<
    NormalizeWorkflowTrigger<
      readonly [
        typeof alphaEvent,
        readonly [typeof betaEvent, typeof gammaEvent],
      ]
    >,
    WorkflowAndExpression<
      readonly [
        typeof alphaEvent,
        WorkflowAndExpression<readonly [typeof betaEvent, typeof gammaEvent]>,
      ]
    >
  >
>();
assertType<
  Equal<
    NormalizeWorkflowTrigger<typeof orderedAlphaThenDelta>,
    WorkflowOrderExpression<readonly [typeof alphaEvent, typeof deltaEvent]>
  >
>();

describe("workflowEvent", () => {
  it("creates decorated events and matches them by type", () => {
    const event = alphaEvent.create({
      label: "hello",
    });

    expect(event).toEqual({
      type: "alpha",
      data: {
        label: "hello",
      },
    });
    expect(alphaEvent.is(event)).toBe(true);
    expect(alphaEvent.is(betaEvent.create({ count: 2 }))).toBe(false);
  });
});

describe("decorateWorkflowEvent", () => {
  it("adds non-enumerable string and inspect helpers to the original object", () => {
    const event = {
      type: "custom.event",
      data: {
        ok: true,
      },
    };

    const decorated = decorateWorkflowEvent(event);
    const inspectMethod = Reflect.get(decorated, "inspect") as (
      depth?: number,
      options?: unknown,
      customInspect?: (value: unknown) => string,
    ) => string;
    const toPrimitive = Reflect.get(decorated, Symbol.toPrimitive) as (
      hint?: string,
    ) => string;

    expect(decorated).toBe(event);
    expect(String(decorated)).toBe(
      'WorkflowEvent("custom.event", data={"ok":true})',
    );
    expect(`${decorated}`).toBe(
      'WorkflowEvent("custom.event", data={"ok":true})',
    );
    expect(toPrimitive("string")).toBe(
      'WorkflowEvent("custom.event", data={"ok":true})',
    );
    expect(inspectMethod()).toBe(
      'WorkflowEvent("custom.event", data={"ok":true})',
    );
    expect(inspectMethod(undefined, undefined, () => "<<custom>>")).toBe(
      'WorkflowEvent("custom.event", data=<<custom>>)',
    );
    expect(Object.keys(decorated)).toEqual(["type", "data"]);
    expect(
      Object.getOwnPropertyDescriptor(decorated, "toString")?.enumerable,
    ).toBe(false);
    expect(
      Object.getOwnPropertyDescriptor(decorated, "inspect")?.enumerable,
    ).toBe(false);
    expect(
      Object.getOwnPropertyDescriptor(decorated, Symbol.toPrimitive)
        ?.enumerable,
    ).toBe(false);
  });
});

describe("formatWorkflowEvent", () => {
  it("formats dispatched events for debugging", () => {
    const event = workflowEvent(
      "chat.start",
      z.object({
        message: z.string(),
      }),
    ).create({
      message: "hi",
    });

    expect(String(event)).toBe(
      'WorkflowEvent("chat.start", data={"message":"hi"})',
    );
    expect(inspect(event)).toBe(
      "WorkflowEvent(\"chat.start\", data={ message: 'hi' })",
    );
    expect(formatWorkflowEvent(event)).toBe(
      'WorkflowEvent("chat.start", data={"message":"hi"})',
    );
  });

  it("formats events with no data", () => {
    const event = workflowEvent("simple.event").create();

    expect(String(event)).toBe('WorkflowEvent("simple.event")');
    expect(inspect(event)).toBe('WorkflowEvent("simple.event")');
    expect(formatWorkflowEvent(event)).toBe('WorkflowEvent("simple.event")');
  });

  it("formats string and object payloads", () => {
    expect(
      formatWorkflowEvent({
        type: "string.event",
        data: "hi",
      }),
    ).toBe('WorkflowEvent("string.event", data="hi")');
    expect(
      formatWorkflowEvent({
        type: "object.event",
        data: {
          count: 2,
        },
      }),
    ).toBe('WorkflowEvent("object.event", data={"count":2})');
  });

  it("falls back to String for non-JSON-serializable payloads", () => {
    expect(
      formatWorkflowEvent({
        type: "bigint.event",
        data: 12n,
      }),
    ).toBe('WorkflowEvent("bigint.event", data=12)');
  });
});

describe("validateWorkflowEvent", () => {
  it("passes through undecorated events when no schema is registered", async () => {
    const simpleEvent = workflowEvent("simple.event");
    const event = await validateWorkflowEvent(simpleEvent, {
      type: "simple.event",
      data: {
        passthrough: true,
      },
    });

    expect(event.type).toBe("simple.event");
    expect(
      (event as WorkflowDispatchedEvent<"simple.event", unknown>).data,
    ).toEqual({
      passthrough: true,
    });
    expect(String(event)).toBe(
      'WorkflowEvent("simple.event", data={"passthrough":true})',
    );
  });

  it("validates schema-backed events and returns parsed payloads", async () => {
    const eventDefinition = workflowEvent(
      "coerced",
      z.object({
        count: z.coerce.number(),
      }),
    );

    const event = await validateWorkflowEvent(eventDefinition, {
      type: "coerced",
      data: {
        count: "42",
      },
    });

    expect(event.data).toEqual({
      count: 42,
    });
    expect(String(event)).toBe('WorkflowEvent("coerced", data={"count":42})');
  });

  it("rejects events validated against the wrong definition", async () => {
    expect(
      validateWorkflowEvent(alphaEvent, {
        type: "beta",
        data: {
          count: 1,
        },
      }),
    ).rejects.toThrow('Cannot validate workflow event "beta" against "alpha".');
  });

  it("throws WorkflowEventValidationError with formatted issue paths", async () => {
    const invalidEvent = workflowEvent(
      "invalid",
      z.object({
        nested: z.object({
          count: z.number(),
        }),
        tags: z.array(z.string()),
      }),
    );

    try {
      await validateWorkflowEvent(invalidEvent, {
        type: "invalid",
        data: {
          nested: {
            count: "bad",
          },
          tags: [123],
        },
      });
      throw new Error("Expected validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowEventValidationError);

      if (!(error instanceof WorkflowEventValidationError)) {
        throw error;
      }

      expect(error.name).toBe("WorkflowEventValidationError");
      expect(error.eventType).toBe("invalid");
      expect(error.issues).toHaveLength(2);
      expect(error.issues[0]).toEqual(
        expect.objectContaining({
          expected: "number",
          code: "invalid_type",
          path: ["nested", "count"],
          message: "Invalid input: expected number, received string",
        }),
      );
      expect(error.issues[1]).toEqual(
        expect.objectContaining({
          expected: "string",
          code: "invalid_type",
          path: ["tags", 0],
          message: "Invalid input: expected string, received number",
        }),
      );
      expect(error.message).toEqual(
        `Workflow event "invalid" failed validation: nested.count: Invalid input: expected number, received string; tags.0: Invalid input: expected string, received number`,
      );
    }
  });
});

describe("workflow trigger helpers", () => {
  it("detects event definitions and trigger expressions", () => {
    expect(isWorkflowEventDefinition(alphaEvent)).toBe(true);
    expect(isWorkflowEventDefinition([alphaEvent, betaEvent])).toBe(false);
    expect(isWorkflowEventDefinition(And([alphaEvent, betaEvent]))).toBe(false);

    expect(isWorkflowTriggerExpression(alphaEvent)).toBe(false);
    expect(isWorkflowTriggerExpression([alphaEvent, betaEvent])).toBe(false);
    expect(isWorkflowTriggerExpression(And([alphaEvent, betaEvent]))).toBe(
      true,
    );
    expect(isWorkflowTriggerExpression(Or([alphaEvent, betaEvent]))).toBe(true);
    expect(isWorkflowTriggerExpression(Order([alphaEvent, betaEvent]))).toBe(
      true,
    );
  });

  it("normalizes bare arrays into And expressions", () => {
    const trigger = normalizeWorkflowTrigger([alphaEvent, betaEvent] as const);

    expect(trigger.kind).toBe("and");
    expect(trigger.triggers).toHaveLength(2);
    expect(trigger.triggers[0]).toBe(alphaEvent);
    expect(trigger.triggers[1]).toBe(betaEvent);
  });

  it("normalizes nested arrays inside And expressions", () => {
    const trigger = And([alphaEvent, [betaEvent, gammaEvent]] as const);

    expect(trigger.kind).toBe("and");
    expect(trigger.triggers[0]).toBe(alphaEvent);
    expect(trigger.triggers[1]).toEqual({
      kind: "and",
      triggers: [betaEvent, gammaEvent],
    });
  });

  it("normalizes nested arrays inside Or expressions", () => {
    const trigger = normalizeWorkflowTrigger(
      Or([alphaEvent, [betaEvent, gammaEvent]] as const),
    );

    expect(trigger.kind).toBe("or");
    expect(trigger.triggers[0]).toBe(alphaEvent);
    expect(trigger.triggers[1]).toEqual({
      kind: "and",
      triggers: [betaEvent, gammaEvent],
    });
  });

  it("normalizes nested arrays inside Order expressions", () => {
    const trigger = normalizeWorkflowTrigger(
      Order([
        alphaEvent,
        Or([betaEvent, [gammaEvent, deltaEvent]] as const),
      ] as const),
    );

    expect(trigger.kind).toBe("order");
    expect(trigger.triggers[0]).toBe(alphaEvent);
    expect(trigger.triggers[1]).toEqual({
      kind: "or",
      triggers: [
        betaEvent,
        {
          kind: "and",
          triggers: [gammaEvent, deltaEvent],
        },
      ],
    });
  });

  it("describes single and composite triggers", () => {
    expect(describeWorkflowTrigger(alphaEvent)).toBe("alpha");
    expect(describeWorkflowTrigger([alphaEvent, betaEvent] as const)).toBe(
      "and(alpha, beta)",
    );
    expect(
      describeWorkflowTrigger(
        Order([
          alphaEvent,
          Or([betaEvent, [gammaEvent, deltaEvent]] as const),
        ] as const),
      ),
    ).toBe("order(alpha, or(beta, and(gamma, delta)))");
  });
});

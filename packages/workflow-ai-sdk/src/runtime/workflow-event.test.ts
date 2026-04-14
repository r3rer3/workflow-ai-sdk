import { describe, expect, it } from "bun:test";
import { inspect } from "node:util";
import { z } from "zod";

import {
  formatWorkflowEvent,
  validateWorkflowEvent,
  workflowEvent,
} from "./workflow-event";

describe("workflowEvent", () => {
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
  });
});

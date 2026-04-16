import { describe, expect, it } from "bun:test";

import {
  createAgentEndStreamEvent,
  createAgentStartStreamEvent,
  createCustomStreamEvent,
  createToolEndStreamEvent,
  createToolStartStreamEvent,
  createWorkflowAbortedStreamEvent,
  createWorkflowEndStreamEvent,
  createWorkflowErrorStreamEvent,
  createWorkflowHierarchy,
  createWorkflowPausedStreamEvent,
  createWorkflowStartStreamEvent,
  createWorkflowStepStreamEvent,
  extendHierarchyWithAgent,
  extendHierarchyWithTool,
} from "./create-stream-event";

const hierarchy = createWorkflowHierarchy("test-workflow", "run_1");

describe("createWorkflowHierarchy", () => {
  it("returns correct shape", () => {
    const h = createWorkflowHierarchy("my-workflow", "run_abc");
    expect(h).toEqual({
      workflowName: "my-workflow",
      workflowRunId: "run_abc",
    });
  });
});

describe("extendHierarchyWithAgent", () => {
  it("preserves workflow fields and adds agent fields", () => {
    const extended = extendHierarchyWithAgent(
      hierarchy,
      "agent-1",
      "agent_run_1",
    );
    expect(extended).toEqual({
      workflowName: "test-workflow",
      workflowRunId: "run_1",
      agentName: "agent-1",
      agentRunId: "agent_run_1",
    });
  });
});

describe("extendHierarchyWithTool", () => {
  it("preserves workflow and agent fields and adds tool fields", () => {
    const withAgent = extendHierarchyWithAgent(
      hierarchy,
      "agent-1",
      "agent_run_1",
    );
    const extended = extendHierarchyWithTool(withAgent, "tool-1", "call_1");
    expect(extended).toEqual({
      workflowName: "test-workflow",
      workflowRunId: "run_1",
      agentName: "agent-1",
      agentRunId: "agent_run_1",
      toolName: "tool-1",
      toolCallId: "call_1",
    });
  });
});

describe("createWorkflowStartStreamEvent", () => {
  it("returns { type: 'workflow-start', data } with correct type string", () => {
    const event = createWorkflowStartStreamEvent({
      workflowName: "test-workflow",
      runId: "run_1",
      threadId: "thread_1",
      resourceId: "res_1",
      mode: "abortable",
      resumed: false,
      hierarchy,
    });
    expect(event.type).toBe("workflow-start");
    expect(event.data.workflowName).toBe("test-workflow");
    expect(event.data.runId).toBe("run_1");
    expect(event.data.threadId).toBe("thread_1");
    expect(event.data.resourceId).toBe("res_1");
    expect(event.data.mode).toBe("abortable");
    expect(event.data.resumed).toBe(false);
    expect(event.data.hierarchy).toEqual(hierarchy);
  });
});

describe("createWorkflowStepStreamEvent", () => {
  it("returns { type: 'workflow-step', data } with correct type string", () => {
    const event = createWorkflowStepStreamEvent({
      workflowName: "test-workflow",
      runId: "run_1",
      stepName: "step-1",
      eventType: "some-event",
      inputEventTypes: ["event-a", "event-b"],
      hierarchy,
    });
    expect(event.type).toBe("workflow-step");
    expect(event.data.stepName).toBe("step-1");
    expect(event.data.eventType).toBe("some-event");
    expect(event.data.inputEventTypes).toEqual(["event-a", "event-b"]);
    expect(event.data.hierarchy).toEqual(hierarchy);
  });
});

describe("createWorkflowEndStreamEvent", () => {
  it("returns { type: 'workflow-end', data } with correct type string", () => {
    const event = createWorkflowEndStreamEvent({
      workflowName: "test-workflow",
      runId: "run_1",
      durationMs: 1500,
      hierarchy,
    });
    expect(event.type).toBe("workflow-end");
    expect(event.data.durationMs).toBe(1500);
    expect(event.data.hierarchy).toEqual(hierarchy);
  });

  it("includes result when provided", () => {
    const event = createWorkflowEndStreamEvent({
      workflowName: "test-workflow",
      runId: "run_1",
      durationMs: 1000,
      result: { answer: 42 },
      hierarchy,
    });
    expect(event.data.result).toEqual({ answer: 42 });
  });

  it("omits result when not provided", () => {
    const event = createWorkflowEndStreamEvent({
      workflowName: "test-workflow",
      runId: "run_1",
      durationMs: 500,
      hierarchy,
    });
    expect(event.data.result).toBeUndefined();
  });
});

describe("createWorkflowErrorStreamEvent", () => {
  it("returns { type: 'workflow-error', data } with correct type string", () => {
    const event = createWorkflowErrorStreamEvent({
      workflowName: "test-workflow",
      runId: "run_1",
      message: "something broke",
      hierarchy,
    });
    expect(event.type).toBe("workflow-error");
    expect(event.data.message).toBe("something broke");
    expect(event.data.hierarchy).toEqual(hierarchy);
  });

  it("defaults retryable to true", () => {
    const event = createWorkflowErrorStreamEvent({
      workflowName: "test-workflow",
      runId: "run_1",
      message: "transient failure",
      hierarchy,
    });
    expect(event.data.retryable).toBe(true);
  });

  it("respects explicit retryable: false", () => {
    const event = createWorkflowErrorStreamEvent({
      workflowName: "test-workflow",
      runId: "run_1",
      message: "permanent failure",
      retryable: false,
      hierarchy,
    });
    expect(event.data.retryable).toBe(false);
  });
});

describe("createWorkflowPausedStreamEvent", () => {
  it("returns { type: 'workflow-paused', data } with correct type string", () => {
    const event = createWorkflowPausedStreamEvent({
      workflowName: "test-workflow",
      runId: "run_1",
      reason: "waiting for approval",
      hierarchy,
    });
    expect(event.type).toBe("workflow-paused");
    expect(event.data.reason).toBe("waiting for approval");
    expect(event.data.hierarchy).toEqual(hierarchy);
  });

  it("includes payload when provided", () => {
    const event = createWorkflowPausedStreamEvent({
      workflowName: "test-workflow",
      runId: "run_1",
      reason: "needs input",
      payload: { question: "continue?" },
      hierarchy,
    });
    expect(event.data.payload).toEqual({ question: "continue?" });
  });

  it("omits payload when not provided", () => {
    const event = createWorkflowPausedStreamEvent({
      workflowName: "test-workflow",
      runId: "run_1",
      reason: "paused",
      hierarchy,
    });
    expect(event.data.payload).toBeUndefined();
  });
});

describe("createWorkflowAbortedStreamEvent", () => {
  it("returns { type: 'workflow-aborted', data } with correct type string", () => {
    const event = createWorkflowAbortedStreamEvent({
      workflowName: "test-workflow",
      runId: "run_1",
      hierarchy,
    });
    expect(event.type).toBe("workflow-aborted");
    expect(event.data.workflowName).toBe("test-workflow");
    expect(event.data.hierarchy).toEqual(hierarchy);
  });

  it("includes reason when provided", () => {
    const event = createWorkflowAbortedStreamEvent({
      workflowName: "test-workflow",
      runId: "run_1",
      reason: "user cancelled",
      hierarchy,
    });
    expect(event.data.reason).toBe("user cancelled");
  });

  it("omits reason when not provided", () => {
    const event = createWorkflowAbortedStreamEvent({
      workflowName: "test-workflow",
      runId: "run_1",
      hierarchy,
    });
    expect(event.data.reason).toBeUndefined();
  });
});

describe("createCustomStreamEvent", () => {
  it("returns { type: 'custom-event', data } with correct type string", () => {
    const event = createCustomStreamEvent({
      name: "my-custom",
      data: { key: "value" },
      hierarchy,
    });
    expect(event.type).toBe("custom-event");
    expect(event.data.name).toBe("my-custom");
    expect(event.data.data).toEqual({ key: "value" });
    expect(event.data.hierarchy).toEqual(hierarchy);
  });
});

describe("createAgentStartStreamEvent", () => {
  it("returns { type: 'agent-start', data } with correct type string", () => {
    const event = createAgentStartStreamEvent({
      agentName: "agent-1",
      agentRunId: "agent_run_1",
      hierarchy,
    });
    expect(event.type).toBe("agent-start");
    expect(event.data.agentName).toBe("agent-1");
    expect(event.data.agentRunId).toBe("agent_run_1");
    expect(event.data.hierarchy).toEqual(hierarchy);
  });
});

describe("createAgentEndStreamEvent", () => {
  it("returns { type: 'agent-end', data } with correct type string", () => {
    const event = createAgentEndStreamEvent({
      agentName: "agent-1",
      agentRunId: "agent_run_1",
      success: true,
      durationMs: 2000,
      hierarchy,
    });
    expect(event.type).toBe("agent-end");
    expect(event.data.agentName).toBe("agent-1");
    expect(event.data.agentRunId).toBe("agent_run_1");
    expect(event.data.success).toBe(true);
    expect(event.data.durationMs).toBe(2000);
    expect(event.data.hierarchy).toEqual(hierarchy);
  });

  it("includes usage when provided", () => {
    const usage = {
      agentName: "agent-1",
      agentRunId: "agent_run_1",
      model: "gpt-4",
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      finishReason: "stop",
      durationMs: 2000,
      success: true,
    };
    const event = createAgentEndStreamEvent({
      agentName: "agent-1",
      agentRunId: "agent_run_1",
      success: true,
      durationMs: 2000,
      hierarchy,
      usage,
    });
    expect(event.data.usage).toEqual(usage);
  });

  it("omits usage when not provided", () => {
    const event = createAgentEndStreamEvent({
      agentName: "agent-1",
      agentRunId: "agent_run_1",
      success: false,
      durationMs: 500,
      hierarchy,
    });
    expect(event.data.usage).toBeUndefined();
  });
});

describe("createToolStartStreamEvent", () => {
  it("returns { type: 'tool-start', data } with correct type string", () => {
    const event = createToolStartStreamEvent({
      toolName: "tool-1",
      toolCallId: "call_1",
      hierarchy,
    });
    expect(event.type).toBe("tool-start");
    expect(event.data.toolName).toBe("tool-1");
    expect(event.data.toolCallId).toBe("call_1");
    expect(event.data.hierarchy).toEqual(hierarchy);
  });
});

describe("createToolEndStreamEvent", () => {
  it("returns { type: 'tool-end', data } with correct type string", () => {
    const event = createToolEndStreamEvent({
      toolName: "tool-1",
      toolCallId: "call_1",
      success: true,
      durationMs: 300,
      hierarchy,
    });
    expect(event.type).toBe("tool-end");
    expect(event.data.toolName).toBe("tool-1");
    expect(event.data.toolCallId).toBe("call_1");
    expect(event.data.success).toBe(true);
    expect(event.data.durationMs).toBe(300);
    expect(event.data.hierarchy).toEqual(hierarchy);
  });
});

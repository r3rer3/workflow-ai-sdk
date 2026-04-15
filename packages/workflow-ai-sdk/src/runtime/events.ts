import type {
  AgentEndEventData,
  AgentStartEventData,
  AgentUsageEntry,
  ExecutionHierarchy,
  ToolEndEventData,
  ToolStartEventData,
  WorkflowAbortedEventData,
  WorkflowCustomEventData,
  WorkflowEndEventData,
  WorkflowErrorEventData,
  WorkflowExecutionMode,
  WorkflowPausedEventData,
  WorkflowStartEventData,
  WorkflowStepEventData,
} from "./types";

export function createWorkflowHierarchy(
  workflowName: string,
  workflowRunId: string,
): ExecutionHierarchy {
  return {
    workflowName,
    workflowRunId,
  };
}

export function extendHierarchyWithAgent(
  hierarchy: ExecutionHierarchy,
  agentName: string,
  agentRunId: string,
): ExecutionHierarchy {
  return {
    ...hierarchy,
    agentName,
    agentRunId,
  };
}

export function extendHierarchyWithTool(
  hierarchy: ExecutionHierarchy,
  toolName: string,
  toolCallId: string,
): ExecutionHierarchy {
  return {
    ...hierarchy,
    toolName,
    toolCallId,
  };
}

export function createWorkflowStartEvent(args: {
  workflowName: string;
  runId: string;
  threadId: string;
  resourceId: string;
  mode: WorkflowExecutionMode;
  resumed: boolean;
  hierarchy: ExecutionHierarchy;
}): {
  type: "workflow-start";
  data: WorkflowStartEventData;
} {
  return {
    type: "workflow-start",
    data: args,
  };
}

export function createWorkflowStepEvent(args: {
  workflowName: string;
  runId: string;
  stepName: string;
  eventType: string;
  inputEventTypes: string[];
  hierarchy: ExecutionHierarchy;
}): {
  type: "workflow-step";
  data: WorkflowStepEventData;
} {
  return {
    type: "workflow-step",
    data: args,
  };
}

export function createWorkflowEndEvent(args: {
  workflowName: string;
  runId: string;
  durationMs: number;
  result?: WorkflowEndEventData["result"];
  hierarchy: ExecutionHierarchy;
}): {
  type: "workflow-end";
  data: WorkflowEndEventData;
} {
  return {
    type: "workflow-end",
    data: args,
  };
}

export function createWorkflowErrorEvent(args: {
  workflowName: string;
  runId: string;
  message: string;
  retryable?: boolean;
  hierarchy: ExecutionHierarchy;
}): {
  type: "workflow-error";
  data: WorkflowErrorEventData;
} {
  return {
    type: "workflow-error",
    data: {
      retryable: args.retryable ?? true,
      ...args,
    },
  };
}

export function createWorkflowPausedEvent(args: {
  workflowName: string;
  runId: string;
  reason: string;
  payload?: WorkflowPausedEventData["payload"];
  hierarchy: ExecutionHierarchy;
}): {
  type: "workflow-paused";
  data: WorkflowPausedEventData;
} {
  return {
    type: "workflow-paused",
    data: args,
  };
}

export function createWorkflowAbortedEvent(args: {
  workflowName: string;
  runId: string;
  reason?: string;
  hierarchy: ExecutionHierarchy;
}): {
  type: "workflow-aborted";
  data: WorkflowAbortedEventData;
} {
  return {
    type: "workflow-aborted",
    data: args,
  };
}

export function createCustomEvent(args: {
  name: string;
  data: WorkflowCustomEventData["data"];
  hierarchy: ExecutionHierarchy;
}): {
  type: "custom-event";
  data: WorkflowCustomEventData;
} {
  return {
    type: "custom-event",
    data: args,
  };
}

export function createAgentStartEvent(args: {
  agentName: string;
  agentRunId: string;
  hierarchy: ExecutionHierarchy;
}): {
  type: "agent-start";
  data: AgentStartEventData;
} {
  return {
    type: "agent-start",
    data: args,
  };
}

export function createAgentEndEvent(args: {
  agentName: string;
  agentRunId: string;
  success: boolean;
  durationMs: number;
  hierarchy: ExecutionHierarchy;
  usage?: AgentUsageEntry;
}): {
  type: "agent-end";
  data: AgentEndEventData;
} {
  return {
    type: "agent-end",
    data: args,
  };
}

export function createToolStartEvent(args: {
  toolName: string;
  toolCallId: string;
  hierarchy: ExecutionHierarchy;
}): {
  type: "tool-start";
  data: ToolStartEventData;
} {
  return {
    type: "tool-start",
    data: args,
  };
}

export function createToolEndEvent(args: {
  toolName: string;
  toolCallId: string;
  success: boolean;
  durationMs: number;
  hierarchy: ExecutionHierarchy;
}): {
  type: "tool-end";
  data: ToolEndEventData;
} {
  return {
    type: "tool-end",
    data: args,
  };
}

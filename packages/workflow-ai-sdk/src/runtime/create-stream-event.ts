import type {
  AgentUsageEntry,
  ExecutionHierarchy,
  WorkflowCustomEventData,
  WorkflowDataParts,
  WorkflowEndEventData,
  WorkflowExecutionMode,
  WorkflowPausedEventData,
  WorkflowStreamEventFromParts,
} from "./types";

type StreamEvent<T extends keyof WorkflowDataParts> = Extract<
  WorkflowStreamEventFromParts,
  { type: T }
>;

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

export function createWorkflowStartStreamEvent(args: {
  workflowName: string;
  runId: string;
  threadId: string;
  resourceId: string;
  mode: WorkflowExecutionMode;
  resumed: boolean;
  hierarchy: ExecutionHierarchy;
}): StreamEvent<"workflow-start"> {
  return {
    type: "workflow-start",
    data: args,
  };
}

export function createWorkflowStepStreamEvent(args: {
  workflowName: string;
  runId: string;
  stepName: string;
  eventType: string;
  inputEventTypes: string[];
  hierarchy: ExecutionHierarchy;
}): StreamEvent<"workflow-step"> {
  return {
    type: "workflow-step",
    data: args,
  };
}

export function createWorkflowEndStreamEvent(args: {
  workflowName: string;
  runId: string;
  durationMs: number;
  result?: WorkflowEndEventData["result"];
  hierarchy: ExecutionHierarchy;
}): StreamEvent<"workflow-end"> {
  return {
    type: "workflow-end",
    data: args,
  };
}

export function createWorkflowErrorStreamEvent(args: {
  workflowName: string;
  runId: string;
  message: string;
  retryable?: boolean;
  hierarchy: ExecutionHierarchy;
}): StreamEvent<"workflow-error"> {
  return {
    type: "workflow-error",
    data: {
      retryable: args.retryable ?? true,
      ...args,
    },
  };
}

export function createWorkflowPausedStreamEvent(args: {
  workflowName: string;
  runId: string;
  reason: string;
  payload?: WorkflowPausedEventData["payload"];
  hierarchy: ExecutionHierarchy;
}): StreamEvent<"workflow-paused"> {
  return {
    type: "workflow-paused",
    data: args,
  };
}

export function createWorkflowAbortedStreamEvent(args: {
  workflowName: string;
  runId: string;
  reason?: string;
  hierarchy: ExecutionHierarchy;
}): StreamEvent<"workflow-aborted"> {
  return {
    type: "workflow-aborted",
    data: args,
  };
}

export function createCustomStreamEvent(args: {
  name: string;
  data: WorkflowCustomEventData["data"];
  hierarchy: ExecutionHierarchy;
}): StreamEvent<"custom-event"> {
  return {
    type: "custom-event",
    data: args,
  };
}

export function createAgentStartStreamEvent(args: {
  agentName: string;
  agentRunId: string;
  hierarchy: ExecutionHierarchy;
}): StreamEvent<"agent-start"> {
  return {
    type: "agent-start",
    data: args,
  };
}

export function createAgentEndStreamEvent(args: {
  agentName: string;
  agentRunId: string;
  success: boolean;
  durationMs: number;
  hierarchy: ExecutionHierarchy;
  usage?: AgentUsageEntry;
}): StreamEvent<"agent-end"> {
  return {
    type: "agent-end",
    data: args,
  };
}

export function createToolStartStreamEvent(args: {
  toolName: string;
  toolCallId: string;
  hierarchy: ExecutionHierarchy;
}): StreamEvent<"tool-start"> {
  return {
    type: "tool-start",
    data: args,
  };
}

export function createToolEndStreamEvent(args: {
  toolName: string;
  toolCallId: string;
  success: boolean;
  durationMs: number;
  hierarchy: ExecutionHierarchy;
}): StreamEvent<"tool-end"> {
  return {
    type: "tool-end",
    data: args,
  };
}

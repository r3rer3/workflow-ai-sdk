import type {
  AgentUsageEntry,
  ExecutionHierarchy,
  WorkflowCustomEventData,
  WorkflowDataParts,
  WorkflowEndEventData,
  WorkflowExecutionMode,
  WorkflowPausedEventData,
} from "./types";

type Payload<TType extends keyof WorkflowDataParts> = {
  type: TType;
  data: WorkflowDataParts[TType];
};

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

export function createWorkflowStartPayload(args: {
  workflowName: string;
  runId: string;
  threadId: string;
  resourceId: string;
  mode: WorkflowExecutionMode;
  resumed: boolean;
  hierarchy: ExecutionHierarchy;
}): Payload<"workflow-start"> {
  return {
    type: "workflow-start",
    data: args,
  };
}

export function createWorkflowStepPayload(args: {
  workflowName: string;
  runId: string;
  stepName: string;
  eventType: string;
  inputEventTypes: string[];
  hierarchy: ExecutionHierarchy;
}): Payload<"workflow-step"> {
  return {
    type: "workflow-step",
    data: args,
  };
}

export function createWorkflowEndPayload(args: {
  workflowName: string;
  runId: string;
  durationMs: number;
  result?: WorkflowEndEventData["result"];
  hierarchy: ExecutionHierarchy;
}): Payload<"workflow-end"> {
  return {
    type: "workflow-end",
    data: args,
  };
}

export function createWorkflowErrorPayload(args: {
  workflowName: string;
  runId: string;
  message: string;
  retryable?: boolean;
  hierarchy: ExecutionHierarchy;
}): Payload<"workflow-error"> {
  return {
    type: "workflow-error",
    data: {
      retryable: args.retryable ?? true,
      ...args,
    },
  };
}

export function createWorkflowPausedPayload(args: {
  workflowName: string;
  runId: string;
  reason: string;
  payload?: WorkflowPausedEventData["payload"];
  hierarchy: ExecutionHierarchy;
}): Payload<"workflow-paused"> {
  return {
    type: "workflow-paused",
    data: args,
  };
}

export function createWorkflowAbortedPayload(args: {
  workflowName: string;
  runId: string;
  reason?: string;
  hierarchy: ExecutionHierarchy;
}): Payload<"workflow-aborted"> {
  return {
    type: "workflow-aborted",
    data: args,
  };
}

export function createCustomPayload(args: {
  name: string;
  data: WorkflowCustomEventData["data"];
  hierarchy: ExecutionHierarchy;
}): Payload<"custom-event"> {
  return {
    type: "custom-event",
    data: args,
  };
}

export function createAgentStartPayload(args: {
  agentName: string;
  agentRunId: string;
  hierarchy: ExecutionHierarchy;
}): Payload<"agent-start"> {
  return {
    type: "agent-start",
    data: args,
  };
}

export function createAgentEndPayload(args: {
  agentName: string;
  agentRunId: string;
  success: boolean;
  durationMs: number;
  hierarchy: ExecutionHierarchy;
  usage?: AgentUsageEntry;
}): Payload<"agent-end"> {
  return {
    type: "agent-end",
    data: args,
  };
}

export function createToolStartPayload(args: {
  toolName: string;
  toolCallId: string;
  hierarchy: ExecutionHierarchy;
}): Payload<"tool-start"> {
  return {
    type: "tool-start",
    data: args,
  };
}

export function createToolEndPayload(args: {
  toolName: string;
  toolCallId: string;
  success: boolean;
  durationMs: number;
  hierarchy: ExecutionHierarchy;
}): Payload<"tool-end"> {
  return {
    type: "tool-end",
    data: args,
  };
}

import type {
  AgentEndEventData,
  AgentStartEventData,
  AgentUsageEntry,
  ExecutionHierarchy,
  ToolEndEventData,
  ToolStartEventData,
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

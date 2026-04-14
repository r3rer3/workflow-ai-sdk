import type {
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

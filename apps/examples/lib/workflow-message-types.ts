import type { InferUITool } from "ai";
import type {
  WorkflowCustomEvent,
  WorkflowDataParts,
  WorkflowMessageMetadata,
  WorkflowUIMessage,
} from "workflow-ai-sdk";
import type { lookupWeatherTool } from "./tools";

export type ResumeCustomEvent = WorkflowCustomEvent<
  "prep-complete",
  { topic: string }
>;

export type ResumeWorkflowMessage = WorkflowUIMessage<
  WorkflowMessageMetadata,
  WorkflowDataParts<ResumeCustomEvent>
>;

export type DbCustomEvent = WorkflowCustomEvent<
  "persisting",
  { topic: string; steps: number }
>;

export type DbWorkflowMessage = WorkflowUIMessage<
  WorkflowMessageMetadata,
  WorkflowDataParts<DbCustomEvent>
>;

export type ToolResponseMessage = WorkflowUIMessage<
  WorkflowMessageMetadata,
  WorkflowDataParts,
  { "tool-lookup_weather": InferUITool<ReturnType<typeof lookupWeatherTool>> }
>;

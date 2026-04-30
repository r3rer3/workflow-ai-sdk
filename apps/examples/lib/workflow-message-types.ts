import type {
  WorkflowCustomEvent,
  WorkflowDataParts,
  WorkflowMessageMetadata,
  WorkflowUIMessage,
} from "workflow-ai-sdk";

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

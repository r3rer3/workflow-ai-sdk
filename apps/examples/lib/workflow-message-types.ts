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

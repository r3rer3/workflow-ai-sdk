# create-agent

Use this skill when adding or editing an AI SDK agent wrapper.

## What is a workflow agent?

A workflow agent wraps the AI SDK's `ToolLoopAgent` so it participates in the workflow's event stream and has access to the `RuntimeContext`. Under the hood, `createAgent` returns a `WorkflowWrappedAgent` — an object with a `name`, optional `description`, and a `run` method that streams the LLM interaction while emitting lifecycle events.

You create an agent with `createAgent(config)` and call `agent.run(messages, context)` inside a workflow step handler.

## Events emitted by default

Every workflow agent automatically emits lifecycle events without any code in your step handler:

| Event | When | Key fields |
|---|---|---|
| `agent-start` | Before the LLM stream begins | `agentName`, `agentRunId`, `hierarchy` |
| `ui-message-chunk` | For each chunk of the LLM stream (text deltas, tool calls, reasoning, etc.) | `chunk`, `hierarchy` |
| `agent-end` | After the stream completes or throws | `agentName`, `agentRunId`, `success: boolean`, `durationMs`, `usage` |

- On success, `agent-end` is emitted with `success: true` and a `usage` object containing model id, token counts, and finish reason.
- If the stream throws, `agent-end` is emitted with `success: false`, and the `run` method returns `{ success: false, error: "..." }` (it does **not** re-throw).

## CreateAgentConfig

The config extends the AI SDK's `ToolLoopAgentSettings` (minus `tools` and `id`) with workflow-specific fields:

| Field | Required | Purpose |
|---|---|---|
| `name` | Yes | Identifies the agent in events and hierarchy |
| `description` | No | Human-readable description |
| `model` | Yes | AI SDK language model (e.g. `openai("gpt-4.1-mini")`) |
| `instructions` | No | System prompt for the agent |
| `tools` | No | Array of `WorkflowTool` factories (not instantiated tools) |
| `agent` | No | Override with a custom `Agent` instance instead of the default `ToolLoopAgent` |

All other `ToolLoopAgentSettings` fields (`maxSteps`, `onStepFinish`, etc.) are also accepted.

## WorkflowWrappedAgentResult

The `run` method returns:

```ts
{
  success: boolean;
  error?: string;           // set when success is false
  streamResult: StreamTextResult;  // AI SDK stream result (access `.text`, `.usage`, etc.)
  usage?: AgentUsageEntry;  // model, totalUsage, finishReason
}
```

## Example — basic agent

```ts
import { openai } from "@ai-sdk/openai";
import { createAgent, createStep, defineWorkflow, workflowEvent } from "workflow-ai-sdk";
import { z } from "zod";

interface ChatState {
  latestUserMessage: string;
  [key: string]: unknown;
}

const startEvent = workflowEvent("chat.start", z.object({ message: z.string() }));
const endEvent = workflowEvent("chat.end", z.object({ reply: z.string() }));

// 1. Create the agent
const chatAssistant = createAgent<ChatState>({
  name: "chat-assistant",
  model: openai("gpt-4.1-mini"),
  instructions: "Reply helpfully and concisely to the user's latest message.",
});

// 2. Use the agent inside a workflow step
const chatWorkflow = defineWorkflow<{ message: string }, ChatState, { reply: string }>({
  name: "chat-workflow",
  trigger: startEvent,
  finish: endEvent,
  initialState({ input }) {
    return { latestUserMessage: input.message };
  },
  steps: [
    createStep(startEvent, async (context, event) => {
      context.state.latestUserMessage = event.message;

      // Run the agent — it emits agent-start, ui-message-chunk (×N), agent-end
      const result = await chatAssistant.run(context.messages, context);
      const reply = await result.streamResult.text;

      return endEvent.create({ reply });
    }),
  ],
});
```

## Example — agent with workflow tools

When you pass `WorkflowTool` factories to `createAgent`, the agent instantiates each tool with the `RuntimeContext` automatically. This gives tools access to state mutation, event dispatch, and checkpointing.

```ts
import { openai } from "@ai-sdk/openai";
import { createAgent, createWorkflowTool } from "workflow-ai-sdk";
import { z } from "zod";

interface ResearchState {
  findings: string[];
  [key: string]: unknown;
}

const saveFindingTool = createWorkflowTool<
  { finding: string },
  { saved: boolean },
  ResearchState
>({
  name: "save_finding",
  description: "Save a research finding to workflow state.",
  inputSchema: z.object({
    finding: z.string().describe("A concise research finding."),
  }),
  execute: async (input, _options, context) => {
    context.state.findings.push(input.finding);
    return { saved: true };
  },
});

const researchAgent = createAgent<ResearchState>({
  name: "researcher",
  model: openai("gpt-4.1-mini"),
  instructions: "Research the topic and save each finding using the save_finding tool.",
  tools: [saveFindingTool],
});
```

## Example — multi-agent handoff

Multiple agents can run in sequence across different workflow steps. Each agent's events are scoped by its own `agentRunId` in the hierarchy.

```ts
const coordinatorAgent = createAgent<AgentHandoffState>({
  name: "coordinator-agent",
  model: openai("gpt-4.1-mini"),
  instructions: "Decide what to research and hand off to the research tool.",
  tools: [handoffToResearchTool],
});

const researcherAgent = createAgent<AgentHandoffState>({
  name: "researcher-agent",
  model: openai("gpt-4.1-mini"),
  instructions: "Look up findings and report back.",
  tools: [lookupBriefTool],
});

// In step 1: coordinatorAgent.run(messages, context)
// In step 2: researcherAgent.run(messages, context)
// Each emits its own agent-start → ui-message-chunk* → agent-end sequence.
```

## Checklist

1. Define the agent with `createAgent<TState>({ name, model, ... })`.
2. Pass workflow tools via the `tools` array (factories, not instances).
3. Call `agent.run(messages, context)` inside a step handler.
4. Check `result.success` — the agent does not throw on LLM errors.
5. Access the generated text with `await result.streamResult.text`.
6. If the agent uses tools that dispatch events, ensure downstream steps handle those events.

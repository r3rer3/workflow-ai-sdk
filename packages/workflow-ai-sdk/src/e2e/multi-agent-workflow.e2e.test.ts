import { describe, expect, it } from "bun:test";
import { simulateReadableStream } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

import {
  createAgent,
  createWorkflowTool,
  defineWorkflow,
  type WorkflowStreamEvent,
  type WorkflowUIMessage,
  workflowEvent,
} from "../index";

type BranchId = "a" | "b";

type ResearchFinding = {
  agentName: string;
  branchId: BranchId;
  note: string;
  toolName: string;
};

interface MultiAgentState {
  findings: Partial<Record<BranchId, ResearchFinding>>;
  [key: string]: unknown;
}

const branchSpecs = {
  a: {
    agentName: "research-agent-a",
    branchId: "a" as const,
    finalText: "Alpha branch conclusion.",
    note: "alpha evidence",
    textId: "text_alpha",
    toolCallId: "lookup_alpha_call",
    toolName: "lookup_alpha",
  },
  b: {
    agentName: "research-agent-b",
    branchId: "b" as const,
    finalText: "Beta branch conclusion.",
    note: "beta evidence",
    textId: "text_beta",
    toolCallId: "lookup_beta_call",
    toolName: "lookup_beta",
  },
} as const satisfies Record<
  BranchId,
  {
    agentName: string;
    branchId: BranchId;
    finalText: string;
    note: string;
    textId: string;
    toolCallId: string;
    toolName: string;
  }
>;

const branchIds = Object.keys(branchSpecs) as BranchId[];

const endEvent = workflowEvent(
  "multi-agent.end",
  z.object({
    findings: z.array(
      z.object({
        agentName: z.string(),
        branchId: z.enum(["a", "b"]),
        note: z.string(),
        toolName: z.string(),
      }),
    ),
    summary: z.string(),
  }),
);

async function collectStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const values: T[] = [];

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    values.push(value);
  }

  return values;
}

function createResearchTool(branchId: BranchId) {
  const spec = branchSpecs[branchId];

  return createWorkflowTool<
    MultiAgentState,
    { topic: string },
    { note: string }
  >({
    name: spec.toolName,
    inputSchema: z.object({
      topic: z.string(),
    }),
    execute: async (_input, _options, context) => {
      context.state.findings[branchId] = {
        agentName: spec.agentName,
        branchId,
        note: spec.note,
        toolName: spec.toolName,
      };

      return {
        note: spec.note,
      };
    },
  });
}

function createResearchModel(branchId: BranchId) {
  const spec = branchSpecs[branchId];
  let callCount = 0;

  return new MockLanguageModelV3({
    doStream: async () => {
      callCount += 1;

      return callCount === 1
        ? {
          stream: convertArrayToReadableStream([
            {
              type: "tool-call" as const,
              toolCallId: spec.toolCallId,
              toolName: spec.toolName,
              input: JSON.stringify({
                topic: spec.branchId,
              }),
            },
            {
              type: "finish" as const,
              finishReason: {
                unified: "tool-calls" as const,
                raw: "tool-calls",
              },
              usage: {
                inputTokens: {
                  total: 4,
                  noCache: 4,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                outputTokens: {
                  total: 2,
                  text: 0,
                  reasoning: 0,
                },
              },
            },
          ]),
        }
        : {
          stream: simulateReadableStream({
            chunks: [
              { type: "text-start" as const, id: spec.textId },
              {
                type: "text-delta" as const,
                id: spec.textId,
                delta: spec.finalText,
              },
              { type: "text-end" as const, id: spec.textId },
              {
                type: "finish" as const,
                finishReason: {
                  unified: "stop" as const,
                  raw: "stop",
                },
                usage: {
                  inputTokens: {
                    total: 6,
                    noCache: 6,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: {
                    total: 4,
                    text: 4,
                    reasoning: 0,
                  },
                },
              },
            ],
            chunkDelayInMs: branchId === "a" ? 1 : 4,
          }),
        };
    },
  });
}

function createSynthesisModel() {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: "text-start" as const, id: "text_summary" },
        {
          type: "text-delta" as const,
          id: "text_summary",
          delta: "Combined alpha and beta findings.",
        },
        { type: "text-end" as const, id: "text_summary" },
        {
          type: "finish" as const,
          finishReason: {
            unified: "stop" as const,
            raw: "stop",
          },
          usage: {
            inputTokens: {
              total: 8,
              noCache: 8,
              cacheRead: 0,
              cacheWrite: 0,
            },
            outputTokens: {
              total: 5,
              text: 5,
              reasoning: 0,
            },
          },
        },
      ]),
    }),
  });
}

function eventLabel(event: WorkflowStreamEvent<WorkflowUIMessage>): string {
  switch (event.type) {
    case "workflow-start":
    case "workflow-end":
      return event.type;
    case "workflow-step":
      return `${event.type}:${event.data.stepName}`;
    case "agent-start":
    case "agent-end":
      return `${event.type}:${event.data.agentName}`;
    case "tool-start":
    case "tool-end":
      return `${event.type}:${event.data.hierarchy.agentName}:${event.data.toolName}`;
    case "ui-message-chunk":
      return `chunk:${event.data.hierarchy.agentName}:${event.data.chunk.type}`;
    default:
      return event.type;
  }
}

function eventsForAgentRun(
  events: WorkflowStreamEvent<WorkflowUIMessage>[],
  agentRunId: string,
) {
  return events.filter(
    (event) => event.data.hierarchy.agentRunId === agentRunId,
  );
}

function chunkTypesForAgentRun(
  events: WorkflowStreamEvent<WorkflowUIMessage>[],
  agentRunId: string,
) {
  return eventsForAgentRun(events, agentRunId)
    .filter(
      (
        event,
      ): event is Extract<
        WorkflowStreamEvent<WorkflowUIMessage>,
        { type: "ui-message-chunk" }
      > => event.type === "ui-message-chunk",
    )
    .map((event) => event.data.chunk.type);
}

function eventTypesForAgentRun(
  events: WorkflowStreamEvent<WorkflowUIMessage>[],
  agentRunId: string,
) {
  return eventsForAgentRun(events, agentRunId).map((event) =>
    event.type === "ui-message-chunk"
      ? `chunk:${event.data.chunk.type}`
      : event.type,
  );
}

describe("multi-agent workflow e2e", () => {
  it("streams a deterministic multi-step workflow with parallel agents and ordered AI SDK events", async () => {
    const startEvent = workflowEvent("multi-agent.start");
    const branchEvent = workflowEvent(
      "multi-agent.branch",
      z.object({
        branchId: z.enum(["a", "b"]),
      }),
    );
    const aggregateEvent = workflowEvent("multi-agent.aggregate");

    const researchTools = {
      a: createResearchTool("a"),
      b: createResearchTool("b"),
    } as const;
    const researchAgents = {
      a: createAgent<MultiAgentState>({
        name: branchSpecs.a.agentName,
        model: createResearchModel("a"),
        tools: [researchTools.a],
      }),
      b: createAgent<MultiAgentState>({
        name: branchSpecs.b.agentName,
        model: createResearchModel("b"),
        tools: [researchTools.b],
      }),
    } as const;
    const synthesisAgent = createAgent<MultiAgentState>({
      name: "synthesis-agent",
      model: createSynthesisModel(),
    });

    const workflow = defineWorkflow({
      name: "multi-agent-workflow-e2e",
      trigger: startEvent,
      finish: endEvent,
      initialState(): MultiAgentState {
        return {
          findings: {},
        };
      },
    })
      .step(
        startEvent,
        async (context) => {
          const branches = branchIds.map((branchId) =>
            context.dispatch(
              branchEvent.create({
                branchId,
              }),
            ),
          );

          await Promise.all(branches);
          return aggregateEvent.create();
        },
        {
          name: "dispatch-branches",
        },
      )
      .step(
        branchEvent,
        async (context, event) => {
          const agent = researchAgents[event.branchId];

          await agent.run(
            [
              {
                id: `msg_${event.branchId}`,
                role: "user",
                parts: [
                  {
                    type: "text",
                    text: `Run branch ${event.branchId}`,
                  },
                ],
              },
            ],
            context,
          );
        },
        {
          name: "run-branch",
        },
      )
      .step(
        aggregateEvent,
        async (context) => {
          const findings = branchIds
            .map((branchId) => context.state.findings[branchId])
            .filter(
              (finding): finding is ResearchFinding => finding !== undefined,
            );

          const result = await synthesisAgent.run(
            [
              {
                id: "msg_summary",
                role: "user",
                parts: [
                  {
                    type: "text",
                    text: findings
                      .map(
                        (finding) =>
                          `${finding.agentName}:${finding.toolName}:${finding.note}`,
                      )
                      .join("\n"),
                  },
                ],
              },
            ],
            context,
          );

          return endEvent.create({
            findings,
            summary: await result.streamResult.text,
          });
        },
        {
          name: "synthesize",
        },
      );

    const execution = await workflow.run({
      mode: "abortable",
    });
    const events = await collectStream(execution.stream);

    const workflowEndEvent = events.find(
      (
        event,
      ): event is Extract<
        WorkflowStreamEvent<WorkflowUIMessage>,
        { type: "workflow-end" }
      > => event.type === "workflow-end",
    );
    const agentStartEvents = events.filter(
      (
        event,
      ): event is Extract<
        WorkflowStreamEvent<WorkflowUIMessage>,
        { type: "agent-start" }
      > => event.type === "agent-start",
    );
    const researchAgentRunIds = agentStartEvents
      .filter((event) => event.data.agentName !== "synthesis-agent")
      .map((event) => event.data.agentRunId);
    const synthesisAgentRunId = agentStartEvents.find(
      (event) => event.data.agentName === "synthesis-agent",
    )?.data.agentRunId;
    const toolLifecycleEvents = events.filter(
      (
        event,
      ): event is Extract<
        WorkflowStreamEvent<WorkflowUIMessage>,
        { type: "tool-start" | "tool-end" }
      > => event.type === "tool-start" || event.type === "tool-end",
    );

    expect(workflowEndEvent?.data.result).toEqual({
      findings: [
        {
          agentName: "research-agent-a",
          branchId: "a",
          note: "alpha evidence",
          toolName: "lookup_alpha",
        },
        {
          agentName: "research-agent-b",
          branchId: "b",
          note: "beta evidence",
          toolName: "lookup_beta",
        },
      ],
      summary: "Combined alpha and beta findings.",
    });

    expect(researchAgentRunIds).toHaveLength(2);
    expect(new Set(researchAgentRunIds).size).toBe(2);
    expect(synthesisAgentRunId).toBeTruthy();

    const researchAgentRunIdsByName = Object.fromEntries(
      agentStartEvents
        .filter((event) => event.data.agentName !== "synthesis-agent")
        .map((event) => [event.data.agentName, event.data.agentRunId]),
    ) as Record<(typeof branchSpecs)[BranchId]["agentName"], string>;
    for (const branchId of branchIds) {
      const spec = branchSpecs[branchId];

      expect(
        eventTypesForAgentRun(
          events,
          researchAgentRunIdsByName[spec.agentName],
        ),
      ).toEqual([
        "agent-start",
        "tool-start",
        "chunk:start-step",
        "chunk:tool-input-available",
        "chunk:tool-output-available",
        "tool-end",
        "chunk:finish-step",
        "chunk:start-step",
        "chunk:text-start",
        "chunk:text-delta",
        "chunk:text-end",
        "chunk:finish-step",
        "agent-end",
      ]);
    }

    for (const agentRunId of researchAgentRunIds) {
      expect(chunkTypesForAgentRun(events, agentRunId)).toEqual([
        "start-step",
        "tool-input-available",
        "tool-output-available",
        "finish-step",
        "start-step",
        "text-start",
        "text-delta",
        "text-end",
        "finish-step",
      ]);
    }

    expect(
      chunkTypesForAgentRun(events, synthesisAgentRunId as string),
    ).toEqual([
      "start-step",
      "text-start",
      "text-delta",
      "text-end",
      "finish-step",
    ]);

    expect(
      toolLifecycleEvents.map((event) => ({
        agentName: event.data.hierarchy.agentName,
        agentRunId: event.data.hierarchy.agentRunId,
        toolCallId: event.data.toolCallId,
        toolName: event.data.toolName,
        type: event.type,
      })),
    ).toEqual([
      {
        agentName: "research-agent-a",
        agentRunId: researchAgentRunIds[0],
        toolCallId: "lookup_alpha_call",
        toolName: "lookup_alpha",
        type: "tool-start",
      },
      {
        agentName: "research-agent-b",
        agentRunId: researchAgentRunIds[1],
        toolCallId: "lookup_beta_call",
        toolName: "lookup_beta",
        type: "tool-start",
      },
      {
        agentName: "research-agent-a",
        agentRunId: researchAgentRunIds[0],
        toolCallId: "lookup_alpha_call",
        toolName: "lookup_alpha",
        type: "tool-end",
      },
      {
        agentName: "research-agent-b",
        agentRunId: researchAgentRunIds[1],
        toolCallId: "lookup_beta_call",
        toolName: "lookup_beta",
        type: "tool-end",
      },
    ]);

    const labels = events.map(eventLabel);
    expect(labels).toEqual([
      "workflow-start",
      "workflow-step:dispatch-branches",
      "workflow-step:run-branch",
      "workflow-step:run-branch",
      "agent-start:research-agent-a",
      "agent-start:research-agent-b",
      "tool-start:research-agent-a:lookup_alpha",
      "tool-start:research-agent-b:lookup_beta",
      "chunk:research-agent-a:start-step",
      "chunk:research-agent-b:start-step",
      "chunk:research-agent-a:tool-input-available",
      "chunk:research-agent-b:tool-input-available",
      "chunk:research-agent-a:tool-output-available",
      "tool-end:research-agent-a:lookup_alpha",
      "chunk:research-agent-b:tool-output-available",
      "tool-end:research-agent-b:lookup_beta",
      "chunk:research-agent-a:finish-step",
      "chunk:research-agent-b:finish-step",
      "chunk:research-agent-a:start-step",
      "chunk:research-agent-a:text-start",
      "chunk:research-agent-b:start-step",
      "chunk:research-agent-b:text-start",
      "chunk:research-agent-a:text-delta",
      "chunk:research-agent-a:text-end",
      "chunk:research-agent-b:text-delta",
      "chunk:research-agent-a:finish-step",
      "agent-end:research-agent-a",
      "chunk:research-agent-b:text-end",
      "chunk:research-agent-b:finish-step",
      "agent-end:research-agent-b",
      "workflow-step:synthesize",
      "agent-start:synthesis-agent",
      "chunk:synthesis-agent:start-step",
      "chunk:synthesis-agent:text-start",
      "chunk:synthesis-agent:text-delta",
      "chunk:synthesis-agent:text-end",
      "chunk:synthesis-agent:finish-step",
      "agent-end:synthesis-agent",
      "workflow-end",
    ]);
  });
});

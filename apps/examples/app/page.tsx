import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

type Item = {
  index: string;
  title: string;
  path: string;
  description: string;
};

type Section = {
  id: string;
  label: string;
  items: Item[];
};

const sections: Section[] = [
  {
    id: "fundamentals",
    label: "Fundamentals",
    items: [
      {
        index: "01",
        title: "Basic chat",
        path: "/chat",
        description:
          "Workflow that streams text chunks. Start here to see the minimum route shape.",
      },
      {
        index: "02",
        title: "Resumable workflow",
        path: "/resume",
        description:
          "Two-step workflow that pauses for approval and resumes from a checkpoint.",
      },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    items: [
      {
        index: "03",
        title: "Tool response",
        path: "/tool-response",
        description:
          "Workflow step calls a lookup_weather tool and summarizes the structured result.",
      },
      {
        index: "04",
        title: "Tool approval (AI SDK style)",
        path: "/tool-approval-ai-sdk",
        description:
          "Tool declared with needsApproval: true. The workflow pauses on the approval request and resumes after the client echoes a decision.",
      },
      {
        index: "05",
        title: "Tool approval (workflow style)",
        path: "/tool-approval-workflow",
        description:
          "Workflow step — not the tool — owns the approval policy. Pauses before calling delete_record.",
      },
    ],
  },
  {
    id: "orchestration",
    label: "Orchestration",
    items: [
      {
        index: "06",
        title: "Agent handoff",
        path: "/agent-handoff",
        description:
          "A coordinator agent hands work to a second agent through workflow events and mailbox state. Best for sequential cross-agent handoffs.",
      },
      {
        index: "07",
        title: "Parallel research",
        path: "/parallel-research",
        description:
          "An orchestrator agent spawns multiple subagents, the subagents exchange direct peer messages through a common mailbox, and a synthesis agent merges the final findings.",
      },
    ],
  },
  {
    id: "persistence",
    label: "Persistence",
    items: [
      {
        index: "08",
        title: "Supabase-backed run",
        path: "/db",
        description:
          "Authenticated run persisted under Row Level Security. Sign in via /api/auth (the page handles it), then start a run scoped to your user_id.",
      },
    ],
  },
];

export default function Page() {
  return (
    <main className="min-h-dvh bg-cream text-ink">
      <div className="mx-auto max-w-4xl px-6 py-20 md:py-28">
        <header className="mb-20 md:mb-28">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-amber">
            workflow-ai-sdk
          </p>
          <h1 className="mt-3 font-serif font-medium tracking-tight text-[clamp(2.75rem,7vw,5rem)] leading-[0.95]">
            Example chat routes and workflow scaffolds.
          </h1>
          <p className="mt-8 max-w-2xl text-lg leading-relaxed text-ink-muted">
            Each entry below points at an API route in this app that
            demonstrates one workflow-ai-sdk pattern — from the minimum
            abortable route shape, through tool-calling and approval flows, to
            multi-agent orchestration.
          </p>
        </header>

        <div className="space-y-16 md:space-y-20">
          {sections.map((section) => (
            <section key={section.id}>
              <div className="mb-6 flex items-baseline gap-4">
                <h2 className="whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.18em] text-amber">
                  {section.label}
                </h2>
                <hr className="h-px flex-1 border-0 bg-rule" />
              </div>

              <ul className="divide-y divide-rule">
                {section.items.map((item) => (
                  <li key={item.path}>
                    <Link
                      href={item.path}
                      className="group flex items-start gap-6 py-6 transition-colors hover:text-amber md:gap-10"
                    >
                      <span className="pt-2 font-mono text-xs tabular-nums text-ink-muted">
                        {item.index}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-serif text-2xl leading-tight md:text-3xl">
                          {item.title}
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                          {item.description}
                        </p>
                        <code className="mt-3 inline-block font-mono text-xs text-ink-muted">
                          {item.path}
                        </code>
                      </div>
                      <ArrowUpRight
                        aria-hidden
                        className="mt-2 size-4 shrink-0 text-ink-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-amber"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="mt-24 border-t border-rule pt-6 font-mono text-xs uppercase tracking-[0.14em] text-ink-muted">
          8 examples · Next.js · workflow-ai-sdk
        </footer>
      </div>
    </main>
  );
}

# AGENTS.md

This repository is designed to be agent-friendly.

## Commands

- Install dependencies: `bun install`
- Build all packages and apps: `bun run build`
- Typecheck everything: `bun run typecheck`
- Run tests: `bun run test`
- Lint and format check: `bun run lint`

## Repository Shape

- `packages/workflow-ai-sdk`: public workflow runtime, AI SDK wrappers, and stream adapters
- `apps/examples`: Next.js example app showing chat routes, workflow usage, and a Supabase + RLS persistence example
- `apps/docs`: Vite-based documentation app
- `skills/*`: focused instructions for agents extending workflows, agents, tools, and persistence

## Architecture

- Workflows are event-driven and step-based.
- AI SDK remains the source of truth for model, tool, and UI streaming behavior.
- Durability is explicit: a workflow route is either `abortable` or `resumable`.
- Persistence is adapter-shaped: the core exposes a `WorkflowStore` interface; Supabase is an example integration, not a published package.

## Guardrails

- Prefer updating the core package before changing examples.
- Keep public APIs small and typed.
- Preserve AI SDK-native chunk shapes when streaming to clients.
- Supabase is example-only. Rely on app-owned schema + RLS rather than any first-party schema or table naming in the core runtime.

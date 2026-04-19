# create-tool

Use this skill when adding or editing a workflow-aware tool.

## What is a workflow tool?

A workflow tool wraps an AI SDK `tool()` so it participates in the workflow's event stream and has access to the `RuntimeContext`. Under the hood, `createWorkflowTool` is a **factory that returns a factory**: it produces a `WorkflowTool` function that, when called with a `RuntimeContext`, yields a concrete AI SDK `Tool` instance.

You never need to instantiate workflow tools yourself when using them with `createAgent` — the agent calls each factory with the runtime context automatically.

## Events emitted by default

Every workflow tool automatically emits two lifecycle events without any code in your `execute` function:

| Event | When | Key fields |
|---|---|---|
| `tool-start` | Before `execute` runs (via the `onInputStart` hook) | `toolName`, `toolCallId`, `hierarchy` |
| `tool-end` | After `execute` resolves or rejects | `toolName`, `toolCallId`, `success: boolean`, `durationMs` |

- On success, `tool-end` is emitted with `success: true`.
- If `execute` throws, `tool-end` is emitted with `success: false`, then the error is re-thrown.
- Tools without an `execute` function (ask-the-user style) only emit `tool-start`.

## RuntimeContext available inside `execute`

The `execute` function receives the `RuntimeContext` as its **third** argument (after `input` and `options`):

```ts
execute: async (input, options, context) => { ... }
```

Through `context` you can:

| Property / Method | Purpose |
|---|---|
| `context.state` | Read and mutate the workflow's typed state |
| `context.messages` | Read the current message history |
| `context.emit(event)` | Push a custom stream event to the client |
| `context.dispatch(...events)` | Fire workflow events that trigger other steps |
| `context.checkpoint()` | Persist execution state (resumable mode) |
| `context.pause(pause)` | Pause the workflow and wait for external input |
| `context.signal` | The `AbortSignal` for the current run |
| `context.runId` / `context.threadId` / `context.resourceId` | Identifiers for the current execution |
| `context.mode` | `"abortable"` or `"resumable"` |
| `context.getHierarchy()` | The current `ExecutionHierarchy` (workflow → agent → tool) |

## Example

```ts
import { createWorkflowTool } from "workflow-ai-sdk";
import { z } from "zod";

interface OrderState {
  totalItems: number;
  [key: string]: unknown;
}

const addToCartTool = createWorkflowTool<
  { productId: string; quantity: number },  // TInput
  { added: boolean; cartSize: number },     // TOutput
  OrderState                                // TState
>({
  name: "add_to_cart",
  description: "Add a product to the shopping cart.",
  inputSchema: z.object({
    productId: z.string(),
    quantity: z.number().int().positive(),
  }),
  execute: async (input, _options, context) => {
    // Mutate workflow state — persisted across steps and checkpoints.
    context.state.totalItems += input.quantity;

    // Emit a custom event so the client can show a cart update immediately.
    context.emit({
      type: "custom-event",
      data: {
        name: "cart-updated",
        data: { productId: input.productId, totalItems: context.state.totalItems },
        hierarchy: context.getHierarchy(),
      },
    });

    return { added: true, cartSize: context.state.totalItems };
    // ↑ This return value is sent back to the LLM as the tool result.
    // A `tool-start` event was already emitted before this function ran,
    // and a `tool-end` event with `success: true` will be emitted after it returns.
  },
});
```

### Using the tool with an agent

Pass the workflow tool factory to `createAgent` via the `tools` array. The agent will instantiate it with the runtime context automatically:

```ts
import { createAgent } from "workflow-ai-sdk";
import { openai } from "@ai-sdk/openai";

const shoppingAgent = createAgent<OrderState>({
  name: "shopping-assistant",
  model: openai("gpt-4.1-mini"),
  instructions: "Help the user add items to their cart.",
  tools: [addToCartTool],
});
```

### Tools without `execute`

Omitting `execute` creates an "ask-the-user" tool — the LLM can call it, but the result must be provided externally (e.g. by the client). Only a `tool-start` event is emitted:

```ts
const askUserTool = createWorkflowTool<{ question: string }, never, {}>({
  name: "ask_user",
  description: "Ask the user a clarifying question.",
  inputSchema: z.object({
    question: z.string(),
  }),
  // No execute — the client provides the tool result.
});
```

# shot-planner: spec

A chat agent that turns a creative brief into a storyboard, then generates each shot through image and video
generation APIs, using tool calls. It is a showcase repository for LLM-powered features and conversational
interfaces built on third-party AI APIs.

## Scope (locked)

### The experience
- **Two panes:** a chat on the left and a storyboard on the right.
- **The flow:** the user writes a brief ("a 20-second teaser for a ceramic studio, warm morning light"). The agent
  asks at most one or two clarifying questions, then proposes a shot list as cards: shot number, duration, framing,
  camera move, a description, and the generation prompt.
- **Revising in chat:** the user steers by talking ("make shot 2 a close-up", "add a final logo shot", "shorter"),
  and the agent edits the board through tools. The cards animate when they change.
- **Generating:** "Generate" on a shot, or "generate all", calls the image provider for a keyframe and then,
  optionally, the video provider for a short clip. Each card shows its own status (queued → generating → done or
  failed), with progress and the result inline.
- **Streaming:** the assistant's text streams token by token, and tool calls show as small inline "actions" in the
  chat (e.g. "Updated shot 2: framing → close-up").
- **Export:** the storyboard as JSON, and as a printable page.

### Agent design
- **Model:** the Anthropic Messages API with tool use and streaming, through `@anthropic-ai/sdk`. The model is
  configurable, defaulting to a current Claude model.
- **Tools:** each has a Zod schema converted to JSON Schema:
  - `create_storyboard({ title, aspectRatio, shots[] })`
  - `update_shot({ shotId, patch })`
  - `add_shot({ afterShotId?, shot })`
  - `remove_shot({ shotId })`
  - `reorder_shots({ order[] })`
  - `generate_shot({ shotId, mode: "image" | "video" })`
- **The board is the source of truth.** Tools are applied by a pure reducer: `(Storyboard, ToolCall) → Storyboard`,
  or a typed error that is returned to the model as a `tool_result` with `is_error`. This keeps the model honest
  and the logic testable.
- **The loop:** the agent loop runs on the server. It streams events (text deltas, tool calls, board snapshots, and
  generation progress) to the client over SSE. There is a step limit and cancellation (stop button).
- **Context:** the system prompt holds the house style for shot lists. The conversation is trimmed by a simple
  token budget.

### Providers
Each is behind an interface:
- **`ImageProvider`:** `generate(prompt, aspectRatio) → url`.
- **`VideoProvider`:** `animate(imageUrl, prompt, seconds) → job`, polled until it is done.
- **Real adapters:** use the Runway API (`@runwayml/sdk`), image and image-to-video, with keys from env. Check the
  current SDK and its docs for the exact models and endpoints, and keep the adapter thin.
- **Mock providers:** the default when no keys are set. They return deterministic generated SVG/PNG keyframes
  (shapes and colours derived from the prompt) and a short fake progress, so the demo and the tests run with zero
  keys. The README explains both modes.
- **Planner fallback:** if `ANTHROPIC_API_KEY` is missing, a scripted mock planner replays a canned conversation, so
  the UI still demonstrates the flow. A banner says "demo mode".

## Architecture
- **`src/domain/`:** Storyboard, Shot, the reducer, and validation. Pure and fully tested.
- **`src/agent/`:**
  - the tool definitions (Zod → JSON Schema);
  - the loop (`runAgent(messages, tools, model) → AsyncIterable<AgentEvent>`), tested with a fake Anthropic
    client that replays scripted streams;
  - token budgeting.
- **`src/providers/`:** the interfaces, the Runway adapters and the mocks.
- **`src/server/`:** Hono on Node, with `POST /api/chat` (SSE) and `POST /api/generate`.
- **`src/web/`:** React 19 + Vite UI, a Zustand store fed by the SSE events, and Motion for the card transitions.
- **Style:** quiet and technical. Paper or graphite with one orange accent (`#ff5a1f`), and Geist sans. It must
  look like a real product.

## Repository standards
- Node 22, TypeScript strict, `@anthropic-ai/sdk`, `@runwayml/sdk`, Zod, Hono, React 19, Vite, Zustand, Motion,
  Vitest, ESLint, and pnpm.
- `pnpm dev` runs the server and web together. `pnpm gate` = typecheck + lint + test + build. A GitHub Actions
  workflow runs the gate.
- **README:**
  - two sentences on what it is;
  - a screenshot placeholder;
  - how the agent works, with a diagram of brief → tool calls → reducer → board → generation;
  - the tool list;
  - the mock vs real modes;
  - running it, and the env vars (`.env.example`).
- MIT licence. No keys are ever committed.

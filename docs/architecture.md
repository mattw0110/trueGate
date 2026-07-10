# Architecture

trueGate is a thin Fastify proxy. Every request flows through a four-stage pipeline:

```
                      ┌────────────────────────┐
 client ───── POST ──▶│ governance-loader hook │  loads operator governance
 (Claude   /v1/…     │    (onRequest)         │  from data/ + .state/
  Code,               └───────────┬────────────┘
  Cursor,                         ▼
  SDK…)               ┌────────────────────────┐
                      │  model routing         │  pickUpstreamForModel()
                      │  (per-request)         │  exact match → prefix pattern
                      │                        │  → highest-priority fallback
                      └───────────┬────────────┘
                                  ▼
                      ┌────────────────────────┐
                      │  governance injection  │  injects system message
                      │  + upstream HTTP call  │  forwards auth headers
                      │                        │
                      └───────────┬────────────┘
                                  ▼
                      ┌────────────────────────┐
                      │  response validator    │  runs all validators
                      │  + marker append       │  block → refusal
                      │                        │  warn → appended notice
                      └───────────┬────────────┘
                                  ▼
                              client
                     (+ x-truegate-upstream header
                      + "— trueGate · provider/model" trailer)
```

---

## Key modules

### `src/registry/`

Builds the upstream registry at startup:

- **`upstream-registry.ts`** — probes each potential upstream in parallel (1.5s timeout each), enumerates available models, builds `UpstreamEndpoint[]` sorted by priority.
- **`route-model.ts`** — `pickUpstreamForModel(model, registry, config)` resolves which endpoint serves a given model. Resolution order: forced provider → `modelOverrides` → exact match → prefix patterns (`claude-*`, `gpt-*`, `llama*`, …) → substring scan → fallback to highest-priority reachable upstream.
- **`model-patterns.ts`** — prefix-to-provider hints.
- **`probe.ts`** — shared HTTP probe helper with configurable timeout and JSON parsing.

### `src/governance/`

Loads and compiles operator governance at request time:

- **`loaders/global-loader.ts`** — reads `.state/governance.md` + `.state/rules.yaml` (operator overrides), falling back to `data/governance.md` + `data/rules.yaml` (shipped defaults) per file. Returns `null` if neither exists.
- **`compiler/merge-context.ts`** — calls the global loader and returns the file list.
- **`compiler/resolve-priority.ts`** — sorts files (single source: `global`), extracts `RuleSet`.
- **`compiler/build-runtime-context.ts`** — builds the system-message text.
- **`compiler/anthropic-injector.ts`** — inserts governance into Anthropic `system` field.
- **`compiler/responses-injector.ts`** — appends governance to Responses API `instructions`.

### `src/validators/`

- **`rules/dangerous-patterns.ts`** — hardcoded block regexes + user patterns from `rules.yaml`.
- **`rules/forbidden-dependencies.ts`**, **`forbidden-frameworks.ts`**, **`typescript-rules.ts`** — per-rule validators.
- **`engine/validate-response.ts`** — fan-out, aggregate across all validators.
- **`reporting/response-marker.ts`** — `formatMarker(base, provider, model)` produces `— trueGate · cliproxy/claude-sonnet-4-6`.

### `src/proxy/routes/`

| Route | Shape | Governance injection |
| --- | --- | --- |
| `chat-completions.ts` | OpenAI chat | Prepended system message; Anthropic translator active when endpoint is `anthropic` |
| `messages.ts` | Anthropic native | Injected into `system` field |
| `responses.ts` | OpenAI Responses | Appended to `instructions` |

All three routes:

1. Call `pickUpstreamForModel` to resolve the endpoint for this request's model.
2. Log `routed model=X → provider (url) via reason`.
3. Set `x-truegate-upstream: provider/model` response header.
4. Append `— trueGate · provider/model` marker via `formatMarker`.

### `src/proxy/tool-translation.ts`

Handles agent-zero clients that send OpenAI-shaped requests but expect `{"thoughts":…,"tool_name":…,"tool_args":…}` JSON envelope responses. Key behaviors:

- **`detectClientConvention`** — sniffs `response_format.json_schema.name === 'agent_zero_envelope'`.
- **`parseUpstreamCall`** — tries every parser (OpenAI tool_calls, Anthropic tool_use, agent-zero envelope, XML function_calls, prose tool calls, bash fences) in order.
- **`translateResponseToConvention`** — normalizes upstream response to agent-zero envelope if client is agent-zero. Includes allowlist check against advertised tools (handles `### input:` colon suffix). Falls back to wrapping plain text; short-circuits if content already looks like an envelope (prevents double-wrapping).
- **`canonicalize`** — maps from any naming convention (XML `<Bash>`, dotted `text_editor.read`, Anthropic `computer_use`) to agent-zero's canonical names. Handles dotted dispatch like `text_editor.read` → `{name: 'text_editor', args: {action: 'read'}}`.

### `src/config/paths.ts`

Single source of truth for repo-relative paths:

```
repoRoot()   →  <repo>/
dataDir()    →  <repo>/data/          (TRUEGATE_DATA_DIR to override)
stateDir()   →  <repo>/.state/        (TRUEGATE_STATE_DIR to override)
vendorDir()  →  <repo>/vendor/        (TRUEGATE_VENDOR_DIR to override)
```

Repo root is discovered by walking up from `paths.ts` looking for `package.json {"name":"truegate"}`.

---

## Request lifecycle: Claude Code → trueGate → [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)

```
Claude Code
  POST /v1/messages
  x-api-key: <cliproxy-token>
       ↓
trueGate :8457
  onRequest: load data/ + .state/ → CompiledContext
  pick endpoint: model=claude-sonnet-4-6 → exact match → cliproxy
  in-route: injectGovernanceIntoAnthropic(body, ctx) → adds `system`
  upstream: POST http://127.0.0.1:8317/v1/messages
  response: validateResponse + appendMarker → "— trueGate · cliproxy/claude-sonnet-4-6"
  header:   x-truegate-upstream: cliproxy/claude-sonnet-4-6
       ↓
CLIProxyAPI :8317
  reads OAuth-stored Anthropic credentials
  calls real api.anthropic.com
```

## Request lifecycle: Agent0 Docker → trueGate → CLIProxyAPI

```
Agent0 container
  POST /v1/chat/completions
  base URL: http://host.docker.internal:8457/v1
  body: { model: "claude-sonnet-4-6", response_format: agent_zero_envelope, ... }
       ↓
trueGate :8457
  onRequest: load governance
  pick endpoint: model=claude-sonnet-4-6 → exact match → cliproxy
  in-route: normalize Agent Zero envelope contract, strip provider-incompatible response_format for cliproxy when needed
  upstream: POST http://127.0.0.1:8317/v1/chat/completions
  response: validate + Agent Zero envelope normalization
  header:   x-truegate-upstream: cliproxy/claude-sonnet-4-6
```

From Docker, `localhost` points at the container. Use `host.docker.internal` for trueGate and any host-local Ollama service.

Agent0 envelope mode deliberately does not append the visible `— trueGate` marker to assistant message content. The route still sets `x-truegate-upstream`, and trueGate strips older trueGate/Governance footers from prior Agent0 assistant history before forwarding it upstream so the model does not see gateway-authored footers as its own authored text.

## Request lifecycle: Cursor → trueGate → Ollama

```
Cursor
  POST /v1/chat/completions
  body: { model: "qwen3-coder", messages: [...] }
       ↓
trueGate :8457
  onRequest: load governance
  pick endpoint: model=qwen3-coder → substring scan → ollama
  in-route: prepend governance system message, POST http://localhost:11434/v1/chat/completions
  response: validate + "— trueGate · ollama/qwen3-coder"
  header:   x-truegate-upstream: ollama/qwen3-coder
```

---

## Why three separate routes?

The three API shapes have meaningfully different system-prompt and response shapes:

|  | system field | response text |
| --- | --- | --- |
| OpenAI chat | `messages[0]` (role=system) | `choices[0].message.content` |
| Anthropic | top-level `system` (string or cache_control blocks) | `content[*].text` |
| Responses | top-level `instructions` | `output_text` / `output[*].content[*].text` |

Translating between them loses fidelity (caching, multi-modal, tool calls). trueGate keeps each one native end-to-end.

---

## Caching

- **Governance**: 5-second in-memory cache keyed by `stateDir()`. Edit a file and the next request after 5s picks it up. No restart needed.
- **Upstream registry**: built once at startup. Restart trueGate to re-probe if your environment changes.
- **Provider instances**: created on demand per endpoint and reused.

---

## What trueGate does NOT do

- **Streaming**: forces `stream: false` upstream. Streaming + governance validation is a meaningful design problem — planned for a future release.
- **Multi-model translation**: forwards the model field as-is. The Anthropic provider translates OpenAI request shape → Anthropic API shape, but it doesn't rename models.
- **Auth management**: forwards whatever auth header the client sends. Does not validate, store, or rotate keys.
- **Dev project governance**: does not read `CLAUDE.md`, `AGENTS.md`, `.cursor/rules`, or any project-specific file. That's the IDE's job.
- **Dashboards / cloud sync**: local only.

# Architecture

trueGate is a thin Fastify proxy. Every request flows through the same four-stage pipeline:

```
                          ┌────────────────────────┐
   client ───── POST ────▶│ governance-loader hook │  loads/refreshes governance
   (Claude   /v1/messages │    (onRequest)         │  files for projectRoot
    Code,    /v1/chat/…   └───────────┬────────────┘
    Cursor,  /v1/responses            ▼
    SDK…)                 ┌────────────────────────┐
                          │ route-specific request │  Anthropic shape: inject into
                          │  injector              │  `system` field
                          │    (preHandler /       │  OpenAI shape: prepend to
                          │     in-route)          │  `messages`
                          └───────────┬────────────┘  Responses shape: append to
                                      ▼               `instructions`
                          ┌────────────────────────┐
                          │  upstream HTTP call    │  Forwards client headers
                          │  (undici fetch)        │  (auth, anthropic-version,
                          │                        │   copilot-integration-id)
                          └───────────┬────────────┘
                                      ▼
                          ┌────────────────────────┐
                          │ response validator     │  Extracts text from response,
                          │  (in-route, route-     │  runs all validators,
                          │   specific shape)      │  block→refusal, warn→append
                          └───────────┬────────────┘
                                      ▼
                                  client
```

---

## Pieces

### `src/proxy/server.ts`

Fastify factory. Registers:

- **onRequest hook**: governance loader (caches 5s per projectRoot)
- **preHandler hook**: request compiler for `/v1/chat/completions` only (skips other routes)
- Three routes: `/v1/messages`, `/v1/chat/completions`, `/v1/responses`

The OpenAI-shape onSend response validator hook is left in place for `/v1/chat/completions` because that route uses the legacy provider abstraction. The `/v1/messages` and `/v1/responses` routes do response validation inline in the handler (they need access to the route-specific response shape).

### `src/governance/`

- **`loaders/`** — one per source (`truegate`, `claude`, `agents`, `cursor`). Each returns `null` if its file isn't there. Never throws.
- **`compiler/merge-context.ts`** — runs all loaders in parallel.
- **`compiler/resolve-priority.ts`** — orders sources, extracts `RuleSet`.
- **`compiler/build-runtime-context.ts`** — builds the system-message text.
- **`compiler/anthropic-injector.ts`** — inserts governance into Anthropic `system` field (string or array form, preserves cache_control).
- **`compiler/responses-injector.ts`** — appends governance to Responses API `instructions`.

### `src/validators/`

- **`rules/dangerous-patterns.ts`** — hardcoded block regexes (`rm -rf /`, `curl | sh`, leaked keys, `DROP TABLE`, …) + user-supplied patterns from `rules.yaml`.
- **`rules/forbidden-dependencies.ts`** — npm/import grep against blocklist.
- **`rules/forbidden-frameworks.ts`** — string match.
- **`rules/typescript-rules.ts`** — `: any` and `tsconfig` missing strict.
- **`engine/validate-response.ts`** — fan out, aggregate.
- **`engine/validate-anthropic-response.ts`** — extracts `content[*].text`, then runs the engine.
- **`engine/validate-responses-response.ts`** — extracts `output_text` or output items, then runs the engine.
- **`reporting/warning-formatter.ts`** — produces the ⚠/🚫 blocks.

### `src/providers/`

| File | Role |
| --- | --- |
| `openai/openai-provider.ts` | Generic OpenAI-compatible HTTP client (used by legacy chat-completions path and any preset that needs translation) |
| `shared/provider-factory.ts` | Picks the right provider given `TrueGateConfig` |
| `anthropic/anthropic-provider.ts` | OpenAI → Anthropic Messages API translator. Activated only when `TRUEGATE_PROVIDER=anthropic` and a client sends an OpenAI-shaped chat-completions request |
| `anthropic/anthropic-passthrough.ts` | Anthropic-native passthrough. Forwards `x-api-key` and `anthropic-version` verbatim |

### `src/proxy/routes/`

| Route | Behavior |
| --- | --- |
| `chat-completions.ts` | Passthrough OR Anthropic-translator. Forwards `Authorization` header from the client; falls back to stored `OPENAI_API_KEY` / `GITHUB_TOKEN`. Block/warn happens in onSend hook |
| `messages.ts` | Anthropic-native passthrough. Governance injected into `system` field. Block/warn happens in-route |
| `responses.ts` | OpenAI Responses API passthrough. Governance injected into `instructions`. Block/warn happens in-route |

### `src/cli/`

Commander. Subcommands:

- `init` — write `.truegate/{governance.md,rules.yaml}` from defaults
- `serve` — `buildServer(loadConfig()).listen()`
- `validate` — run validators against a file/stdin
- `inspect` — print compiled context

---

## Request lifecycles in detail

### Claude Code → trueGate → CLIProxyAPI → Anthropic

```
Claude Code
  POST /v1/messages
  x-api-key: <cliproxy-token>
  anthropic-version: 2023-06-01
  body: { messages: [...] }
       ↓
trueGate :8457
  onRequest:    load .truegate/, CLAUDE.md, etc. → CompiledContext
  in-route:     injectGovernanceIntoAnthropic(body, ctx) → adds `system`
  upstream:     POST http://127.0.0.1:8317/v1/messages
                (forwards x-api-key, anthropic-version)
       ↓
CLIProxyAPI :8317
  reads OAuth-stored Anthropic credentials
  calls real api.anthropic.com
       ↓
real Anthropic returns response
       ↓
CLIProxyAPI returns AnthropicNativeResponse
       ↓
trueGate in-route:
  extractAnthropicText(response)
  validateResponse(text, ctx.rules)
  if block: replace content with refusal
  if warn:  append warning block
  send to client
```

### Cursor → trueGate → Ollama

```
Cursor
  POST /v1/chat/completions   (no auth header for local Ollama)
  body: { model: "llama3", messages: [...] }
       ↓
trueGate :8457
  onRequest:    load governance
  preHandler:   inject system message into messages[]
  in-route:     POST http://localhost:11434/v1/chat/completions
                (no auth header — Ollama doesn't require one)
       ↓
Ollama returns ChatCompletionResponse
       ↓
trueGate onSend hook:
  validateResponse(choices[0].message.content, rules)
  block/warn injection
  send to client
```

---

## Why three separate routes?

The three API shapes have meaningfully different system-prompt and response shapes:

|  | system field | response text location |
| --- | --- | --- |
| OpenAI chat | `messages[0]` (role=system) | `choices[0].message.content` |
| Anthropic | top-level `system` (string or content blocks with cache_control) | `content[*].text` (array of blocks) |
| Responses | top-level `instructions` (string) | `output_text` (convenience) or `output[*].content[*].text` |

Translating any of these into another loses fidelity (caching, multi-modal content, tool calls). trueGate keeps each one native end-to-end.

---

## Caching

- **Governance**: 5-second in-memory cache keyed by `projectRoot`. Edit a file → next request after 5s picks it up. No restart.
- **Provider instance**: built lazily once on first request, reused.

There is no cross-process or cross-machine caching. trueGate is stateless beyond this.

---

## What trueGate does NOT do

- **Streaming**: forces `stream: false` upstream. Streaming + governance validation is a meaningful design problem (you can't validate text you haven't received yet) — planned for v0.2.
- **Tool calls**: trueGate forwards tool_use blocks verbatim. It does not validate tool inputs.
- **Multi-model translation**: it does not silently swap models. If a client asks for `gpt-4o`, trueGate forwards `gpt-4o`. The Anthropic translator maps `gpt-*` → `claude-*` for compatibility ONLY when `TRUEGATE_PROVIDER=anthropic` and the client sends OpenAI shape — otherwise pure passthrough.
- **Auth on its own**: trueGate trusts whatever auth header the client sends and forwards it. It does not validate, store, or rotate keys.
- **Dashboards / cloud sync**: out of scope. Local files, local proxy.

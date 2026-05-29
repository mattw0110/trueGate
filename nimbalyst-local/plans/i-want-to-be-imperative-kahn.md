# Imperative-by-Default Routing for trueGate

## Context

trueGate currently picks **one** upstream provider per process at startup. The
choice comes from `--provider` / `TRUEGATE_PROVIDER` / `~/.truegate/config.json`
/ default `openai`. Every request from the client goes to that single upstream
regardless of which `model` the client asks for. Switching providers means
restarting trueGate with a different flag.

The user wants trueGate to **just work** when started: detect whatever upstreams
are reachable on the host (CLIProxyAPI, Ollama, LM Studio, env-keyed OpenAI /
Anthropic / Copilot), enumerate the models each one serves, and dispatch each
incoming request to the right upstream **by model name**. A first-class
"locked" mode remains for cases where the operator wants a single provider or a
single model.

This makes trueGate behave like a deterministic, content-aware reverse proxy
instead of a per-process single-tenant proxy. Any client (agent0, Claude Code,
Cursor, a one-off curl, …) can point at `http://localhost:8457/v1/chat/completions`
with `model: "claude-sonnet-4-5"` or `model: "gpt-5-codex"` or `model: "llama3.1"`
and have it land at the appropriate backend automatically.

---

## Design

### 1. Upstream registry

A new module `src/registry/upstream-registry.ts` builds, at startup, an array
of **UpstreamEndpoint** records:

```ts
interface UpstreamEndpoint {
  provider: ProviderName; // 'cliproxy' | 'ollama' | 'openai' | ...
  baseUrl: string; // 'http://127.0.0.1:8317'
  apiKey?: string; // env or config-supplied
  models: string[]; // enumerated from upstream's /v1/models or /api/tags
  priority: number; // see precedence rules below
  reachable: boolean;
}
```

Probes run **in parallel** at startup:

| Provider | Probe |
| --- | --- |
| `cliproxy` | `GET `http://127.0.0.1:8317/v1/models` (uses cliproxy key) |
| `ollama` | `GET http://localhost:11434/api/tags` |
| `lmstudio` | `GET http://localhost:1234/v1/models` |
| `openai` | env `OPENAI_API_KEY` present → `GET `https://api.openai.com/v1/models` |
| `anthropic` | env `ANTHROPIC_API_KEY` present → `GET `https://api.anthropic.com/v1/models` |
| `github-copilot` | env `GITHUB_TOKEN` present → known model list (no public enumeration) |

Reuse the **`probe()` helper at `src/cli/commands/status.ts:9-23`** instead of
inventing a new one — extend it slightly to do a real `/v1/models` GET (not
just any GET) and parse the body.

All probes share a single 1.5s timeout per endpoint so startup never stalls.

### 2. Precedence (tie-breaking when multiple upstreams claim a model)

Default priority order (lower number wins):

1. **openai** / **anthropic** / **github-copilot** — direct APIs (env-keyed).
   When the user has put a real key in env, they explicitly want that path used.
2. **cliproxy** — OAuth subscriptions (Claude/Codex/Gemini Plus). Used when
   no direct key is configured for the matching model.
3. **ollama** / **lmstudio** — local, free, private. Last resort by default
   since most clients ask for cloud models by name; locals serve as fallback
   for unrecognized model names (see §3.4).
4. **custom** — only if explicitly configured via `--upstream-url`.

Startup flags override entirely: `--provider cliproxy` (or any other name)
disables the priority table and forces that one upstream for every request.

### 3. Per-request routing

**Guiding principle (from user):** the client (agent0, Claude Code, Cursor, …)
has already chosen its model. trueGate must respect that choice and pick the
right upstream for it — never rewrite the model field, never reject because
the operator "locked" a different one.

Replace the `defaultUpstream(config)` calls in:

- `src/proxy/routes/chat-completions.ts:272-286, 311-312`
- `src/proxy/routes/messages.ts:23-27`
- `src/proxy/routes/responses.ts:26-30`

…with a new helper:

```ts
pickUpstreamForModel(model: string, registry: UpstreamRegistry, config: TrueGateConfig)
  → { endpoint: UpstreamEndpoint }
```

Resolution:

1. If `--provider X` was passed at startup → use that provider's endpoint
   unconditionally. The client's model field is still forwarded as-is; if the
   upstream rejects it, the client sees that error.
2. Otherwise, look up the requested `model` in the registry. Match order:
   exact → prefix-wildcard (`claude-*`, `gpt-*`, `o1*`, `gemini-*`, etc.) →
   substring (last resort).
3. If no upstream claims the model, fall through to the highest-priority
   reachable upstream (see §2) and let it decide. This keeps the proxy
   permissive — locally-named models or freshly-released model IDs that
   trueGate doesn't know about yet still go somewhere reasonable. The
   response marker (§3.5) tells the operator what actually served the request.

`--model <name>` flag is **not** added. It would conflict with the principle
of respecting the client's choice. If an operator wants to force a single
model, they configure that on the client side (where it belongs).

### 3.5 Response marker shows which upstream + model served the request

Today the response marker is the static string `— trueGate`. Extend it to
`— trueGate · <provider>/<model>` so every response self-documents which
backend served it. Examples:

```
— trueGate · cliproxy/claude-sonnet-4-5
— trueGate · ollama/llama3.1:70b
— trueGate · openai/gpt-5-codex
```

This is the operator's visibility into "did my request go where I expected?"
without grepping logs. The marker logic lives near the existing
`responseMarker` handling in `src/proxy/routes/chat-completions.ts` — extend
the formatter to take `endpoint.provider` + `response.model` and emit the
suffix. Preserve the existing opt-out (`--no-response-marker`).

### 4. Provider factory becomes multi-tenant

`src/providers/shared/provider-factory.ts:10-73` today returns one provider
instance. Change it to return a `Map<ProviderName, ProviderInstance>`, built
once at startup from the registry. Each route grabs the right instance per
request. The factory's per-provider construction logic (lines 12-71) stays
the same — only the entry point changes.

### 5. CLI surface

New default behavior of `truegate serve` (no flags): auto-detect, log what
was found, route by model.

| Flag | Behavior |
| --- | --- |
| (none) | **auto mode** — probe everything, route by model |
| `--provider <name>` | force every request to this upstream; client's `model` field is still forwarded as-is |
| `--no-auto` | disable startup probes; require explicit `--provider` |
| `--upstream-url <url>` (existing) | when used with `--provider custom`, defines the custom endpoint |
| `--port`, `--log-level`, `--project-root`, `--strip-client-system`, `--response-marker` | unchanged |

`~/.truegate/config.json` gains optional fields:

```json
{
  "mode": "auto" | "locked",
  "modelOverrides": { "claude-sonnet-4-5": "anthropic" },
  "providerPriority": ["openai", "anthropic", "github-copilot", "cliproxy", "ollama", "lmstudio"]
}
```

### 6. Visibility

Extend `truegate status` (`src/cli/commands/status.ts`) to print the full
registry table — which upstreams responded, what models each serves, and what
model resolves to what endpoint. This is how the user verifies "is it routing
where I think?" without reading logs.

`truegate serve` startup log emits a one-shot summary line per upstream:

```
[truegate] cliproxy   :8317  ✓ 23 models (claude-sonnet-4-5, gpt-5-codex, gemini-2.5-pro, …)
[truegate] ollama     :11434 ✓ 4 models (llama3.1, qwen2.5-coder, …)
[truegate] lmstudio   :1234  ✗ unreachable
[truegate] mode=auto, default-priority=openai>anthropic>cliproxy>ollama>lmstudio
```

### 7. Out of scope (for this change)

- Streaming behavior is unchanged (CLAUDE.md says streaming is deferred).
- The tool-translation layer (`src/proxy/tool-translation.ts`) is upstream-agnostic
  and stays untouched.
- Governance loading and response validation continue to wrap every request
  regardless of which upstream served it.
- Background re-probing — v1 probes once at startup. Operator restarts if their
  env changes. Avoids a poller. We may add `truegate refresh` later.

---

## Critical files

**New:**

- `src/registry/upstream-registry.ts` — probe + enumerate + build registry
- `src/registry/route-model.ts` — `pickUpstreamForModel()` helper
- `src/registry/model-patterns.ts` — known prefix→provider hints for fallback
- `tests/registry/upstream-registry.test.ts`
- `tests/registry/route-model.test.ts`

**Modified:**

- `src/types/runtime.ts` — add `mode`, `modelOverrides`, `providerPriority` fields to `TrueGateConfig`
- `src/config/user-config.ts:82-142` — extend `resolveConfig()` for the new fields
- `src/cli/commands/serve.ts` — wire `--no-auto`, default-to-auto; build registry before starting Fastify
- `src/providers/shared/provider-factory.ts` — `createProvider()` → `createProviderRegistry()` returning `Map<ProviderName, ProviderInstance>`
- `src/proxy/routes/chat-completions.ts:272-286` — replace `defaultUpstream()` with `pickUpstreamForModel()`; extend response-marker formatter to suffix `· <provider>/<model>`
- `src/proxy/routes/messages.ts:23-27` — same
- `src/proxy/routes/responses.ts:26-30` — same
- `src/cli/commands/status.ts` — print registry table

**Reusable, do not duplicate:**

- `probe()` at `src/cli/commands/status.ts:9-23` — extend, don't re-write
- `PROVIDER_BASE_URLS` at `src/config/constants.ts:13-20` — already authoritative
- `resolveConfig()` layering pattern at `src/config/user-config.ts:82-142` — extend, don't replace

---

## Verification

1. **Unit**
  - `tests/registry/upstream-registry.test.ts` — mock undici, simulate each
     upstream returning / failing / timing out. Assert the registry shape.
  - `tests/registry/route-model.test.ts` — given a fixture registry, assert
     that each model name routes to the right endpoint, that `--provider`
     forces dispatch regardless of model, and that unknown models fall through
     to the highest-priority reachable upstream rather than 400.
  - Response-marker test: assert the suffix `· <provider>/<model>` is appended
     when the marker is enabled and absent when `--no-response-marker` is set.

2. **Live end-to-end on this box** (CLIProxyAPI + agent0 already running):

```bash
   # Restart trueGate with no flags — should auto-detect cliproxy
   systemctl --user restart truegate.service
   journalctl --user -u truegate.service --since "5s ago" | head -20
   # → expect "[truegate] cliproxy :8317 ✓ N models" line

   # Route a Claude request
   curl -s localhost:8457/v1/chat/completions \
     -H "content-type: application/json" \
     -d '{"model":"claude-sonnet-4-5","messages":[{"role":"user","content":"hi"}]}'
   # → expect 200; response trailer reads "— trueGate · cliproxy/claude-sonnet-4-5"
   # (or "— trueGate · anthropic/claude-sonnet-4-5" if ANTHROPIC_API_KEY is set)

   # Route a Codex request (same trueGate, different model)
   curl -s localhost:8457/v1/chat/completions \
     -H "content-type: application/json" \
     -d '{"model":"gpt-5-codex","messages":[{"role":"user","content":"hi"}]}'
   # → expect 200; trailer reads "— trueGate · cliproxy/gpt-5-codex"

   # Forced-provider mode
   truegate serve --provider cliproxy
   # → every request goes to cliproxy regardless of model; model field passed through

   # Status
   truegate status
   # → prints upstreams + reachable models + routing table
```

3. **agent0 regression** — leave agent0 pointed at trueGate, switch its model
   in `/a0/usr/settings.json` from Claude alias to `gpt-5-codex`, send a chat
   message. Should route to cliproxy's Codex session without any trueGate
   config change.

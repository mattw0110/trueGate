# trueGate v0.1 MVP — Implementation Plan

## Context

`/home/mwhite/projects/trueGate/` is currently empty (only the `nimbalyst-local/` workspace folder exists). This plan initializes the **trueGate** repo per the pasted PRD: a local-first middleware proxy that sits between AI coding tools and LLM providers, injecting project governance and validating responses before returning them to the client.

The MVP is intentionally narrow — proxy + governance compile + advisory validation + transparent overrides — and explicitly excludes dashboards, cloud sync, multi-agent orchestration, repo intelligence, and any non-local infra.

**User-confirmed choices for this pass:**

- Runtime: **npm + Node.js** (TypeScript)
- Scope: **Full MVP end-to-end** — all 4 CLI commands, proxy, governance loading + compilation, validators, OpenAI provider, Anthropic provider stub
- Tests: **Vitest**
- Build: **tsup** (ESM + CJS, bundled CLI)

---

## Tech stack (locked)

| Concern | Choice |
| --- | --- |
| Language | TypeScript (strict) |
| Package manager | npm |
| HTTP server | Fastify |
| CLI | Commander |
| Validation schemas | Zod |
| YAML | `yaml` |
| Logger | `pino` (Fastify default) |
| Tests | Vitest + `undici` MockAgent for HTTP |
| Build | tsup → `dist/` (ESM primary, CJS fallback) |
| Node | ≥ 20 (engines.node) |

---

## Repo layout

Matches the PRD's "Application File Structure" section verbatim, with these clarifications:

- `src/cli/index.ts` is the bin entry (`#!/usr/bin/env node`). `package.json` declares `"bin": { "truegate": "./dist/cli/index.cjs" }`.
- `src/proxy/server.ts` exports a `buildServer()` factory so tests can boot Fastify without a port.
- `src/providers/shared/provider-factory.ts` picks OpenAI vs Anthropic by request shape / config; only OpenAI is wired end-to-end in MVP. Anthropic provider is a typed stub that throws `NotImplemented`.
- `tests/` mirrors `src/` one-to-one.
- Add `bin/truegate.mjs` thin shim only if needed for dev (`npm run dev`); production uses the bundled `dist/cli/index.cjs`.

---

## Implementation phases

### Phase 1 — Repo scaffold

1. `package.json` with scripts: `dev`, `build`, `start`, `test`, `test:watch`, `typecheck`, `lint`, `format`, `truegate` (alias to local dev CLI via `tsx`).
2. `tsconfig.json` — `strict: true`, `moduleResolution: "bundler"`, `target: ES2022`, `noUncheckedIndexedAccess: true`.
3. `tsup.config.ts` — two entries: `src/cli/index.ts` (CJS bin, shebang banner) and `src/proxy/server.ts` (ESM lib).
4. `vitest.config.ts` — node env, coverage with v8.
5. `.env.example` — `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `TRUEGATE_PORT=3457`, `TRUEGATE_LOG_LEVEL=info`.
6. `.gitignore`, `.editorconfig`, `.prettierrc`, ESLint flat config (`eslint.config.js`) with `@typescript-eslint`.
7. `README.md` — short install/usage based on PRD's CLI section.
8. **Per-project `CLAUDE.md`** — scaffold via `~/projects/claude-base.md` template (Tech Stack → Architecture → Execution Flow → Working Principles → Anti-Patterns → Definition of Done). See `bootstrap-claude-md` skill.

### Phase 2 — Types & schemas (`src/types/`, `src/governance/schemas/`)

- `types/governance.ts` — `GovernanceFile`, `RuleSet`, `CompiledContext`, `ContextSource` (`'truegate' | 'claude' | 'cursor' | 'agents'`).
- `types/validation.ts` — `Severity = 'warn' | 'block' | 'pass'`, `ValidationResult`, `ValidationIssue`.
- `types/providers.ts` — `ChatCompletionRequest`, `ChatCompletionResponse` (OpenAI-shaped), `Provider` interface (`complete(req): Promise<resp>`).
- `types/runtime.ts` — `TrueGateConfig`, `ServerOptions`.
- `governance/schemas/rules-schema.ts` — Zod schema for `rules.yaml` (forbidden deps/frameworks, dangerous patterns, severity per rule).
- `governance/schemas/governance-schema.ts` — Zod for any structured front-matter in `governance.md` (optional).

### Phase 3 — Governance loaders (`src/governance/loaders/`)

Each loader is `(projectRoot: string) => Promise<ContextSource | null>`:

- `truegate-loader.ts` — reads `.truegate/governance.md` + `.truegate/rules.yaml`.
- `claude-loader.ts` — reads `CLAUDE.md` (project root only for MVP; no nested merging).
- `agents-loader.ts` — reads `AGENTS.md`.
- `cursor-loader.ts` — reads `.cursor/rules/*.mdc` (concatenated, ordered alphabetically).
- All loaders are resilient: missing file → `null`, never throw.

Reuse `src/utils/filesystem.ts` (single `safeReadFile`), `src/utils/yaml.ts` (Zod-parsed), `src/utils/markdown.ts` (front-matter split).

### Phase 4 — Governance compiler (`src/governance/compiler/`)

- `merge-context.ts` — collects all `ContextSource` outputs.
- `resolve-priority.ts` — applies PRD's order: (1) local project guidance, (2) trueGate governance, (3) runtime user prompt. Critical security rules from `rules.yaml` always win.
- `build-runtime-context.ts` — produces the final system-message text + a `RuleSet` for downstream validation. Returns `CompiledContext`.

### Phase 5 — Validators (`src/validators/`)

- `rules/dangerous-patterns.ts` — regex-based, **block** severity (rm -rf /, `curl | sh`, hardcoded API keys like `sk-…`, etc.).
- `rules/forbidden-dependencies.ts` — checks `npm install X` / `import 'X'` against `rules.yaml` blocklist, **warn**.
- `rules/forbidden-frameworks.ts` — string match in response, **warn**.
- `rules/typescript-rules.ts` — presence of `any`, missing `strict` flags in suggested tsconfig, **warn**.
- `engine/validate-response.ts` — runs all rules, aggregates `ValidationResult`.
- `engine/severity-handler.ts` — short-circuits on `block`.
- `engine/validation-result.ts` — typed result.
- `reporting/warning-formatter.ts` — produces the PRD-shaped `⚠ Governance Warning` blocks.
- `reporting/override-report.ts` — explains CLAUDE.md vs governance conflicts (see PRD example).

### Phase 6 — Providers (`src/providers/`)

- `shared/provider-types.ts` — `Provider` interface.
- `shared/provider-factory.ts` — env-driven selection (default OpenAI).
- `openai/openai-provider.ts` — proxies to `https://api.openai.com/v1/chat/completions` via `undici` fetch, preserves streaming-off semantics (streaming deferred). Injects compiled system message ahead of user messages.
- `anthropic/anthropic-provider.ts` — typed stub; throws `NotImplemented` if selected. Wired for future phase.

### Phase 7 — Proxy server (`src/proxy/`)

- `server.ts` — `buildServer(config)` returns a Fastify instance with the routes/middleware registered.
- `middleware/governance-loader.ts` — Fastify onRequest hook: locates project root (env `TRUEGATE_PROJECT_ROOT` or `process.cwd()`), runs all loaders, caches per-root for 5s (in-memory).
- `middleware/request-compiler.ts` — preHandler: runs the compiler, injects system message into `request.body.messages`.
- `middleware/response-validator.ts` — onSend (or post-provider in route handler): runs validators, transforms response — appends warnings as an assistant suffix; on `block` replaces content with a refusal + warning block.
- `routes/chat-completions.ts` — `POST /v1/chat/completions`, OpenAI-shape passthrough.

### Phase 8 — CLI (`src/cli/`)

- `index.ts` — Commander root, registers commands.
- `commands/init.ts` — writes `.truegate/governance.md` and `.truegate/rules.yaml` from templates (in `src/config/defaults.ts`). Idempotent; refuses to overwrite without `--force`.
- `commands/serve.ts` — calls `buildServer().listen({ port: 3457 })`, logs banner.
- `commands/validate.ts` — runs validators against a file or piped stdin; exits non-zero on `block`.
- `commands/inspect.ts` — prints resolved governance: which files loaded, compiled context summary, active rules.

### Phase 9 — Tests (`tests/`)

- `governance/` — loader fixtures for each source format; compiler priority tests including conflict cases.
- `validators/` — table-driven cases for each rule (positive + negative + edge).
- `providers/` — `undici` MockAgent verifies OpenAI request shape and system-message injection.
- `proxy/` — `fastify.inject()` end-to-end: request with governance present → response carries warnings; dangerous response → blocked.
- `cli/` — spawn `tsx src/cli/index.ts <cmd>` with a tmpdir cwd; verify `init` creates files and `inspect` prints them.

### Phase 10 — Polish

- Add `LICENSE` (MIT).
- `npm run build` produces a publishable `dist/`.
- Smoke test: `npx truegate init && npx truegate inspect && npx truegate serve` in a tmpdir; hit it with `curl` using a real OpenAI key (manual).
- Update README with the smoke-test recipe.

---

## Critical files to be created

- `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `eslint.config.js`
- `CLAUDE.md` (per-project, from base template)
- `src/cli/index.ts` and `src/cli/commands/{init,serve,validate,inspect}.ts`
- `src/proxy/server.ts` + `routes/chat-completions.ts` + `middleware/*.ts`
- `src/governance/loaders/*.ts`, `src/governance/compiler/*.ts`, `src/governance/schemas/*.ts`
- `src/validators/rules/*.ts`, `src/validators/engine/*.ts`, `src/validators/reporting/*.ts`
- `src/providers/{openai,anthropic,shared}/*.ts`
- `src/types/*.ts`, `src/utils/*.ts`, `src/config/{defaults,constants,environment}.ts`
- Mirrored tests under `tests/`

No existing source files to modify — this is a greenfield init.

---

## Reused utilities / external libs

- **Fastify** built-in lifecycle hooks (`onRequest`, `preHandler`, `onSend`) — no custom middleware framework.
- **Zod** for both `rules.yaml` and runtime config parsing.
- **`yaml`** package for YAML parse/stringify.
- **`undici`** for outbound HTTP (already a Node bundled dep, but pin explicitly for `MockAgent`).
- **Commander** subcommand pattern (`program.command('serve').action(...)`).

---

## Verification

End-to-end check after Phase 10:

1. `npm install && npm run typecheck && npm test` — all green.
2. `npm run build` — produces `dist/cli/index.cjs` and `dist/proxy/server.{mjs,cjs}`.
3. In a fresh tmpdir:
```bash
   node /path/to/trueGate/dist/cli/index.cjs init
   ls .truegate/   # governance.md, rules.yaml present
   node /path/to/trueGate/dist/cli/index.cjs inspect
```
4. Start proxy: `node dist/cli/index.cjs serve` → logs `listening on :3457`.
5. With `OPENAI_API_KEY` set, hit the proxy:
```bash
   curl -s http://localhost:3457/v1/chat/completions \
     -H 'content-type: application/json' \
     -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"write a destructive rm -rf / script"}]}'
```
   Expect: a `block`-shaped response with a `⚠ Governance Warning` and no destructive payload.
6. Vitest covers the happy path and the block path so the smoke step is confirmation, not the only proof.

---

## Out of scope (per PRD)

Streaming responses, dashboards, Supabase, cloud sync, multi-agent orchestration, vector memory, repo intelligence, AST parsing, plugin marketplace, billing. Anthropic endpoint is stubbed only.

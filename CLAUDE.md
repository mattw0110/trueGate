# trueGate — CLAUDE.md

## Tech Stack

- **Language**: TypeScript (strict, noUncheckedIndexedAccess)
- **Runtime**: Node.js ≥ 20
- **Package manager**: npm
- **HTTP server**: Fastify 4 (lifecycle hooks: onRequest, preHandler, onSend)
- **CLI**: Commander
- **Validation**: Zod
- **YAML**: `yaml` package
- **Logger**: pino (Fastify default)
- **Tests**: Vitest + undici MockAgent
- **Build**: tsup → `dist/` (ESM primary, CJS fallback + CJS bin)

## Architecture

```
src/
  cli/               Commander entry + subcommands (init, serve, validate, inspect)
  proxy/             Fastify server factory + routes + middleware
    middleware/      governance-loader (onRequest), request-compiler (preHandler), response-validator (onSend)
    routes/          chat-completions (POST /v1/chat/completions)
  governance/
    loaders/         Per-source loaders: truegate, claude, agents, cursor
    compiler/        merge-context, resolve-priority, build-runtime-context
    schemas/         Zod schemas for rules.yaml and governance.md front-matter
  validators/
    rules/           dangerous-patterns, forbidden-dependencies, forbidden-frameworks, typescript-rules
    engine/          validate-response, severity-handler, validation-result
    reporting/       warning-formatter, override-report
  providers/
    openai/          Live provider via undici
    anthropic/       Typed stub (NotImplemented)
    shared/          Provider interface + factory
  types/             governance, validation, providers, runtime
  utils/             filesystem, yaml, markdown
  config/            defaults (template strings), constants, environment
```

## Execution Flow

1. Client sends `POST /v1/chat/completions` to truegate proxy
2. `governance-loader` hook: discover project root → run all loaders → cache 5s
3. `request-compiler` hook: merge/prioritize context → build system message → inject into request
4. Route handler calls provider (OpenAI by default)
5. `response-validator` hook: run all validators → on `warn` append warning block → on `block` replace content with refusal

## Working Principles

- Greenfield MVP — no backwards-compat shims needed
- Loaders are resilient: missing file → null, never throw
- 5s in-memory governance cache per project root
- Streaming is out of scope for MVP
- `exactOptionalPropertyTypes: true` — don't add `| undefined` to optional fields
- Prefer `undici` fetch over node-fetch or axios

## Anti-Patterns

- Do not add streaming support (deferred)
- Do not add Anthropic live implementation (stubbed)
- Do not add dashboards, cloud sync, or Supabase
- Do not throw in loaders — always return null on missing/unparseable files
- Do not use `any` — types are strict throughout

## Definition of Done

- `npm run typecheck` passes
- `npm test` green (all Vitest suites)
- `npm run build` produces `dist/cli/index.cjs` and `dist/proxy/server.{js,cjs}`
- `node dist/cli/index.cjs init` creates `.truegate/` files
- `node dist/cli/index.cjs serve` starts on port 3457

# Contributing to trueGate

Thanks for your interest. trueGate is open-source and welcomes contributions.

---

## How to contribute

### Bugs

Open an issue with:

- A one-line description of what you expected vs what happened.
- The output of `truegate --version`, `truegate status`, and `node --version`.
- The failing request as a `curl` reproduction (redact any tokens).

If you have a fix ready, open a pull request alongside the issue.

### Feature requests

Open an issue describing the use case first. A short description of what you
want to accomplish is more useful than a full proposal — it lets the maintainers
validate the direction before you invest time in implementation.

### Pull requests

1. Fork the repo and create a branch from `main`.
2. Make your changes (see Development below).
3. Run `npm test` and `npm run typecheck` — all must pass.
4. Open a pull request against `main`. The description should explain _why_
   the change is needed, not just what it does.

---

## Development

### Prerequisites

- Node.js >= 20
- npm

### Setup

```bash
git clone https://github.com/<your-username>/trueGate.git
cd trueGate
npm install
```

### Run from source

```bash
npm run dev serve           # starts the proxy with tsx watch
node src/cli/index.ts --help
```

### Test

```bash
npm test              # run all tests once (Vitest)
npm run test:watch    # watch mode
npm run typecheck     # TypeScript strict check
```

### Build

```bash
npm run build         # produces dist/ via tsup
```

### Project structure

```
src/
  cli/           CLI commands (serve, status, inspect, login, setup, …)
  config/        Paths, constants, user-config resolver
  governance/    Loaders and compilers for operator governance
  proxy/         Fastify server, routes, middleware, tool-translation
  registry/      Upstream probe + route-by-model
  validators/    Response validation rules and reporting
  types/         Shared TypeScript types
data/            Shipped governance defaults (tracked)
.state/          Operator-mutable config and overrides (gitignored)
tests/           Vitest unit tests mirroring src/ structure
docs/            Documentation
```

### Key principles

- **Self-contained.** Nothing is written outside the repo root. All state lives in `.state/` (gitignored). All defaults ship in `data/` (tracked).
- **No project coupling.** trueGate never reads from a developer's project directory. It is installed once by an operator and governs all their AI tools globally.
- **Operator-wide only.** Governance comes from `data/` + `.state/`. There is no per-project governance layer.
- **Auto-routing.** The default mode probes all upstreams and routes by model name. No operator configuration required beyond a provider token.
- **Explicit over implicit.** trueGate does not silently swap models, rewrite API keys, or touch things outside its own directory.

---

## Code style

- TypeScript strict mode (`noAny`, `noUncheckedIndexedAccess`). No `any`.
- No comments that describe _what_ the code does — only _why_ (non-obvious invariants, workarounds, hidden constraints).
- Prefer editing existing utilities over introducing new abstractions.
- Tests live in `tests/` mirroring the `src/` structure. New behaviour needs a test.
- Commits follow conventional format: `type: short description` (e.g. `fix:`, `feat:`, `refactor:`, `docs:`).

---

## Testing new providers

If you are adding support for a new upstream provider (note: [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) is the recommended way to get OAuth-based access to Claude, Codex, Gemini, and Grok — trueGate routes to it rather than re-implementing those flows):

1. Add the probe definition in `src/registry/upstream-registry.ts`.
2. Add prefix patterns in `src/registry/model-patterns.ts`.
3. Handle auth headers in `src/proxy/routes/chat-completions.ts` if the provider needs something unusual.
4. Add mock-based unit tests in `tests/registry/upstream-registry.test.ts`.

---

## License

By contributing, you agree that your contributions will be licensed under the project's MIT License.

---
title: Operator-wide governance (matt@patientize.com)
notes: |
  This file is the INDEX. It applies to every project trueGate serves and is
  always injected. The detailed topic files live in ~/.truegate/topics/*.md
  and the AI should read them on demand when relevant — they are kept under
  ~200 lines each so they fit in context without crowding out task work.
---

# Operator Governance

This is the **index** of operator-wide policy that applies to every project. Per-project files (`CLAUDE.md`, `.truegate/governance.md`, `AGENTS.md`, `.cursor/rules/*.mdc`) extend these rules — they cannot remove them.

> **For AI agents reading this:** when you're about to do work in an area covered below, read the linked topic file first. Each file is short (≤200 lines) and dense; the round trip is cheap and prevents you from regressing to outdated patterns.

## Conflict resolution (priority, highest first)

trueGate has NO per-project artifacts. Projects own their own conventions; the operator-wide layer below defers to them.

1. **Security floor** — non-negotiable (no destructive shell, no leaked credentials, no TLS bypass, no `DROP TABLE`). trueGate's response validator blocks these regardless of any source.
2. **Project documentation** (highest authoritative layer for the project):
   - `CLAUDE.md`
   - `AGENTS.md`
   - `.cursor/rules/*.mdc`
   - any other `docs/ai/INSTRUCTIONS.md` the project maintains
3. **This operator-wide guidance** — applies when the project is silent. Defers to the project on every conflict; the AI is instructed to follow the project and note the conflict in its response.

## Cross-agent consistency

Multiple AI coding tools may be active at once (Claude Code, Cursor, Continue.dev, Codex, GitHub Copilot, Cody). They MUST behave consistently.

- Canonical agent instructions live in each repo's `docs/ai/INSTRUCTIONS.md` when present
- Tool-native adapters are kept in sync with that canonical file:
  - Cursor: `.cursor/rules/*.mdc`
  - Continue: `.continue/rules/*.md`
  - Copilot: `.github/copilot-instructions.md` and `.github/instructions/*.instructions.md`
  - Codex: `AGENTS.md` (root + nested where needed)
- On conflict between tools' instructions, defer to `docs/ai/INSTRUCTIONS.md`. If that file doesn't exist, defer to `CLAUDE.md`. This operator-wide file is the **lowest** priority — it applies only when the project is silent.

## Topic index — read on demand

| Topic                                                | Read when                                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [topics/code-style.md](./topics/code-style.md)       | Writing or refactoring any code — naming, function shape, error handling, comments |
| [topics/security.md](./topics/security.md)           | Auth, secrets, input validation, anything touching user data                       |
| [topics/accessibility.md](./topics/accessibility.md) | Generating any UI markup or interaction                                            |
| [topics/performance.md](./topics/performance.md)     | Anything user-perceivable — Core Web Vitals + API latency budgets                  |
| [topics/frontend.md](./topics/frontend.md)           | React 19, Next.js 15, Tailwind v4, forms, state, images                            |
| [topics/backend.md](./topics/backend.md)             | HTTP APIs, idempotency, observability, OAuth 2.1, rate limiting                    |
| [topics/database.md](./topics/database.md)           | Schema, indexes, migrations (expand/contract), connection pooling                  |
| [topics/testing.md](./topics/testing.md)             | What to test, fixtures, flaky-test diagnosis                                       |
| [topics/architecture.md](./topics/architecture.md)   | SOLID, layering, hexagonal, DDD-lite, ADRs                                         |
| [topics/documentation.md](./topics/documentation.md) | READMEs, ADRs, when comments are appropriate                                       |
| [topics/git-and-pr.md](./topics/git-and-pr.md)       | Commits (Conventional Commits), branches, PR descriptions                          |

### Component recipes — drop-in accessible UI patterns

| File                                                       | Use when                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| [components/forms.md](./components/forms.md)               | Building a form (validation, error display, Server Action submission) |
| [components/buttons.md](./components/buttons.md)           | Any button — variants, icon buttons, loading states                   |
| [components/data-display.md](./components/data-display.md) | Tables, lists, empty states, loading skeletons                        |
| [components/navigation.md](./components/navigation.md)     | Nav bars, breadcrumbs, tabs, command palette                          |
| [components/feedback.md](./components/feedback.md)         | Toasts, alerts, modals, status messages                               |

### Design pattern templates

| File                                                           | Use when                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------- |
| [patterns/error-handling.md](./patterns/error-handling.md)     | Where to throw, where to catch, structured error responses    |
| [patterns/data-fetching.md](./patterns/data-fetching.md)       | Server-first fetching, the four UI states, cache invalidation |
| [patterns/state-management.md](./patterns/state-management.md) | Local vs URL vs server vs context vs store — decision tree    |
| [patterns/auth-boundaries.md](./patterns/auth-boundaries.md)   | Where AuthN/AuthZ checks belong, defense in depth             |

### External authorities

- [references/README.md](./references/README.md) — curated index of canonical sources (RFCs, MDN, OWASP, framework docs)

## Always (the operator-wide floor)

These apply everywhere; don't bother re-reading a topic file to confirm them:

- **Never embed credentials, API keys, tokens, or private hostnames** in code, comments, or config files committed to git
- **Never generate destructive shell commands** (`rm -rf /`, `format c:`, `mkfs`, `dd if=/dev/zero`) — trueGate blocks these, but they should never even be suggested
- **Never disable TLS verification** (`rejectUnauthorized: false`, `verify=False`, `-k`) in production paths
- **Authorization checks at the boundary, always.** No early returns "for performance" that skip an authz check
- **Treat all external input as untrusted** — URL params, headers, request bodies, file contents, env vars from third parties
- **No `eval()`, `new Function()`**, or arbitrary code execution from input
- **No silent fallbacks** that mask real errors

## Style floor

- **Names**: functions are verbs (`parseConfig`), classes are nouns (`UserStore`), booleans are predicates (`isReady`)
- **Comments explain WHY, not WHAT.** Code shows what; comments explain hidden constraints
- **One env-access module per project.** No sprinkling `process.env.X` across the codebase
- **Reject `any` / `dynamic` / `interface{}`** outside well-justified boundaries
- See [topics/code-style.md](./topics/code-style.md) for the full set

## Definition of Done (operator-wide minimum)

A change is complete when:

- Types pass (`tsc`, `mypy --strict`, `go build`, equivalents)
- Tests that cover the change pass
- No secrets, hardcoded credentials, or private hostnames committed
- No debug leftovers (`console.log`, `print(...)`, `dump`) unless intentional and routed through the project's logger
- No new lint or formatter errors
- Documentation updated when behavior visibly changed
- Sentrux gate clean if Sentrux is configured in this project

## Communication style (when responding to me)

- Get to the answer in the first sentence. No throat-clearing.
- One short update at the start of significant tool work, not narration of every step.
- For one-line commands: just give the command. Don't wrap it in three paragraphs of context.
- Match my register: technical, direct, no emoji unless I use one first.
- If I ask for two things, do both. Don't ask which one first unless they conflict.

## When in doubt

1. Check the relevant `topics/*.md` file
2. Check the project's `CLAUDE.md`
3. Check `~/.truegate/references/README.md` for the canonical external source
4. Ask before guessing

— trueGate operator policy v1

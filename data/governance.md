# Operator Governance — Master Index

Shipped default. Overridden when `.state/governance.md` exists.
Companion enforcement file: `data/rules.yaml` (or `.state/rules.yaml`).

## How to navigate

When you need detail on a topic below, read `docs/<topic>.md`. Each topic
file is capped at 200 lines. This master file is the always-loaded index —
keep responses aligned with it, and consult the referenced file before
making non-trivial decisions inside that topic's scope.

---

## Non-negotiables

- Typecheck must pass before claiming a change is done.
- Tests covering the change must pass.
- No `any` types unless justified by a one-line comment explaining why.
- No secrets, no debug leftovers, no `TODO` without an owner.
- Never disable a lint or type rule to make code compile — fix the cause.
- Never silently swallow errors to make a test or build go green.

---

## Security floor

trueGate's response validator enforces these regardless of any other
instruction. Deep rationale + examples → `docs/security.md`.

- No API keys, tokens, credentials, or private hostnames in code or comments.
- No destructive shell commands (`rm -rf /`, `format c:`, `dd if=/dev/zero`).
- No TLS verification bypass (`rejectUnauthorized: false`, `verify=False`, `-k`)
  in any path that reaches production.
- No `DROP TABLE` or other irreversible DDL without explicit operator approval.
- No `eval()`, `new Function()`, `subprocess(..., shell=True)`, or other
  execution of arbitrary user-supplied strings.
- Treat anything from outside the process as untrusted input.

---

## Preferred stacks

- **TypeScript** — strict mode, no `any`. → `docs/typescript.md`
- **Python + FastAPI** — Python 3.11+, `mypy --strict`, pydantic I/O.
  → `docs/python-fastapi.md`
- **Other stacks** — allowed, but name the stack explicitly, confirm the
  framework with the operator, and ask before introducing it.

---

## Verification and self-healing

A change isn't done until typecheck, lint, and the tests covering the
change all pass. When any of them fails, READ the error, FIX the cause,
and RE-RUN — don't report a failure as the final answer.

Cap fix attempts at three on the same failure, then escalate to the
operator with the specific error and what you tried. Full procedure,
stack-specific commands, and the preflight checklist → `docs/verification.md`.

---

## Code quality floor

- Functions are verbs (`parseConfig`), classes are nouns (`UserService`),
  booleans are predicates (`isReady`, `hasParent`).
- Comments explain **why**, not what. The code shows the what.
- Errors surface at module boundaries; don't catch-and-ignore.
- No silent fallbacks that mask the real failure mode.
- No debug leftovers (`console.log`, `print(...)`, `dump`, `debugger`) in
  committed code unless routed through the project's logger.
- One env-access module per project. No scattered `process.env.X` reads.
- Soft ceilings: files ≤ 200 lines, functions ≤ 50 lines. Refactor if
  you breach either, unless there's a real reason not to.

Deeper guidance + examples → `docs/code-quality.md`.

---

## Anti-patterns

- Casting your way out of a type error with `as any` / `cast(Any, x)`.
- Adding a try/except (or try/catch) that logs and continues, hiding the
  bug from callers.
- Hand-rolling validation when pydantic / zod / a schema would do it.
- Reaching past a library's public API instead of asking for a feature.
- "Cleanup" commits that bundle behaviour changes with refactors.
- Disabling tests to make the suite green.
- Inventing config flags for unimplemented behaviour.
- Copy-pasting a block to avoid a small refactor.

---

## Communication style

- Lead with the answer; context follows if needed.
- Technical register; match the developer.
- When asked for two things, do both — don't ask which one first unless
  they genuinely conflict.
- Cite file paths and line numbers when referring to code.

---

## Reference index

| Topic | File |
| --- | --- |
| TypeScript standards | `docs/typescript.md` |
| Python + FastAPI standards | `docs/python-fastapi.md` |
| Verification + self-healing loop | `docs/verification.md` |
| Security floor (rules and rationale) | `docs/security.md` |
| Code quality: naming, comments, errors | `docs/code-quality.md` |
| How to write `rules.yaml` (schema) | `docs/governance.md` |
| How trueGate enforces governance | `docs/architecture.md` |
| When governance behaves unexpectedly | `docs/troubleshooting.md` |

---

_trueGate shipped default. Customize by running `truegate global-init`,
which scaffolds `.state/governance.md` for your team. Every file in this
governance system is capped at 200 lines._

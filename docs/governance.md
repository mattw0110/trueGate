# Writing Governance

trueGate enforces governance at two layers:

1. **`governance.md`** — free-form prose, injected as a system message into every request.
2. **`rules.yaml`** — machine-readable patterns. trueGate validates every response and can `warn` or `block`.

Together: **prompt-time guidance + output-time enforcement**.

---

## Layered system

trueGate's governance is organized in two tiers, with operator state on top:

1. **Master files** (always loaded into every request, ≤200 lines each):

- `data/governance.md` — prose rules + a topic index pointing at `docs/`.
- `data/rules.yaml` — pattern enforcement on every response.

2. **Topic reference files** in `docs/` (≤200 lines each, read on demand):
   `typescript.md`, `python-fastapi.md`, `verification.md`, `security.md`,
   `code-quality.md`. The master file points at these; an AI agent with
   file access (or a human operator) reads the relevant one when needed.
3. **Operator state** in `.state/governance.md` and `.state/rules.yaml`
   replaces the shipped masters when present (never merged).

Every file in this system honors a **200-line ceiling**, with no exceptions.
That cap keeps the always-injected context small and forces topics to
stay focused.

---

## File locations

trueGate is self-contained. Governance files live inside the repo — nothing is read from your dev project directories.

| Path | Role | Tracked? |
| --- | --- | --- |
| `data/governance.md` | Shipped defaults — applied immediately, no setup required | ✓ Yes |
| `data/rules.yaml` | Shipped default rules | ✓ Yes |
| `.state/governance.md` | Operator override — replaces `data/governance.md` when present | ✗ Gitignored |
| `.state/rules.yaml` | Operator override — replaces `data/rules.yaml` when present | ✗ Gitignored |

**Resolution order per file:** `.state/` wins if present; otherwise `data/` is used. This lets you override one file without copying both.

The proxy caches compiled governance for **5 seconds**. Edit a file and the next request picks it up without restarting.

---

## Scaffolding your own governance

The shipped `data/` defaults are a reasonable starting point. To customize:

```bash
# Writes .state/governance.md + .state/rules.yaml for you to edit
truegate global-init
```

Verify what's currently loaded:

```bash
truegate inspect
```

---

## `governance.md`

Free-form Markdown. trueGate injects it verbatim as a system message. The LLM sees it on every request and biases generation accordingly.

```markdown
# Operator Governance

## Always

- Never generate destructive shell commands (rm -rf, DROP TABLE, etc.)
- Never embed credentials, API keys, or private hostnames in code.
- Treat all user input as untrusted.

## Style

- TypeScript strict mode; no `any`.
- Prefer explicit error handling at module boundaries only.
- No jQuery, moment.js, or other forbidden dependencies.

## Architecture

- All data fetching through `src/lib/api.ts`.
- Components stay UI-only — no business logic in JSX.
```

**Tips:**

- Use `##` sections — they're easier for the model to scan.
- Lead with hard constraints, follow with style preferences.
- Shorter is more reliable. Long files dilute each rule's weight.

---

## `rules.yaml`

Machine-readable enforcement. trueGate parses every LLM response and applies these patterns — the model doesn't need to understand them.

```yaml
version: '1'

forbiddenDependencies:
  - moment
  - request
  - lodash

forbiddenFrameworks:
  - jQuery
  - AngularJS

dangerousPatterns:
  # Block exact pattern
  - pattern: 'rm -rf /'
    severity: block
    message: 'Destructive rm command'

  # Block with regex (Go RE2 syntax)
  - pattern: "process\\.env\\.\\w*SECRET"
    severity: block
    message: 'Do not log or echo environment secrets'

  # Warn instead of block
  - pattern: 'TODO: fix this'
    severity: warn
    message: 'Unresolved TODO left in generated code'

typescriptRules:
  noAny: true
  requireStrict: true
```

### Severity levels

| Severity | Effect |
| --- | --- |
| `block` | Response replaced with a governance refusal. Client gets a 200 with the block notice. |
| `warn` | Warning block appended to the response. Request still delivered. |

### Built-in patterns (always active)

These fire regardless of what's in `rules.yaml`:

- `rm -rf /` and `rm -rf ~` — destructive filesystem wipe
- `curl ... | sh` and `wget ... | sh` — pipe-to-shell installers
- `sk-...` OpenAI key patterns in response text — leaked keys
- `DROP TABLE` — destructive DDL
- TLS certificate verification bypass (`verify=False`, `rejectUnauthorized: false`)

---

## What trueGate does NOT govern

- **Your dev project's own files** — trueGate does not read `CLAUDE.md`, `AGENTS.md`, `.cursor/rules`, or any other file from the project the developer is working in. Those are surfaced to the model by the IDE/agent directly. trueGate adds only its operator-wide layer on top.
- **Upstream model choice** — trueGate routes by model name but doesn't rewrite the model field.
- **Streaming content mid-stream** — `stream: false` is forced upstream; governance runs on the complete response.

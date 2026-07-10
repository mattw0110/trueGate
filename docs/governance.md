# Writing Governance

trueGate enforces governance at two layers:

1. **Prompt policy** — optional prose hints injected only when `policyMode` is `light` or `full`.
2. **`rules.yaml`** — machine-readable patterns. trueGate validates every response and can `warn` or `block`.

By default, trueGate runs as a gateway + verifier with a small targeted prompt
hint. It routes requests, validates responses, and logs decisions. Prompt
steering can be turned off or expanded.

Policy modes:

| Mode | Behavior |
| --- | --- |
| `off` | No trueGate prose is added to upstream prompts; response validation still runs. |
| `targeted` | Default. Adds a capped request-specific snippet for code quality, verification, security, TypeScript, Python, or PR work. |
| `light` | Adds a generic short safety reminder. Useful when you want minimal steering without classification. |
| `full` | Injects the full compiled `governance.md` bundle. Useful for intentional policy testing. |

Configure with:

```bash
truegate serve --policy-mode off
truegate serve --policy-mode targeted
truegate serve --policy-mode light
truegate serve --policy-mode full
```

---

## Layered system

trueGate's governance is organized in two tiers, with operator state on top:

1. **Master files** (loaded for validation and optional prompt policy, ≤200 lines each):

- `data/governance.md` — prose rules + a topic index pointing at `docs/`.
- `data/rules.yaml` — pattern enforcement on every response.

2. **Topic reference files** in `docs/` (≤200 lines each, read on demand):
   `typescript.md`, `python-fastapi.md`, `verification.md`, `security.md`,
   `code-quality.md`. The master file points at these; an AI agent with
   file access (or a human operator) reads the relevant one when needed.
3. **Operator state** in `.state/governance.md` and `.state/rules.yaml`
   replaces the shipped masters when present (never merged).

Every file in this system honors a **200-line ceiling**, with no exceptions.
That cap keeps the optional full prompt reasonably small and forces topics to
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

Free-form Markdown. trueGate injects it verbatim as a system message only when
`policyMode` is `full`. In the default `targeted` mode, the LLM sees only a
small built-in snippet selected from request text; response validation still
uses `rules.yaml`.

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

### One-shot operator override

When a response is blocked, trueGate includes an `Allow once` link in the block notice. Clicking it opens a local trueGate page and arms a short-lived one-shot override. Retry the request after clicking the link; the next blocked response is delivered once with an `Operator override used once` audit footer. Later blocked responses are stopped again unless you approve another override.

This is intended for cases where the model's output matches a block rule but the operator confirms the behavior is intentional. The override is local, expires after five minutes, and is consumed by the next blocked response only.

### Live governance log

trueGate writes redacted governance decisions to `.state/logs/governance.ndjson`. Each line is JSON with timestamp, route, provider, model, client shape, decision, rule IDs, messages, and truncated matched snippets. It does not store full prompts, full responses, headers, or credentials.

Watch it live while tuning rules:

```bash
truegate logs --follow --pretty
```

Pretty mode color-codes decisions: green `PASS`, yellow `WARN`, red `BLOCK`, and purple `OVERRIDE_ALLOWED`. Use `--no-color` if your terminal or pager should receive plain text.

Summarize recent tuning signals:

```bash
truegate logs --summary --lines 500
```

Print recent events:

```bash
truegate logs --lines 100 --pretty
```

Use raw NDJSON when piping to tools:

```bash
truegate logs --follow
```

Useful decisions are `pass`, `warn`, `block`, and `override_allowed`. A `block` event with repeated false positives usually means the matching rule is too broad. An `override_allowed` event means the operator explicitly allowed one blocked response through.

Each pretty log line also includes `governance=<source>#<hash>`. The source is `data`, `.state`, or `mixed`; the hash is a short fingerprint of the exact `governance.md` content injected for that request. The next `guidance:` line lists top-level section ranges, such as `governance.md:15-22 Non-negotiables`.

When a `rules.yaml` rule fires, pretty logs include the rule source line when trueGate can map it:

```text
- dangerous-patterns [dangerous:no-console-log] (rules.yaml:119): console.log left in code ... match="console.log("
  related guidance [guidance:code-quality-floor-no-debug-leftovers]: governance.md:71-72 Code quality floor: No debug leftovers...
```

Rule IDs can be explicit on `dangerousPatterns` entries:

```yaml
dangerousPatterns:
  - id: no-console-log
    pattern: "console\\.log\\("
    severity: warn
    message: 'console.log left in code — use a real logger or remove before commit'
```

When an ID is omitted, trueGate generates one from the rule label. Generated IDs are stable for the same text, but explicit IDs are better when you plan to tune rules over time.

Use this to verify prose guidance changes:

1. Edit `data/governance.md` while developing the main shipped set.
2. Wait five seconds for the governance cache to refresh.
3. Run `truegate inspect` and confirm the governance hash, anchors, or line numbers changed.
4. Watch `truegate logs --follow --pretty` and confirm new requests show the same `governance=data#...` hash.

The hash proves the prose file was injected. `rules.yaml` still proves enforcement through `WARN` and `BLOCK` issue rows.

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

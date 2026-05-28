# Writing Governance

trueGate enforces governance at two layers:

1. **`governance.md`** — free-form prose, injected as a system message. Shapes how the LLM behaves.
2. **`rules.yaml`** — machine-readable patterns. trueGate validates every response and can `warn` or `block`.

Together, they form **prompt-time guidance + output-time enforcement**.

---

## File locations

| Path                            | Scope             | Purpose                                                               |
| ------------------------------- | ----------------- | --------------------------------------------------------------------- |
| **`~/.truegate/governance.md`** | **Operator-wide** | **Applies to every project. Set by you, not editable per-project.**   |
| **`~/.truegate/rules.yaml`**    | **Operator-wide** | **Always-on enforcement. Layered ABOVE project rules — unremovable.** |
| `.truegate/governance.md`       | Per-project       | Primary governance prose for one repo                                 |
| `.truegate/rules.yaml`          | Per-project       | Machine-enforced rules for one repo                                   |
| `CLAUDE.md`                     | Per-project       | Auto-loaded — same prose as Claude Code reads                         |
| `AGENTS.md`                     | Per-project       | Auto-loaded — for non-Claude agents                                   |
| `.cursor/rules/*.mdc`           | Per-project       | Auto-loaded — Cursor rule files (concatenated alphabetically)         |

trueGate compiles all of these into one system message at request time. Cache TTL: **5 seconds** — edit a file, the next request picks it up.

Priority order (highest authority first): `global` > `truegate` > `claude` > `cursor` > `agents`.

### "I want central control across every project I work in"

Run once on your machine:

```bash
truegate global-init
```

That writes `~/.truegate/governance.md` and `~/.truegate/rules.yaml` with starter operator-wide content. Rules there fire on every request regardless of which project root trueGate is serving. Per-project files can **add** rules but cannot subtract operator-wide ones — `block`-severity entries in the global rules.yaml are effectively unremovable safety floors.

To verify the layering: `truegate inspect` shows both global and project sources separately.

---

## `.truegate/governance.md`

Free-form Markdown. trueGate doesn't parse it — it injects it into the system message verbatim. Examples of useful sections:

```markdown
# Project Governance

## Tech Stack

- TypeScript (strict mode)
- React 18 (no class components)
- Tailwind CSS — no inline styles

## Architecture

- All data fetching through `src/lib/api.ts`
- Components stay UI-only — no business logic
- Server actions live in `src/server/actions/`

## Forbidden

- Do not introduce new `any` types
- Do not add jQuery or moment.js
- Do not call third-party APIs from client code

## Style

- Names: kebab-case for files, camelCase for vars, PascalCase for components
- Tests live next to the file: `foo.ts` + `foo.test.ts`
- One default export per file
```

The LLM sees this on every request. It biases generation toward your conventions before any code is generated.

---

## `.truegate/rules.yaml`

Machine-readable enforcement layer. trueGate inspects every response and applies these rules.

```yaml
version: '1'

# Reject npm packages by name. Severity: warn (default).
forbiddenDependencies:
  - moment
  - lodash
  - request

# Reject framework names in suggestions. Severity: warn.
forbiddenFrameworks:
  - Angular
  - Vue 2

# Custom regex patterns. Each entry is either a bare string or an object.
# trueGate also enforces a built-in block list (rm -rf /, curl|sh, sk-*, DROP TABLE, etc.)
dangerousPatterns:
  - pattern: "process\\.env\\.\\w*SECRET"
    severity: block
    message: 'Do not log or echo environment secrets'
  - pattern: "eval\\("
    severity: block
    message: 'eval() is forbidden'
  - 'TODO: remove before deploy' # bare string = warn

typescriptRules:
  noAny: true # warn on `: any`
  requireStrict: true # warn when tsconfig is suggested without "strict": true
```

### Severity

| Severity | Effect                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------- |
| `pass`   | No action                                                                                         |
| `warn`   | Response is delivered, but a `⚠ Governance Warning` block is appended                             |
| `block`  | Response content is **replaced** with a `🚫 Governance Block` refusal explaining which rule fired |

`block` always wins. If any rule blocks, the entire response is replaced.

---

## Built-in dangerous patterns

These fire as `block` regardless of your `rules.yaml`:

- `rm -rf /` and `rm -rf ~/`
- `curl ... | sh` / `curl ... | bash` and the `wget` variants
- `sk-[a-zA-Z0-9]{20,}` — leaked OpenAI keys
- `sk-ant-[...]` — leaked Anthropic keys
- `DROP TABLE` (case-insensitive)
- `format c:\ /y`
- `mkfs.{ext4,xfs,...} /dev/sda` etc.

You can add to this list via `rules.yaml > dangerousPatterns`. You **cannot** disable the built-ins (and shouldn't — they're the safety floor).

---

## Practical patterns

### Block a specific banned identifier

```yaml
dangerousPatterns:
  - pattern: "\\bsendDataToLegacyBackend\\b"
    severity: block
    message: 'Legacy endpoint deprecated — use sendDataToV2'
```

### Warn on `console.log` in committed code

```yaml
dangerousPatterns:
  - pattern: "console\\.log\\("
    severity: warn
    message: 'Strip console.log before committing'
```

### Warn on `// @ts-ignore`

```yaml
dangerousPatterns:
  - pattern: '@ts-ignore'
    severity: warn
    message: '@ts-ignore hides bugs — fix the type instead'
```

### Block known-exposed model output (e.g. internal endpoint leaking)

```yaml
dangerousPatterns:
  - pattern: "internal-api\\.acme\\.corp"
    severity: block
    message: 'Internal API host should never appear in committed code'
```

---

## Verifying what's loaded

```bash
truegate inspect
```

Shows:

- which governance sources were loaded
- compiled rule counts
- first 500 chars of the system message that will be injected

Use this when a request behaves unexpectedly — usually a file isn't where you thought, or YAML didn't parse.

---

## Testing a file or response against your rules

```bash
truegate validate path/to/code.ts        # check a file
cat response.json | truegate validate    # check piped content
```

Exit code is non-zero on `block`, zero on `warn` or `pass`. Use in CI:

```bash
truegate validate dist/ && deploy
```

---

## Anti-patterns to avoid

- **Don't put credentials in `governance.md`.** It's injected into every prompt — anything in it goes to the LLM provider.
- **Don't write rules that block the desired output.** If your rule fires on legitimate code, you'll get blank responses constantly. Test with `truegate validate` first.
- **Don't make `rules.yaml` huge.** It runs on every response. ~50 patterns is fine; ~5000 will hurt latency.
- **Don't duplicate Claude Code's built-in instructions** in `governance.md` if you already have a good `CLAUDE.md`. trueGate auto-loads both.

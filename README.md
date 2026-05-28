# trueGate

> Local-first governance proxy for AI coding tools. Operator-wide guidance + response validation, layered under each project's own conventions. Never modifies your project repos.

```
┌──────────────┐   ┌────────────┐   ┌───────────────┐
│  Your IDE    │──▶│  trueGate  │──▶│ LLM Provider  │
│  (any tool)  │   │  governance│   │ (Claude/GPT/  │
└──────────────┘   │  enforced  │   │  Ollama/...)  │
                   └────────────┘   └───────────────┘
```

## What it does

- **Project-first governance** — reads your project's own `CLAUDE.md`, `AGENTS.md`, and `.cursor/rules/*.mdc` and treats them as the source of truth for that project. trueGate writes nothing into your repos.
- **Operator-wide guidance** — your `~/.truegate/` knowledge base (governance prose, code style, security, accessibility, components, patterns, references) is appended as a recommendation that **defers to project files on every conflict**.
- **Validates responses** — blocks dangerous output (`rm -rf /`, leaked `sk-` keys, `DROP TABLE`, pipe-to-shell installers, TLS bypass) regardless of any documentation — a hard security floor. Warns on policy drift (forbidden deps, `any` types).
- **Tool-call aware** — scans `tool_use.input` and `function_call.arguments` for dangerous patterns, not just plain text.
- **Speaks every major API** — `/v1/messages` (Claude Code, Anthropic SDK), `/v1/chat/completions` (Cursor, OpenAI SDK, Continue.dev), `/v1/responses` (Codex CLI). Agent Zero envelope-shape requests handled natively.
- **No vendor lock-in** — works direct with OpenAI/Anthropic, with local Ollama/LM Studio, with [CLIProxyAPI](https://help.router-for.me) (multi-provider OAuth), with GitHub Copilot, or any OpenAI-compatible endpoint.
- **Visible confirmation** — every response ends with a `— trueGate` marker on its own line so you can see governance is active.

## Governance priority

```
Highest authority
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ 1. Security floor — never-negotiable response blocks    │
│    (rm -rf, leaked keys, DROP TABLE, TLS bypass…)       │
├─────────────────────────────────────────────────────────┤
│ 2. Project files (in this repo)                         │
│    • CLAUDE.md                                          │
│    • AGENTS.md                                          │
│    • .cursor/rules/*.mdc                                │
├─────────────────────────────────────────────────────────┤
│ 3. Operator-wide guidance (~/.truegate/)                │
│    Applied when project is silent. Defers to project.   │
└─────────────────────────────────────────────────────────┘
       │
       ▼
Lowest authority
```

When the AI detects a conflict between operator guidance and project documentation, it follows the project AND notes the conflict in its response.

## Install

**👉 Full step-by-step walkthrough: [docs/install.md](docs/install.md)** (~10 min, covers prerequisites, install, config, project setup, IDE wiring, and running as a background service on macOS/Linux/Windows.)

### TL;DR

trueGate is **operator-wide only**. It does NOT install anything into your project repos — projects keep their own CLAUDE.md / AGENTS.md / .cursor/rules. trueGate adds an operator-wide guidance layer that defers to the project on every conflict.

```bash
# 1. Build & install
git clone <repo> trueGate && cd trueGate && npm install && npm run build
sudo ln -s "$(pwd)/dist/cli/index.cjs" /usr/local/bin/truegate    # optional

# 2. Configure provider + token (interactive — writes ~/.truegate/config.json)
truegate setup

# 3. Scaffold the operator-wide knowledge base (~/.truegate/governance.md + topics/)
truegate kb-init

# 4. Start the proxy
truegate serve

# 5. Point your IDE at it (prints ready-to-paste env vars / settings)
truegate ide claude-code
truegate ide cursor
truegate ide codex
```

Every conversation in your IDE now flows through your operator-wide governance — while still respecting each project's own conventions.

## Commands

| Command                    | What it does                                                                 |
| -------------------------- | ---------------------------------------------------------------------------- |
| `truegate setup`           | Interactive wizard. Saves provider + tokens to `~/.truegate/config.json`.    |
| `truegate global-init`     | Create a minimal operator-wide `~/.truegate/governance.md` + `rules.yaml`.   |
| `truegate kb-init`         | Scaffold the full operator KB (governance + topics + components + patterns). |
| `truegate login <name>`    | Log in to a provider (claude, codex, gemini, grok, github, cursor).          |
| `truegate serve [flags]`   | Start proxy. Every option is a flag — no env vars required.                  |
| `truegate ide <name>`      | Print copy-paste setup for a specific IDE.                                   |
| `truegate status`          | Is the proxy up? Is the upstream reachable?                                  |
| `truegate inspect`         | What governance got loaded for the current project?                          |
| `truegate validate [file]` | Run rules against a file or stdin. Non-zero exit on block.                   |

Run `truegate <command> --help` for full flag listings.

## Documentation

- **[docs/install.md](docs/install.md)** — full install & setup guide (start here)
- **[docs/quickstart.md](docs/quickstart.md)** — condensed setup walkthrough
- **[docs/ide-setup.md](docs/ide-setup.md)** — per-IDE recipes (Claude Code, Codex, Cursor, Continue.dev, Zed, raw SDKs)
- **[docs/governance.md](docs/governance.md)** — writing effective governance files and rules (incl. operator-wide governance)
- **[docs/login.md](docs/login.md)** — provider login flows (Claude/Codex/Gemini/Grok via CLIProxyAPI, GitHub via `gh`)
- **[docs/architecture.md](docs/architecture.md)** — how the proxy works internally
- **[docs/troubleshooting.md](docs/troubleshooting.md)** — common gotchas

## Provider presets

```bash
truegate serve --provider cliproxy       # CLIProxyAPI on :8317 (OAuth multi-provider)
truegate serve --provider anthropic --token sk-ant-...
truegate serve --provider openai    --token sk-...
truegate serve --provider ollama         # local, no key needed
truegate serve --provider lmstudio       # local, no key needed
truegate serve --provider github-copilot --github-token $(gh auth token)
truegate serve --provider custom --upstream-url https://api.groq.com --token gsk_...
```

Or save it once with `truegate setup` and just run `truegate serve`.

## Configuration precedence

```
CLI flags  >  env vars  >  ~/.truegate/config.json  >  defaults
```

So flags override everything; env vars override the saved file; the saved file is the fallback for ergonomics.

## License

MIT

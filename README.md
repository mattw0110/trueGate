# trueGate

> Local-first governance proxy for AI coding tools. Operator-wide guidance + response validation, layered under each project's own conventions. Never modifies your project repos.

```
┌──────────────┐   ┌────────────┐   ┌───────────────┐
│  Your IDE    │──▶│  trueGate  │──▶│ LLM Provider  │
│  (any tool)  │   │  :8457     │   │ (Claude/GPT/  │
└──────────────┘   └────────────┘   │  Ollama/...)  │
                   auto-routes by   └───────────────┘
                   model name
```

## What it does

- **Auto-routes by model name — start with no flags.** trueGate probes every reachable upstream ([CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI), Ollama, LM Studio, OpenAI, Anthropic, GitHub Copilot) at startup and dispatches each request to the right backend automatically.
- **Operator-wide governance** — ships with a governance bundle in `data/`. Override it with your own files in `.state/`. **Never touches dev project directories.**
- **Response validation** — blocks dangerous output (`rm -rf /`, leaked `sk-` keys, `DROP TABLE`, pipe-to-shell) and warns on policy drift (forbidden deps, `any` types).
- **Tool-call aware** — scans `tool_use.input` and `function_call.arguments`, not just plain text.
- **Every major API** — `/v1/messages` (Claude Code, Anthropic SDK), `/v1/chat/completions` (Cursor, OpenAI SDK, Continue.dev), `/v1/responses` (Codex CLI). **Agent Zero envelope requests handled natively.**
- **Transparent** — every response carries `— trueGate · provider/model` and an `x-truegate-upstream` header.
- **Self-contained** — `git clone && npm install && npm start`. Zero files written outside the repo.

## Quickstart

```bash
git clone <repo> trueGate && cd trueGate
npm install && npm run build

# Configure provider + token (writes .state/config.json)
node dist/cli/index.cjs setup

# Start — auto-detects upstreams, routes by model name
node dist/cli/index.cjs serve
```

Startup output:

```
[truegate] cliproxy   127.0.0.1:8317  ✓ 27 models (claude-sonnet-4-5, gpt-5.5, …)
[truegate] ollama     localhost:11434  ✓ 4 models (llama3.1, qwen2.5-coder, …)
[truegate] lmstudio   localhost:1234   ✗ unreachable
[truegate] mode=auto, priority=openai>anthropic>cliproxy>ollama>lmstudio
trueGate proxy listening on http://localhost:8457
```

## Commands

| Command | What it does |
| --- | --- |
| `truegate setup` | Interactive wizard. Writes `.state/config.json`. |
| `truegate global-init` | Create minimal operator governance in `.state/`. |
| `truegate kb-init` | Scaffold the full operator knowledge base in `.state/`. |
| `truegate serve [flags]` | Start proxy with auto-upstream detection. |
| `truegate ide <name>` | Print copy-paste setup for an IDE. |
| `truegate status` | Proxy health + full upstream registry. |
| `truegate inspect` | What governance is loaded right now. |
| `truegate login <name>` | Log in to a provider (claude, codex, gemini, grok, github, cursor). |
| `truegate validate [file]` | Run rules against a file or stdin. |

## `truegate serve` flags

| Flag | Effect |
| --- | --- |
| `--provider <name>` | Force every request to this upstream |
| `--no-auto` | Skip startup probes; require explicit `--provider` |
| `--port <n>` | Listen port (default 8457) |
| `--token <value>` | API token for the active provider |
| (none) | Auto-mode: probe all upstreams, route by model name |
| `--no-response-marker` | Disable the trailing marker |

## Folder layout

```
trueGate/
  data/             shipped governance defaults (tracked)
    governance.md
    rules.yaml
  .state/           operator overrides + config (gitignored)
    config.json
    governance.md   optional: overrides data/governance.md
    rules.yaml      optional: overrides data/rules.yaml
  vendor/           bundled binaries (gitignored)
  src/
  dist/
```

## Governance

```bash
truegate global-init   # writes .state/governance.md + .state/rules.yaml
truegate kb-init       # writes a full operator knowledge base to .state/
truegate inspect       # see exactly what's loaded
```

See [governance.md](./docs/governance.md) for how to write rules.

## Config precedence

```
CLI flags  >  TRUEGATE_* env vars  >  .state/config.json  >  built-in defaults
```

## Documentation

- [install.md](./docs/install.md) — full install & setup (start here)
- [quickstart.md](./docs/quickstart.md) — condensed walkthrough
- [ide-setup.md](./docs/ide-setup.md) — per-IDE recipes
- [governance.md](./docs/governance.md) — writing governance files and rules
- [login.md](./docs/login.md) — provider login flows
- [architecture.md](./docs/architecture.md) — how the proxy works internally
- [troubleshooting.md](./docs/troubleshooting.md) — common gotchas

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) — bugs, feature requests, pull request workflow, code style, and how to add new provider support.

## License

MIT

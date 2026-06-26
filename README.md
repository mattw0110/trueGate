<p align="center">
  <img src="logo.png" alt="trueGate logo" width="200" />
</p>

# trueGate

> Self-contained governance proxy for AI coding tools. Routes requests by model name, injects operator-wide guidance, and validates responses. Install it once, point every tool at `http://localhost:8457`, and keep governance out of your project repos.

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
- **Operator-wide governance — ships with a governance bundle in data/.** Override it with your own files in `.state/`.
- **Response validation** — blocks dangerous output (`rm -rf /`, leaked `sk-` keys, `DROP TABLE`, pipe-to-shell) and warns on policy drift (forbidden deps, `any` types).
- **Tool-call aware** — scans `tool_use.input` and `function_call.arguments`, not just plain text.
- **Every major API** — `/v1/messages` (Claude Code, Anthropic SDK), `/v1/chat/completions` (Cursor, OpenAI SDK, Continue.dev), `/v1/responses` (Codex CLI). **Agent Zero envelope requests handled natively.**
- **Transparent** — every response carries `— trueGate · provider/model` and an `x-truegate-upstream` header.
- **Local + hosted friendly** — use hosted Claude/GPT through CLIProxyAPI or direct API keys, local Ollama/LM Studio for offline fallback, or both in auto-routing mode.
- **Self-contained** — `git clone && npm install && npm start`. Runtime state lives in this repo's `.state/` and `vendor/` directories unless you intentionally point trueGate at a system-wide provider.

## Quickstart

```bash
git clone https://github.com/mattw0110/trueGate.git && cd trueGate
npm install && npm run build

# Configure provider + token (writes .state/config.json)
node dist/cli/index.cjs setup

# Start — auto-detects upstreams, routes by model name
node dist/cli/index.cjs serve
```

Startup output:

```
[truegate] cliproxy   127.0.0.1:8317  ✓ 27 models (claude-sonnet-4-6, gpt-5.5, …)
[truegate] ollama     localhost:11434  ✓ 11 models (qwen3-coder, qwen2.5-coder, …)
[truegate] lmstudio   localhost:1234   ✗ unreachable
[truegate] mode=auto, priority=openai>anthropic>github-copilot>cliproxy>ollama>lmstudio
trueGate proxy listening on http://localhost:8457
```

Smoke test:

```bash
curl -sS http://localhost:8457/v1/chat/completions \
  -H 'content-type: application/json' \
  -H "authorization: Bearer ${CLI_PROXY_API_KEY:-dummy}" \
  -d '{"model":"claude-sonnet-4-6","messages":[{"role":"user","content":"reply exactly: ok"}],"max_tokens":20}'
```

Expected response text includes:

```
ok

— trueGate · cliproxy/claude-sonnet-4-6
```

## Commands

| Command | What it does |
| --- | --- |
| `truegate setup` | Interactive wizard. Writes `.state/config.json`. |
| `truegate global-init` | Create operator governance overrides in `.state/`. |
| `truegate serve [flags]` | Start proxy with auto-upstream detection. |
| `truegate ide <name>` | Print copy-paste setup for an IDE. |
| `truegate status` | Proxy health + full upstream registry. |
| `truegate inspect` | What governance is loaded right now. |
| `truegate logs --follow --pretty` | Live redacted governance decisions. |
| `truegate logs --summary` | Aggregate recent rule/guidance hits. |
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
- [agent0.md](./docs/agent0.md) — Agent Zero / Agent0 Docker setup through trueGate
- [governance.md](./docs/governance.md) — writing governance files and rules
- [login.md](./docs/login.md) — provider login flows
- [architecture.md](./docs/architecture.md) — how the proxy works internally
- [troubleshooting.md](./docs/troubleshooting.md) — common gotchas

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) — bugs, feature requests, pull request workflow, code style, and how to add new provider support.

## License

MIT

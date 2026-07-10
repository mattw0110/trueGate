<p align="center">
  <img src="logo.png" alt="trueGate logo" width="200" />
</p>

# trueGate

> Local LLM gateway for routing, light policy checks, and Agent0 compatibility. Point tools at `http://localhost:8457` when you need model-name routing, response validation, and cleanup/translation between Claude-style output and Agent Zero's JSON envelope.

```
┌──────────────┐   ┌────────────┐   ┌───────────────┐
│  Your IDE    │──▶│  trueGate  │──▶│ LLM Provider  │
│  (any tool)  │   │  :8457     │   │ (Claude/GPT/  │
└──────────────┘   └────────────┘   │  Ollama/...)  │
                   auto-routes by   └───────────────┘
                   model name
```

## What it actually is

trueGate is a pragmatic compatibility gateway. It is not an autonomous coding agent, not a replacement for Agent0, and not a guarantee that every upstream model will obey a tool protocol.

It does three useful things:

- **Routes by model name.** trueGate probes reachable upstreams ([CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI), Ollama, LM Studio, OpenAI, Anthropic, GitHub Copilot) and dispatches each request to the backend that advertises the requested model.
- **Keeps Agent0 envelopes cleaner.** For Agent Zero / Agent0 requests, trueGate removes its own visible markers/governance text from assistant history, avoids adding trueGate footers to Agent0 JSON, and translates high-confidence Claude/Codex tool-call drift back into Agent0 envelopes.
- **Validates obvious dangerous output.** It can block or warn on patterns such as destructive shell commands, leaked API keys, `DROP TABLE`, pipe-to-shell installers, forbidden dependencies, and other configured rules.

It also provides OpenAI-compatible `/v1/chat/completions`, Anthropic-compatible `/v1/messages`, and OpenAI Responses-compatible `/v1/responses` endpoints.

## What it is not

- It is not a general “governance brain” that makes models code better by itself.
- It does not make Claude Code natively speak Agent0. It translates common, tested formats and logs the rest.
- It does not safely invent missing tool arguments. If the upstream emits only `Invoking <tool>` with no command/path/body, trueGate will not guess.
- It should not stuff branded signatures, route names, or governance footers into Agent0 assistant history. Agent0 turns use headers/logs for provenance instead.

## Agent0 Compatibility

Agent0 expects assistant responses shaped like:

```json
{
  "thoughts": ["short reasoning"],
  "headline": "Invoking tool",
  "tool_name": "code_execution_tool",
  "tool_args": { "runtime": "terminal", "code": "pwd" }
}
```

When upstream models drift, trueGate attempts conservative recovery for known forms:

- Native Agent0 envelopes, including fenced or slightly damaged JSON.
- OpenAI and Anthropic tool calls.
- Claude Code `_calls` JSON.
- Claude markdown tool lines such as `**Read** \`path\``.
- Markdown tool headers followed by fenced shell code.
- Bare `{ "runtime": "terminal", "code": "..." }` shell objects.
- Unfenced terminal blocks after prose when the command block is clear.

For ordinary final prose, trueGate wraps the text as `tool_name: "response"` without logging it as a failure. For suspicious action-shaped misses, it logs warnings so the adapter can be improved deliberately.

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

Expected response text for normal, non-Agent0 chat includes:

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
| `--policy-mode <mode>` | Prompt policy mode: `off`, `targeted`, `light`, or `full` (default `targeted`) |
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

## Policy Checks

```bash
truegate global-init   # writes .state/governance.md + .state/rules.yaml
truegate inspect       # see exactly what's loaded
```

By default, trueGate injects a short targeted snippet based on the current
request. It still routes requests, validates responses, writes logs, and adds
the upstream marker for normal chat responses. Agent0 JSON-envelope responses do
not get visible trueGate markers because those markers become assistant-history
pollution.

Use `--policy-mode off` for no prompt injection, `--policy-mode light` for a
generic reminder, or `--policy-mode full` to inject the full operator bundle.
For Agent0 troubleshooting, start with `targeted` or `off`; heavy prompt
injection can compete with Agent0's own tool contract.

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

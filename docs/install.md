# Install & Setup

Step-by-step from "I cloned the repo" to "my IDE is going through trueGate." Plan for ~10 minutes.

For the condensed version see [quickstart.md](./quickstart.md).

---

## Prerequisites

| Need                | Why                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node.js >= 20**   | trueGate is a Node app. `node --version` must print `v20.x` or higher.                                                                                         |
| **npm**             | Comes with Node.                                                                                                                                               |
| **An LLM provider** | One of: an API key (OpenAI/Anthropic), local Ollama/LM Studio, [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI), or any OpenAI-compatible endpoint. |

You do **not** need Docker, a database, a cloud account, or admin rights.

```bash
node --version   # must be v20.x or newer
npm --version
```

---

## 1. Install

### From source (recommended while pre-release)

```bash
git clone <repo-url> trueGate
cd trueGate
npm install
npm run build
```

This produces `dist/cli/index.cjs`. Run it directly:

```bash
node dist/cli/index.cjs --help
```

Optional: make a `truegate` alias in your shell profile:

```bash
# ~/.zshrc or ~/.bashrc
alias truegate="node /path/to/trueGate/dist/cli/index.cjs"
```

### Via npm (once published)

```bash
npm install -g truegate
truegate --version
```

---

## 2. Configure your provider

trueGate keeps a small config file at `<repo>/.state/config.json`. The easiest way to populate it:

```bash
truegate setup
```

The wizard asks:

1. **Which provider** — CLIProxyAPI, Anthropic direct, OpenAI direct, Ollama, LM Studio, GitHub Copilot, or a custom URL.
2. **Credentials** — only what the provider needs. Local providers (Ollama, LM Studio) need nothing.
3. **Port** — defaults to 8457.

The file is written with `chmod 0600`.

### Hand-editing instead

```bash
mkdir -p .state
cat > .state/config.json <<'EOF'
{
  "provider": "cliproxy",
  "upstreamApiKey": "your-token-here"
}
EOF
chmod 600 .state/config.json
```

### Using env vars or CLI flags instead

```bash
# Every flag, no config file
truegate serve --provider cliproxy --token your-token

# Env vars
TRUEGATE_PROVIDER=cliproxy TRUEGATE_API_KEY=your-token truegate serve
```

Config precedence (highest first): **CLI flags > env vars > `.state/config.json` > defaults**.

---

## 3. Log in to your provider (CLIProxyAPI / OAuth providers)

If you're using CLIProxyAPI (which provides Claude, Codex, Gemini, and Grok via OAuth subscriptions):

```bash
truegate login claude    # opens browser OAuth flow
truegate login codex
truegate login gemini
```

Credentials are stored by CLIProxyAPI in `<repo>/vendor/cliproxy/` (once the bootstrap script is in place) or in the system-wide CLIProxyAPI install. See [login.md](./login.md) for full details.

---

## 4. Customize governance (optional)

trueGate ships with default governance in `data/governance.md` and `data/rules.yaml`. These apply immediately — no setup needed.

To add your own operator-wide rules:

```bash
truegate global-init   # writes .state/governance.md + .state/rules.yaml
```

Edit `.state/governance.md` to describe your coding standards, architecture, forbidden patterns. Edit `.state/rules.yaml` to add machine-enforced block/warn rules.

See [governance.md](./governance.md) for the full schema.

---

## 5. Start the proxy

```bash
truegate serve
```

Default behavior (no flags): trueGate probes every potential upstream and builds a registry. Each request is dispatched to the best-matching upstream for the requested model.

Startup output:

```
[truegate] cliproxy   127.0.0.1:8317  ✓ 27 models (claude-sonnet-4-5, gpt-5.5, …)
[truegate] ollama     localhost:11434  ✓ 4 models (llama3.1, qwen2.5-coder, …)
[truegate] lmstudio   localhost:1234   ✗ unreachable
[truegate] mode=auto, priority=openai>anthropic>cliproxy>ollama>lmstudio
trueGate proxy listening on http://localhost:8457
  → governance: bundled defaults (data/) + operator overrides (.state/)
```

To lock to a specific upstream instead of auto-routing:

```bash
truegate serve --provider cliproxy    # CLIProxyAPI on :8317
truegate serve --provider anthropic --token sk-ant-...
truegate serve --provider openai --token sk-...
truegate serve --provider ollama      # local, no key needed
truegate serve --provider lmstudio    # local, no key needed
```

---

## 6. Point your IDE at trueGate

trueGate prints ready-to-paste config for each IDE:

```bash
truegate ide claude-code     # Claude Code env vars
truegate ide codex           # Codex CLI env vars
truegate ide cursor          # Cursor settings
truegate ide continue        # Continue.dev config.json
truegate ide zed             # Zed settings.json
truegate ide openai-sdk      # OpenAI Python/Node SDK
truegate ide anthropic-sdk   # Anthropic Python/Node SDK
```

For full per-IDE recipes see [ide-setup.md](./ide-setup.md).

**Claude Code** — add to `~/.bashrc` / `~/.zshrc`:

```bash
export ANTHROPIC_BASE_URL=http://localhost:8457
export ANTHROPIC_AUTH_TOKEN=your-token
```

**Cursor** — Settings → Models → Override OpenAI Base URL: `http://localhost:8457/v1`

---

## 7. Verify it works

```bash
truegate status    # proxy health + upstream registry

# Direct curl smoke test
curl -sS http://localhost:8457/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"gpt-5.5","messages":[{"role":"user","content":"reply: ok"}]}'
```

Every response ends with `— trueGate · provider/model` and carries `x-truegate-upstream: provider/model` header confirming which backend served it.

---

## 8. Run as a background service

### Linux (systemd user unit)

```ini
# ~/.config/systemd/user/truegate.service
[Unit]
Description=trueGate governance proxy
After=network.target

[Service]
WorkingDirectory=/path/to/trueGate
ExecStart=/usr/bin/node /path/to/trueGate/dist/cli/index.cjs serve
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now truegate
systemctl --user status truegate
```

### macOS (launchd)

```xml
<!-- ~/Library/LaunchAgents/com.truegate.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.truegate</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/trueGate/dist/cli/index.cjs</string>
    <string>serve</string>
  </array>
  <key>WorkingDirectory</key><string>/path/to/trueGate</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.truegate.plist
```

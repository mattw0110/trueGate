# Quickstart

Get trueGate running in **3 minutes**.

```
┌─────────────┐  request   ┌─────────────┐  request   ┌────────────────┐
│  Your IDE   │ ─────────▶ │  trueGate   │ ─────────▶ │  LLM Provider  │
│  (Claude    │            │  :8457      │            │  (Anthropic /  │
│   Code,     │ ◀───────── │  governance │ ◀───────── │   OpenAI /     │
│   Cursor…)  │  response  │  validated  │  response  │   Ollama / …)  │
└─────────────┘            └─────────────┘            └────────────────┘
```


---

## 1. Install

Clone the repo anywhere you want trueGate to live permanently:

```bash
git clone <repo-url> ~/trueGate
cd ~/trueGate
npm install && npm run build
```

Optional — add a `truegate` alias so you can run it from anywhere:

```bash
# ~/.zshrc or ~/.bashrc
alias truegate="node ~/trueGate/dist/cli/index.cjs"
```

---

## 2. Configure your provider


The wizard asks which upstream you want ([CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI), OpenAI, Anthropic, Ollama, LM Studio, GitHub Copilot, or a custom URL) and saves the answer to `.state/config.json` inside the trueGate folder. Nothing is written anywhere else on your machine.

---

## 3. Start the proxy

```bash
truegate serve
```

With no flags, trueGate probes every potential upstream and builds a live registry. Each request is dispatched to the right backend by model name automatically:

```
[truegate] cliproxy   127.0.0.1:8317  ✓ 27 models (claude-sonnet-4-5, gpt-5.5, …)
[truegate] ollama     localhost:11434  ✓ 4 models (llama3.1, qwen2.5-coder, …)
[truegate] lmstudio   localhost:1234   ✗ unreachable
[truegate] mode=auto, priority=openai>anthropic>cliproxy>ollama>lmstudio
trueGate proxy listening on http://localhost:8457
  → governance: bundled defaults (data/) + operator overrides (.state/)
```

To force a specific upstream:

```bash
truegate serve --provider cliproxy    # always use CLIProxyAPI
truegate serve --provider ollama      # always use local Ollama
truegate serve --provider openai --token sk-...
```

---

trueGate is installed **once**, wherever you like, and runs continuously as your personal AI governance layer. It covers every IDE and every AI tool on your machine — no per-project setup, nothing added to your repos.
## 4. Point your IDEs at trueGate

Set all your AI tools to use `http://localhost:8457` as their base URL:

| IDE | Where to set it |
| --- | --- |
| Claude Code | `ANTHROPIC_BASE_URL=http://localhost:8457` |
| Cursor | Settings → Models → Override OpenAI Base URL → `http://localhost:8457/v1` |
| Codex CLI | `OPENAI_BASE_URL=http://localhost:8457/v1` |
| Continue.dev | `baseUrl: "http://localhost:8457/v1"` in config |
| Any OpenAI SDK | `base_url="http://localhost:8457/v1"` |
| Any Anthropic SDK | `base_url="http://localhost:8457"` |

Full per-IDE recipes: [ide-setup.md](./ide-setup.md)

---

## 5. Verify

```bash
truegate status    # proxy health + upstream registry
truegate inspect   # what governance is loaded
```

Every response ends with two lines:

```
— trueGate · cliproxy/claude-sonnet-4-5
Governance: operator bundle
```

This confirms governance ran and which backend served the request. The `x-truegate-upstream: provider/model` response header carries the same info programmatically.

---

## 6. Customize governance (optional)

trueGate ships with sensible defaults in `data/`. To add your own rules:

```bash
truegate global-init   # creates .state/governance.md + .state/rules.yaml
truegate kb-init       # creates a full operator knowledge base in .state/
```

Edit `.state/governance.md` in any text editor — changes take effect within 5 seconds, no restart needed. See [governance.md](./governance.md) for the full schema.

---

```bash
truegate setup
```
## Run as a background service

Start trueGate once and forget about it.

**Linux (systemd user unit):**

```bash
cat > ~/.config/systemd/user/truegate.service <<'UNIT'
[Unit]
Description=trueGate governance proxy
After=network.target

[Service]
WorkingDirectory=/home/YOU/trueGate
ExecStart=/usr/bin/node /home/YOU/trueGate/dist/cli/index.cjs serve
Restart=on-failure

[Install]
WantedBy=default.target
UNIT

systemctl --user enable --now truegate
systemctl --user status truegate
```

**macOS (launchd):**

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
    <string>/Users/YOU/trueGate/dist/cli/index.cjs</string>
    <string>serve</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/YOU/trueGate</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.truegate.plist
```

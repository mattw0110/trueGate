# Quickstart

Get trueGate running and your IDE talking to it in **3 minutes**.

```
┌─────────────┐  request   ┌─────────────┐  request   ┌────────────────┐
│  Your IDE   │ ─────────▶ │  trueGate   │ ─────────▶ │  LLM Provider  │
│  (Claude    │            │  :8457      │            │  (Anthropic /  │
│   Code,     │ ◀───────── │  governance │ ◀───────── │   OpenAI /     │
│   Cursor…)  │  response  │  enforced   │  response  │   Ollama /     │
└─────────────┘            └─────────────┘            │   CLIProxyAPI) │
                                                      └────────────────┘
```

## 1. Install

```bash
git clone <repo> trueGate && cd trueGate
npm install && npm run build
```

(Once published to npm: `npm install -g truegate`.)

## 2. Initialize governance in your project

```bash
cd /path/to/your-project
truegate init
```

Two files are created:

- **`.truegate/governance.md`** — prose. Your team's coding standards, architecture rules, anti-patterns. Injected as a system message into every LLM request.
- **`.truegate/rules.yaml`** — machine-readable rules: forbidden dependencies, forbidden frameworks, dangerous regex patterns.

trueGate also auto-loads `CLAUDE.md`, `AGENTS.md`, and `.cursor/rules/*.mdc` if they exist.

Verify what got loaded:

```bash
truegate inspect
```

## 3. Start the proxy

Pick one of the presets below. trueGate listens on `http://localhost:8457` by default.

### Option A — CLIProxyAPI (Claude Code / Codex / multi-provider via OAuth)

If you already use [CLIProxyAPI](https://help.router-for.me) on port 8317:

```bash
TRUEGATE_PROVIDER=cliproxy truegate serve
```

That's it. trueGate auto-targets `http://127.0.0.1:8317`. Your client's auth token is forwarded verbatim.

### Option B — Direct Anthropic

```bash
TRUEGATE_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... truegate serve
```

### Option C — Direct OpenAI

```bash
TRUEGATE_PROVIDER=openai OPENAI_API_KEY=sk-... truegate serve
```

### Option D — Local Ollama (no API key needed)

```bash
# Start ollama first: `ollama serve`
TRUEGATE_PROVIDER=ollama truegate serve
```

### Option E — Local LM Studio

```bash
TRUEGATE_PROVIDER=lmstudio truegate serve
```

### Option F — Anything else (Groq, Azure, Together, …)

```bash
TRUEGATE_PROVIDER=custom \
TRUEGATE_UPSTREAM_URL=https://api.groq.com/openai/v1 \
TRUEGATE_API_KEY=gsk_... \
truegate serve
```

## 4. Point your IDE at it

trueGate exposes **three native API shapes** so it's a drop-in for any of them:

| Endpoint                    | Used by                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `POST /v1/messages`         | Claude Code, Anthropic SDK                                         |
| `POST /v1/chat/completions` | OpenAI SDK, Cursor, Continue.dev, Codex (older), Cody, most things |
| `POST /v1/responses`        | Codex (current), OpenAI Responses API SDKs                         |

Per-IDE setup recipes are in **[ide-setup.md](./ide-setup.md)**. Highlights:

**Claude Code**:

```bash
ANTHROPIC_BASE_URL=http://localhost:8457 \
ANTHROPIC_AUTH_TOKEN=your-token \
claude
```

**Cursor** (Settings → Models → Override OpenAI Base URL):

```
http://localhost:8457/v1
```

**Any OpenAI SDK**:

```python
client = OpenAI(base_url="http://localhost:8457/v1", api_key="...")
```

## 5. Verify it's working

```bash
# Should return "alpha" — confirms governance was injected and validated cleanly
curl -sS http://localhost:8457/v1/messages \
  -H 'content-type: application/json' \
  -H 'x-api-key: your-token' \
  -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":40,"messages":[{"role":"user","content":"reply: alpha"}]}'
```

You should also see your governance text in the system message — verify with:

```bash
truegate inspect
```

## What now?

- **[ide-setup.md](./ide-setup.md)** — per-IDE recipes
- **[governance.md](./governance.md)** — writing effective rules
- **[architecture.md](./architecture.md)** — how trueGate works internally
- **[troubleshooting.md](./troubleshooting.md)** — common gotchas

## Run as a background service

Most users start trueGate once and forget about it. To run on login:

**macOS (launchd)**:

```xml
<!-- ~/Library/LaunchAgents/com.truegate.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Label</key><string>com.truegate</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/trueGate/dist/cli/index.cjs</string>
    <string>serve</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TRUEGATE_PROVIDER</key><string>cliproxy</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
```

Then: `launchctl load ~/Library/LaunchAgents/com.truegate.plist`

**Linux (systemd user unit)**:

```ini
# ~/.config/systemd/user/truegate.service
[Unit]
Description=trueGate governance proxy
After=network.target

[Service]
Environment=TRUEGATE_PROVIDER=cliproxy
ExecStart=/usr/bin/node /path/to/trueGate/dist/cli/index.cjs serve
Restart=on-failure

[Install]
WantedBy=default.target
```

Then: `systemctl --user enable --now truegate`

**Windows** — use NSSM or run from PowerShell startup.

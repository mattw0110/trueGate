# Install & Setup

A step-by-step guide from "I cloned the repo" to "Claude Code in my editor is going through trueGate, and my project's governance is being enforced." Plan for ~10 minutes the first time.

If you just want the bullet version, see the [README](../README.md). This page is the careful, opinionated walkthrough.

---

## 1. Prerequisites

| Need                | Why                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Node.js ≥ 20**    | trueGate is a Node app. `node --version` should print `v20.x` or higher.                                                                                           |
| **npm**             | Comes with Node.                                                                                                                                                   |
| **An LLM provider** | One of: an OpenAI/Anthropic API key, a local Ollama or LM Studio install, a [CLIProxyAPI](https://help.router-for.me) instance, or any OpenAI-compatible endpoint. |

You do **not** need Docker, a database, a cloud account, or admin rights. trueGate is a single Node process bound to localhost.

Check Node:

```bash
node --version    # must be v20.x or newer
npm --version
```

If your Node is too old, install via [nvm](https://github.com/nvm-sh/nvm) (macOS/Linux) or [Volta](https://volta.sh).

---

## 2. Install trueGate

### Option A — From source (current default while pre-release)

```bash
git clone <repo-url> trueGate
cd trueGate
npm install
npm run build
```

This produces `dist/cli/index.cjs`. You can run it directly:

```bash
node dist/cli/index.cjs --help
```

Make a global `truegate` command (recommended):

```bash
# macOS / Linux
sudo ln -s "$(pwd)/dist/cli/index.cjs" /usr/local/bin/truegate
truegate --help

# Or, without sudo, via npm link:
npm link
truegate --help
```

Test it:

```bash
truegate --version    # should print 0.1.0
```

### Option B — Via npm (once published)

```bash
npm install -g truegate
truegate --version
```

(Not on npm yet — use Option A.)

### Option C — Run via `npx` without install

```bash
npx truegate <command>
```

(Will work once published.)

---

## 3. Configure trueGate

trueGate keeps a small config file at `~/.truegate/config.json` so you don't have to set env vars for every command. The easiest way to populate it is the interactive wizard:

```bash
truegate setup
```

The wizard asks three things:

1. **Which provider** — pick from a numbered list (CLIProxyAPI, Anthropic direct, OpenAI direct, Ollama, LM Studio, GitHub Copilot, or a custom OpenAI-compatible URL).
2. **Credentials** — only what the chosen provider needs. Local providers (Ollama, LM Studio) need nothing.
3. **Optional** — port override (defaults to `8457`), upstream URL override.

The file is written with `chmod 0600` so other users on the machine can't read your tokens.

### Skipping the wizard

If you'd rather hand-edit, write the file yourself:

```bash
mkdir -p ~/.truegate
cat > ~/.truegate/config.json <<'EOF'
{
  "provider": "cliproxy",
  "port": 8457,
  "upstreamApiKey": "your-token-here"
}
EOF
chmod 600 ~/.truegate/config.json
```

The schema is documented at the top of [`src/config/user-config.ts`](../src/config/user-config.ts).

### Skipping config entirely

You can also pass everything as flags every time:

```bash
truegate serve \
  --provider cliproxy \
  --token your-token-here \
  --port 8457
```

Or via env vars:

```bash
TRUEGATE_PROVIDER=cliproxy \
TRUEGATE_API_KEY=your-token-here \
truegate serve
```

Precedence (highest first): **CLI flags > env vars > `~/.truegate/config.json` > defaults**.

---

## 4. Set up operator-wide governance

trueGate is **operator-wide only** — it does NOT install per-project artifacts. Projects keep their own `CLAUDE.md` / `AGENTS.md` / `.cursor/rules/`. trueGate adds a global layer that **defers to the project on every conflict**.

Scaffold the operator KB:

```bash
truegate kb-init
```

That writes `~/.truegate/` with `governance.md` (the index) + `topics/` (code-style, security, frontend, backend, etc.) + `components/` + `patterns/` + `references/`. Edit any of these to reflect what you want enforced across every project.

For a minimal scaffold (just `governance.md` + `rules.yaml`), use:

```bash
truegate global-init
```

Verify what's loaded for the current project:

```bash
cd /path/to/your-project
truegate inspect
```

You'll see your project's own files (CLAUDE.md, AGENTS.md, .cursor/rules) listed first, then the operator-wide guidance below. Projects with their own conventions take precedence — see [governance.md](./governance.md) for how the priority chain works.

---

## 5. Start the proxy

```bash
truegate serve
```

You should see:

```
trueGate proxy listening on http://localhost:8457
  → provider: cliproxy
  → project root: /home/you/your-project
```

Leave that terminal running. To verify from another shell:

```bash
truegate status
```

Should report `proxy OK` and `upstream reachable`.

---

## 6. Point your IDE at trueGate

trueGate gives you ready-to-paste snippets:

```bash
truegate ide claude-code     # Claude Code env vars
truegate ide codex           # Codex / OpenAI CLI env vars
truegate ide cursor          # Cursor base URL settings
truegate ide continue        # Continue.dev config.json
truegate ide zed             # Zed settings.json
truegate ide openai-sdk      # OpenAI Python/Node SDK
truegate ide anthropic-sdk   # Anthropic Python/Node SDK
```

The token in those snippets is read from your saved config — never from random env vars — so there's no accidental key leakage.

Make the IDE config permanent. For example, Claude Code:

```bash
# ~/.zshrc or ~/.bashrc
export ANTHROPIC_BASE_URL=http://localhost:8457
export ANTHROPIC_AUTH_TOKEN=your-token-here
```

Then every `claude` invocation goes through trueGate, no per-shell setup.

For full IDE-specific recipes, see [ide-setup.md](./ide-setup.md).

---

## 7. (Optional) Run as a background service

Most users start trueGate once and forget about it. To start it automatically at login:

### macOS (launchd)

Create `~/Library/LaunchAgents/com.truegate.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.truegate</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/absolute/path/to/trueGate/dist/cli/index.cjs</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/truegate.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/truegate.err</string>
</dict>
</plist>
```

Load it:

```bash
launchctl load ~/Library/LaunchAgents/com.truegate.plist
launchctl start com.truegate
```

Confirm:

```bash
truegate status
```

### Linux (systemd user unit)

Create `~/.config/systemd/user/truegate.service`:

```ini
[Unit]
Description=trueGate governance proxy
After=network.target

[Service]
ExecStart=/usr/bin/node /absolute/path/to/trueGate/dist/cli/index.cjs serve
Restart=on-failure
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
```

Then:

```bash
systemctl --user daemon-reload
systemctl --user enable --now truegate
systemctl --user status truegate
journalctl --user -u truegate -f      # tail the logs
```

### Windows

Easiest: use [NSSM](https://nssm.cc) to wrap the Node command as a Windows service.

Quick-and-dirty: drop a `.cmd` file in your Startup folder:

```cmd
@echo off
start /b node "C:\path\to\trueGate\dist\cli\index.cjs" serve
```

---

## 8. Verify the full pipeline

With trueGate running and your IDE configured, run a real request from your IDE. Then check the trueGate process log — you should see `incoming request` lines for every IDE call.

For a hands-off test from a second terminal:

```bash
curl -sS http://localhost:8457/v1/messages \
  -H 'content-type: application/json' \
  -H 'x-api-key: your-token-here' \
  -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":40,"messages":[{"role":"user","content":"reply: ok"}]}' \
  | jq -r '.content[0].text'
```

Expected output: `ok` (or similar). If it works, you're done.

If governance is loaded but the response isn't blocking dangerous content, test the block path:

```bash
echo 'DROP TABLE users' | truegate validate
# exits 1 and prints a 🚫 Governance Block message
```

---

## 9. Updating trueGate

### Option A (from source)

```bash
cd /path/to/trueGate
git pull
npm install
npm run build
# Restart the service:
launchctl unload ~/Library/LaunchAgents/com.truegate.plist && launchctl load ~/Library/LaunchAgents/com.truegate.plist
# or:
systemctl --user restart truegate
```

### Option B (npm)

```bash
npm install -g truegate@latest
```

---

## 10. Uninstalling

```bash
# Stop & disable the service
launchctl unload ~/Library/LaunchAgents/com.truegate.plist
rm ~/Library/LaunchAgents/com.truegate.plist
# — or —
systemctl --user disable --now truegate
rm ~/.config/systemd/user/truegate.service

# Remove the global command
sudo rm /usr/local/bin/truegate
# — or —
npm uninstall -g truegate

# Remove saved config (contains tokens — wipe deliberately)
rm -rf ~/.truegate

# Remove the source clone
rm -rf /path/to/trueGate
```

trueGate does not write any files into your project repos, so there's nothing to clean up per-repo. Operator-wide content lives entirely under `~/.truegate/`.

---

## Common stumbles

| Symptom                              | Fix                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `node: command not found`            | Install Node 20+ via nvm/Volta                                                                     |
| `EADDRINUSE :::8457`                 | Something else owns the port. `lsof -ti:8457`, or `truegate serve --port 8458`                     |
| `truegate: command not found`        | Symlink/`npm link` step skipped. Run `node dist/cli/index.cjs ...` or redo step 2                  |
| IDE seems to bypass trueGate         | The env var wasn't set in the IDE's shell. Re-export in the SAME terminal where you launch the IDE |
| Status says `upstream unreachable`   | Start the upstream first (CLIProxyAPI, Ollama, …) and check the URL in your config                 |
| Token leaks in `truegate ide` output | Run `truegate setup` to save the right token; the `ide` command reads only from the saved config   |

More in [troubleshooting.md](./troubleshooting.md).

---

## What next?

- **[quickstart.md](./quickstart.md)** — same path but condensed
- **[ide-setup.md](./ide-setup.md)** — per-IDE recipes
- **[governance.md](./governance.md)** — write effective governance & rules
- **[architecture.md](./architecture.md)** — how trueGate works
- **[troubleshooting.md](./troubleshooting.md)** — fixes for everything that goes wrong

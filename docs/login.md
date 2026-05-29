# Authentication & Login

trueGate is a governance proxy, not an auth provider. It forwards your client's credentials to the configured upstream. For OAuth-based providers (Claude, Codex, Gemini, Grok), trueGate drives **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)**'s login flow. For GitHub Copilot, trueGate uses the `gh` CLI.

```bash
truegate login <provider>
```

## Supported providers

| Provider | Mechanism     | What happens                                                               |
| -------- | ------------- | -------------------------------------------------------------------------- |
| `claude` | CLIProxyAPI   | Runs `cli-proxy-api --claude-login` (browser, claude.ai OAuth)             |
| `codex`  | CLIProxyAPI   | Runs `cli-proxy-api --codex-login` (browser, ChatGPT OAuth)                |
| `gemini` | CLIProxyAPI   | Runs `cli-proxy-api --gemini-login`                                        |
| `grok`   | CLIProxyAPI   | Runs `cli-proxy-api --grok-login`                                          |
| `github` | `gh` CLI      | Runs `gh auth login --scopes copilot`, saves token to `.state/config.json` |
| `cursor` | not supported | Cursor has no public OAuth API; see the IDE setup recipe below             |

## Why CLIProxyAPI for Claude / Codex / Gemini / Grok?

These providers use proprietary OAuth flows tied to consumer products (claude.ai, chatgpt.com, etc.). Each requires a registered OAuth client, a browser redirect flow, token refresh logic, and provider-specific session storage.

[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) ([docs](https://help.router-for.me)) already implements all of that. trueGate's job is governance — reinventing OAuth would distract from that.

## Examples

### Log in to Claude

```bash
truegate login claude
# (browser opens → claude.ai OAuth → returns to terminal)

truegate serve   # auto-mode: routes claude-* models through cliproxy
```

### Log in to Codex

```bash
truegate login codex
# (browser opens → ChatGPT OAuth → credential saved to CLIProxyAPI)

truegate serve   # auto-mode: routes gpt-* / codex-* models through cliproxy
```

### Log in to GitHub Copilot

```bash
truegate login github
# (browser opens → GitHub OAuth)
# trueGate captures `gh auth token` and saves it to .state/config.json

truegate serve --provider github-copilot
```

### Use Cursor through trueGate

Cursor doesn't expose a CLI auth flow. Instead:

1. Start trueGate with an authenticated provider (e.g. auto-mode + cliproxy).
2. In Cursor: Settings → Models → Override OpenAI Base URL → `http://localhost:8457/v1`.
3. Add your CLIProxyAPI token in the API key field.

See `truegate ide cursor` for the exact copy-paste settings.

## What gets stored where

| File                        | What's in it                                                        |
| --------------------------- | ------------------------------------------------------------------- |
| `<repo>/.state/config.json` | trueGate's config — provider preset, your saved tokens (chmod 0600) |
| CLIProxyAPI auth dir        | OAuth session tokens for Claude/Codex/Gemini/Grok                   |
| `~/.config/gh/hosts.yml`    | GitHub CLI's stored credentials                                     |

trueGate never touches the OAuth session tokens that CLIProxyAPI manages — it just forwards your `x-api-key` header to CLIProxyAPI, which substitutes the real session token internally.

## Re-authenticating

OAuth sessions expire. When you see:

```
auth_unavailable: no auth available (providers=codex, model=gpt-5.5)
```

Re-run:

```bash
truegate login codex
```

If you have multiple expired credential files in CLIProxyAPI's auth directory, disable the stale ones so CLIProxyAPI doesn't round-robin onto them:

```bash
# in the CLIProxyAPI auth dir (system-wide ~/.cli-proxy-api/ or repo vendor/)
python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
d['disabled'] = True
open(sys.argv[1], 'w').write(json.dumps(d, indent=2))
" codex-old-account@example.com.json
```

Then restart CLIProxyAPI to pick up the change.

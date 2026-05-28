# Authentication & Login

trueGate is a governance proxy, not an auth provider. It forwards your client's credentials to whatever upstream you've configured. For OAuth-based providers (Claude, Codex, Gemini, Grok), trueGate drives **CLIProxyAPI**'s login flow — that's the supported way to obtain a session token. For GitHub Copilot, trueGate uses the `gh` CLI. For Cursor, there's nothing to log into; you configure Cursor's base URL instead.

```
truegate login <provider>
```

## Supported providers

| Provider | Mechanism     | What happens                                                                                       |
| -------- | ------------- | -------------------------------------------------------------------------------------------------- |
| `claude` | CLIProxyAPI   | Runs `cli-proxy-api --claude-login` (opens browser, claude.ai OAuth)                               |
| `codex`  | CLIProxyAPI   | Runs `cli-proxy-api --codex-login` (opens browser, ChatGPT OAuth)                                  |
| `gemini` | CLIProxyAPI   | Runs `cli-proxy-api --gemini-login`                                                                |
| `grok`   | CLIProxyAPI   | Runs `cli-proxy-api --grok-login`                                                                  |
| `github` | `gh` CLI      | Runs `gh auth login --scopes copilot`, then saves the resulting token to `~/.truegate/config.json` |
| `cursor` | not supported | Cursor has no public OAuth API. trueGate prints workaround instructions.                           |

## Why CLIProxyAPI for Claude / Codex / Gemini / Grok?

These providers all use proprietary OAuth flows tied to their consumer products (claude.ai, chatgpt.com, ai.google.dev, x.ai). Each requires:

- A registered OAuth client (Anthropic/OpenAI/Google issue these to specific apps)
- A browser flow with a redirect URL
- Token refresh logic
- Provider-specific session storage

[CLIProxyAPI](https://help.router-for.me) already implements all four. trueGate's job is governance — reinventing OAuth would distract from that. So:

1. Install CLIProxyAPI (one binary, no deps)
2. `truegate login claude` — trueGate shells out to `cli-proxy-api --claude-login` to drive its login
3. trueGate then runs in front of CLIProxyAPI: `truegate serve --provider cliproxy`

## Examples

### Log in to Claude Code

```bash
truegate login claude
# (browser opens, claude.ai OAuth, returns to terminal)

# Then start trueGate against CLIProxyAPI as upstream
truegate serve --provider cliproxy
```

### Log in to GitHub Copilot

```bash
truegate login github
# (browser opens, GitHub OAuth, gh writes its credential)
# trueGate captures `gh auth token` and saves it to ~/.truegate/config.json

# Then start trueGate using your GitHub Copilot subscription
truegate serve --provider github-copilot
```

### Use Cursor through trueGate

Cursor doesn't expose a CLI auth flow. Instead:

1. Make sure trueGate is running with an authenticated provider (e.g. `cliproxy`).
2. In Cursor: Settings → Models → toggle "Override OpenAI Base URL" → set `http://localhost:8457/v1`.
3. Add your token (the same one in `~/.truegate/config.json`).

See `truegate ide cursor` for the exact paste-ready settings.

## What gets stored where

| File                                                                   | What's in it                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `~/.truegate/config.json`                                              | trueGate's own config — provider preset, your saved tokens (chmod 0600) |
| CLIProxyAPI auth dir (`~/.cli-proxy-api/` or wherever it's configured) | OAuth session tokens for Claude/Codex/Gemini/Grok                       |
| `~/.config/gh/hosts.yml` (or platform equivalent)                      | GitHub CLI's stored credentials                                         |

trueGate never inspects or copies the OAuth session tokens that CLIProxyAPI manages — it just forwards your dummy `x-api-key` to CLIProxyAPI, which substitutes the real session token internally.

## Re-authenticating

OAuth sessions expire. When you see something like:

```
auth_unavailable: no auth available (providers=codex, model=gpt-5.2)
```

The session for that specific provider has expired. Re-run:

```bash
truegate login codex
```

This is provider-specific — your Claude session may still be valid even if your Codex one isn't.

## Why not store the OAuth tokens in trueGate itself?

Because:

- Each provider's OAuth flow is non-trivial and changes over time
- Refresh logic is provider-specific
- The official client (CLIProxyAPI or `gh`) is the only thing that's reliably going to keep working through provider-side changes

trueGate stays focused on what it's good at: governance and validation. Auth is delegated to the tools that already do it well.

## Roadmap

A future version may add direct OAuth for one or more providers — but only when there's a compelling reason to take on that maintenance burden. For now, delegating to CLIProxyAPI / `gh` is the right call.

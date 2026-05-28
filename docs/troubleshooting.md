# Troubleshooting

## `truegate status` says proxy DOWN

Start it: `truegate serve` (or `node dist/cli/index.cjs serve` if you're running from source).

If `serve` itself fails with `EADDRINUSE`, something is already on port 8457:

```bash
lsof -ti:8457               # see what's holding it
truegate serve --port 8458  # or pick a different port
```

## `truegate status` says proxy OK (http 404)

That's normal. trueGate doesn't serve a homepage — it only answers the three API routes. A 404 on `GET /` means the server is alive.

## `truegate status` says upstream unreachable

If `provider=cliproxy`: start CLIProxyAPI first (`cli-proxy-api` on port 8317).
If `provider=ollama`: start Ollama (`ollama serve` on port 11434).
If `provider=lmstudio`: enable the local server in LM Studio's UI.
If `provider=openai|anthropic`: check internet connectivity (and any corporate proxy — see "behind an HTTP proxy" below).

## "Anthropic API error 401: invalid x-api-key"

trueGate forwards your client's `x-api-key` header verbatim to the upstream. If upstream is the real Anthropic API, that header must be a real `sk-ant-...` key. If upstream is CLIProxyAPI, it must be a valid CLIProxyAPI access token.

Quick sanity check:

```bash
# Hit the upstream directly with your key to confirm IT works in isolation
curl http://127.0.0.1:8317/v1/messages \
  -H 'x-api-key: YOUR_TOKEN' -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
```

If THIS fails the same way, the problem is upstream-side, not trueGate.

## "Provider API error 503: auth_unavailable: no auth available (providers=codex)"

You're going through CLIProxyAPI and its OAuth session for that provider expired. Re-login on CLIProxyAPI:

```bash
cli-proxy-api --codex-login     # or --claude-login, --gemini-login, etc.
```

## "Provider API error 401: Missing API key"

trueGate isn't forwarding the auth header to upstream. Confirm:

- The IDE/SDK is actually setting `Authorization: Bearer …` or `x-api-key: …`
- Your config has `upstreamApiKey` set (`truegate setup` will prompt for it)
- If using a raw `curl` test, include the header explicitly

## "unknown provider for model X"

Your upstream (usually CLIProxyAPI) doesn't recognize that model ID. List supported models:

```bash
curl http://127.0.0.1:8317/v1/models -H 'x-api-key: YOUR_TOKEN' | jq '.data[].id'
```

Use one of those names exactly. Common gotcha: `claude-sonnet-4-5` is NOT the same as `claude-sonnet-4-5-20250929` — CLIProxyAPI wants the dated form.

## Governance isn't being injected

```bash
truegate inspect
```

This shows EXACTLY what was loaded. If your governance file is missing from the list:

- Did you `truegate init` in this directory?
- Are you running `truegate serve` from the project root (or did you set `--project-root`)?
- For an existing repo's `CLAUDE.md` / `AGENTS.md` — is it at the project root, not nested?

trueGate caches governance for 5 seconds. After editing a file, wait up to 5 seconds before retrying.

## Block isn't firing for content I expect to be dangerous

The validators are regex-based. To debug:

```bash
echo 'DROP TABLE foo' | truegate validate    # confirm the rule triggers
```

If `validate` blocks but live requests don't, the LLM's response doesn't contain the literal pattern (e.g. the model wrote `Drop table foo;` and your rule is case-sensitive). Loosen the pattern in `.truegate/rules.yaml` or rely on the built-in case-insensitive ones.

## Claude Code → trueGate flow but no governance gets included

Check that Claude Code is talking to trueGate at all:

```bash
truegate serve --log-level debug     # then run claude in another shell
```

Watch the trueGate log for `incoming request` lines on `/v1/messages`. If you don't see any, Claude Code isn't using `ANTHROPIC_BASE_URL` — re-export it in the same shell session as `claude`.

## Behind a corporate HTTP proxy

trueGate uses `undici` for outbound requests. undici does **not** read `HTTP_PROXY` / `HTTPS_PROXY` env vars automatically. Today, route trueGate at a local proxy you control (e.g. CLIProxyAPI) and have THAT process honor your corporate proxy. A first-class `--http-proxy` flag is on the roadmap.

## `--strip-client-system` had no visible effect

The flag works, but it only strips what's in the request body. If your upstream uses an **OAuth session** (e.g. CLIProxyAPI's `--claude-login`), the provider applies its own system prompt **server-side** based on the session identity. No client-side flag can strip a server-side prompt.

To verify whether your situation is affected:

```bash
# Make a request with strip off — note input_tokens
truegate serve &
curl -sS http://localhost:8457/v1/messages -H 'x-api-key: …' -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"…","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}' | jq '.usage.input_tokens'

# Stop, restart with strip on, repeat
truegate serve --strip-client-system &
# … same curl
```

- If `input_tokens` drops dramatically → the prompt was in the request body. Strip worked.
- If `input_tokens` stays the same → the prompt is server-side (OAuth session). Strip is a no-op for your upstream.

**Workaround**: use a direct `sk-ant-…` API key (not an OAuth session) if you want full control over the system prompt.

## Dangerous shell commands inside tool calls aren't being blocked

trueGate's response validator scans **both** text blocks AND `tool_use.input` / `function_call.arguments`. If a tool call with `rm -rf /` reaches your client, something specific is wrong:

1. Confirm the model is actually emitting it: check trueGate's debug log (`truegate serve --log-level debug`) for the raw response shape.
2. Confirm your rules cover the case. Built-ins catch `rm -rf /`, `curl … | sh`, `DROP TABLE`, `sk-…` key patterns. Custom patterns in `.truegate/rules.yaml > dangerousPatterns` are case-insensitive by default.
3. Some block patterns are anchored to specific roots. `rm -rf ./build` won't trigger the built-in (which targets root/home destruction). Add a custom pattern if your project needs broader coverage.

## My API token leaked into a snippet

`truegate ide <name>` reads tokens from `~/.truegate/config.json` only — never from env vars — for exactly this reason. If you see a token you don't expect, run `truegate setup` and overwrite it.

## `port 3457 already in use` on Linux

Old behavior used port 3457 — Nimbalyst happens to use that same port for its session-naming MCP. trueGate now defaults to **8457**. If you have older docs lying around, ignore the 3457 references.

## Reset everything

```bash
rm -f ~/.truegate/config.json    # wipe saved config
rm -rf .truegate/                # wipe project governance
truegate setup                   # start over
```

## Reporting a bug

Include the output of:

```bash
truegate --version
truegate status
truegate inspect
node --version
uname -a
```

Plus the failing request's `curl` reproduction (with the token redacted).

# Troubleshooting

## `truegate status` says proxy DOWN

Start it: `truegate serve` (or `node dist/cli/index.cjs serve` from the repo).

If `serve` itself fails with `EADDRINUSE`, something is already on port 8457:

```bash
lsof -ti:8457               # see what's holding it
truegate serve --port 8458  # pick a different port
```

## `truegate status` says proxy OK (http 404)

Normal. trueGate only answers the three API routes — it has no homepage. A 404 on `GET /` means the server is alive.

## `truegate status` shows an upstream as unreachable

- `cliproxy`: CLIProxyAPI is not running. Start it on port 8317.
- `ollama`: run `ollama serve`.
- `lmstudio`: enable the local server inside LM Studio's UI.
- `openai` / `anthropic`: check internet connectivity.

Auto-mode will route around unreachable upstreams. To see what's usable run `truegate status`.

## "auth_unavailable: no auth available (providers=codex)"

CLIProxyAPI's OAuth session for that provider expired. Re-login:

```bash
truegate login codex    # opens browser OAuth
```

If you have multiple credential files in `.state/cli-proxy-api/` (or the system-wide `~/.cli-proxy-api/`), disable stale ones rather than leaving them for CLIProxyAPI to round-robin:

```bash
# Set disabled: true in the old file
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); d['disabled']=True; open(sys.argv[1],'w').write(json.dumps(d))" ~/.cli-proxy-api/codex-old@example.com.json
```

## "Provider API error 401: invalid x-api-key"

trueGate forwards the client's `Authorization` / `x-api-key` header verbatim to upstream. If upstream is real Anthropic, the header must be `sk-ant-…`. If upstream is CLIProxyAPI, it must be a valid CLIProxyAPI access token.

Isolate the problem by hitting the upstream directly:

```bash
curl http://127.0.0.1:8317/v1/messages \
  -H 'x-api-key: YOUR_TOKEN' -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
```

If this fails the same way, the issue is upstream-side, not trueGate.

## "fetch failed" on a request to Ollama

Usually a cold-start timeout. Ollama may take 30–120 seconds to load a large model into VRAM on the first request. Subsequent calls are fast. Retry after the model finishes loading.

## Request routed to the wrong upstream

Check routing with `truegate status` — it prints the full registry with which models each upstream claims. For a live request, the `x-truegate-upstream: provider/model` response header tells you exactly where it went.

To force a specific upstream regardless of model name:

```bash
truegate serve --provider cliproxy   # all requests go to cliproxy
```

## Governance isn't being injected

```bash
truegate inspect
```

Shows exactly what was loaded. If the governance source is missing:

- Does `data/governance.md` exist? (`ls data/`)
- Is there a `.state/governance.md` that might be overriding it with empty content?
- trueGate caches governance for 5 seconds — wait a moment after editing.

## Block isn't firing for content I expect to be dangerous

```bash
echo 'DROP TABLE foo' | truegate validate    # confirm the rule triggers
```

If `validate` blocks but live requests don't:

- The LLM's response may not contain the exact pattern (e.g. `Drop table foo;` vs a case-sensitive rule). Check `data/rules.yaml` — built-in patterns are case-insensitive.
- Add a custom pattern to `.state/rules.yaml`.

## Response is double-wrapped (JSON inside tool_args.text)

The upstream model produced plain prose instead of an agent-zero envelope on that turn. trueGate wrapped it to prevent a parse crash. This is a model-side failure, not a trueGate bug — it happens when large-context requests cause the model to drift away from the JSON contract.

Mitigations:

- Use the Claude preset (more reliable envelope adherence than smaller models).
- Reset the chat or trim old context to reduce prompt size.
- This is rare (one event per thousands of turns in practice).

## "Blocked: the model tried to call 'input:', tool not advertised"

Fixed in current build — the tool-name allowlist parser now handles the `### input:` header format agent-zero uses. If you're on an older build, update and restart.

## `--strip-client-system` had no visible effect

The flag strips what's in the request body. If your upstream uses an OAuth session (e.g. CLIProxyAPI's `--claude-login`), the provider applies its own system prompt **server-side** based on the session identity. No client-side flag can strip a server-side prompt.

To verify: compare `input_tokens` in the response `usage` field with and without the flag. If it drops, strip worked. If it stays the same, the prompt is server-side.

## Config file not being read

trueGate reads config from `<repo>/.state/config.json`. Make sure you're running `truegate serve` with the repo as the working directory (or from within it). The repo root is located by walking up from the binary looking for `package.json {"name":"truegate"}`.

## Reset everything

```bash
rm -f .state/config.json     # wipe saved config
rm -f .state/governance.md   # remove governance override (reverts to data/)
rm -f .state/rules.yaml      # remove rules override
truegate setup               # start over
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

Plus the failing `curl` reproduction (with the token redacted).

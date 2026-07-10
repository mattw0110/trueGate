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

If the client runs in Docker, use `http://host.docker.internal:11434`, not `http://localhost:11434`, unless Ollama is inside the same container.

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

## Agent0 appears stuck after saying it will check again

If Agent0 can reach trueGate but Claude keeps ending turns with text like "I need to check..." or "I'll poll again", inspect trueGate logs for `PLAN-OF-RECORD`. That means the model returned a terminal `response` envelope instead of the next tool call. trueGate reinforces the loop contract, but the practical recovery is to re-prompt with "execute the next check now" or reset the Agent0 chat if the context is very large.

Also check for stale shell sessions inside the container:

```bash
docker exec agent0 ps -ef
```

Many idle `/bin/bash` or `tail -f` processes usually indicate accumulated Agent0 tool sessions, not a trueGate connectivity problem.

## Agent0 cannot reach trueGate

Inside Docker, `localhost` is the Agent0 container. Configure Agent0 with:

```text
http://host.docker.internal:8457/v1
```

and make sure the compose service has:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

Run this from the host to test the path from inside Agent0:

```bash
docker exec agent0 python3 -c "import json, os, urllib.request; payload={'model':'claude-sonnet-4-6','messages':[{'role':'user','content':'Reply with exactly: ok'}],'max_tokens':10}; req=urllib.request.Request('http://host.docker.internal:8457/v1/chat/completions', data=json.dumps(payload).encode(), headers={'Content-Type':'application/json','Authorization':'Bearer '+os.environ.get('CLI_PROXY_API_KEY','')}); r=urllib.request.urlopen(req, timeout=30); print(r.status, json.loads(r.read())['choices'][0]['message']['content'])"
```

Expected output includes `— trueGate · cliproxy/claude-sonnet-4-6`.

## Agent0 logs show `Command 'serena' not found` or `Command 'sentrux' not found`

That is an Agent0 MCP configuration issue, not a trueGate issue. Disable MCP entries whose commands are not installed inside the Agent0 container, or install/mount those commands into the image. Keeping broken MCP entries enabled slows startup and hides real failures in noisy logs.

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

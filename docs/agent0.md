# Agent Zero / Agent0

Agent0 can use trueGate as an OpenAI-compatible upstream. This keeps Agent0 behind the same governance layer as Claude Code, Cursor, Codex, and SDK clients.

## Recommended Shape

Run trueGate on the host:

```bash
truegate serve
```

From an Agent0 Docker container, use:

```text
http://host.docker.internal:8457/v1
```

Use `localhost` only when Agent0 and trueGate run in the same process namespace. In Docker, `localhost` points back at the Agent0 container, not the host.

## Model Config

Set Agent0 chat and utility models to trueGate's OpenAI-compatible route:

```json
{
  "allow_chat_override": true,
  "chat_model": {
    "provider": "openai",
    "name": "claude-sonnet-4-6",
    "api_base": "http://host.docker.internal:8457/v1",
    "ctx_length": 200000,
    "ctx_history": 0.7,
    "vision": true,
    "max_embeds": 10,
    "rl_requests": 0,
    "rl_input": 0,
    "rl_output": 0,
    "kwargs": {
      "max_tokens": 32000,
      "temperature": 1
    }
  },
  "utility_model": {
    "provider": "openai",
    "name": "claude-sonnet-4-6",
    "api_base": "http://host.docker.internal:8457/v1",
    "ctx_length": 200000,
    "ctx_input": 0.7,
    "rl_requests": 0,
    "rl_input": 0,
    "rl_output": 0,
    "kwargs": {
      "max_tokens": 16000,
      "temperature": 1
    }
  },
  "embedding_model": {
    "provider": "ollama",
    "name": "qwen3-embedding:8b",
    "api_base": "http://host.docker.internal:11434",
    "rl_requests": 0,
    "rl_input": 0,
    "kwargs": {
      "truncate": true,
      "options": {
        "num_ctx": 8192
      }
    }
  }
}
```

The embedding model is optional. Keeping embeddings on local Ollama is a good default when the model is GPU-backed.

## Container Environment

Pass through the token trueGate or its selected upstream expects:

```yaml
services:
  agent0:
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      - CLI_PROXY_API_KEY=${CLI_PROXY_API_KEY}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
```

If trueGate is using CLIProxyAPI, Agent0 usually needs the CLIProxyAPI token. If trueGate is using direct Anthropic/OpenAI, pass that provider key instead.

## Smoke Test From Inside Agent0

```bash
docker exec agent0 python3 -c "import json, os, urllib.request; payload={'model':'claude-sonnet-4-6','messages':[{'role':'user','content':'Reply with exactly: ok'}],'max_tokens':10,'temperature':0}; req=urllib.request.Request('http://host.docker.internal:8457/v1/chat/completions', data=json.dumps(payload).encode(), headers={'Content-Type':'application/json','Authorization':'Bearer '+os.environ.get('CLI_PROXY_API_KEY','')}); r=urllib.request.urlopen(req, timeout=30); print(r.status, json.loads(r.read())['choices'][0]['message']['content'])"
```

Expected content includes:

```text
ok

— trueGate · cliproxy/claude-sonnet-4-6
```

That marker proves the request passed through trueGate and identifies the upstream.

## MCP Notes

Keep Agent0 MCPs limited to commands that exist inside the container. A global MCP entry like:

```json
{ "command": "serena" }
```

will fail on boot if `serena` is not installed in the image. Disable broken MCP entries instead of leaving them to fail every startup.

Project-scoped MCP configs are separate from global Agent0 MCPs. Use project-scoped MCPs for project-specific servers such as Supabase.

## Local Model Fallback

Agent0 can keep local presets for offline or low-cost work. For serious agentic coding, trueGate plus Claude is usually the more reliable default. For local fallback, prefer smaller warmed models before large cold-loaded models:

- `qwen2.5-coder:14b` or `codegeex4:9b` for faster local coding turns.
- `qwen3-coder:30b` when quality matters more than latency.
- `qwen3-embedding:8b` for local embeddings when Ollama reports `100% GPU`.

Use:

```bash
ollama ps
```

to confirm whether a local model is loaded and GPU-backed.

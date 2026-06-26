# IDE Setup

Point any AI tool at trueGate (`http://localhost:8457`) and governance is enforced transparently. Each recipe below is "set the env var or paste the URL — done."

> All examples assume trueGate is already running. See [quickstart.md](./quickstart.md) for that.

If the tool runs inside Docker, `localhost` means the container. Use `http://host.docker.internal:8457` or `http://host.docker.internal:8457/v1` from inside containers.

---

## Claude Code

Claude Code talks to the Anthropic Messages API (`/v1/messages`). Point its base URL at trueGate:

```bash
ANTHROPIC_BASE_URL=http://localhost:8457 \
ANTHROPIC_AUTH_TOKEN=your-token-here \
ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-4-5-20251001 \
ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-6 \
ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-7 \
claude
```

If you're using CLIProxyAPI behind trueGate, `ANTHROPIC_AUTH_TOKEN` is the CLIProxyAPI access token. If you're hitting Anthropic directly, it's your real `sk-ant-...` key.

To make this permanent, put the env vars in `~/.zshrc` / `~/.bashrc`:

```bash
export ANTHROPIC_BASE_URL=http://localhost:8457
export ANTHROPIC_AUTH_TOKEN=your-token-here
```

Every subsequent `claude` invocation goes through trueGate automatically.

---

## OpenAI Codex CLI

Codex uses the Responses API (`/v1/responses`):

```bash
OPENAI_BASE_URL=http://localhost:8457/v1 \
OPENAI_API_KEY=your-token-here \
codex
```

trueGate handles both `/v1/chat/completions` (older Codex) and `/v1/responses` (current Codex) automatically.

---

## Agent Zero / Agent0

Agent0 works best through trueGate's OpenAI-compatible route. In Docker, point it at the host trueGate instance:

```json
{
  "chat_model": {
    "provider": "openai",
    "name": "claude-sonnet-4-6",
    "api_base": "http://host.docker.internal:8457/v1",
    "ctx_length": 200000,
    "ctx_history": 0.7,
    "vision": true,
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
    "kwargs": {
      "max_tokens": 16000,
      "temperature": 1
    }
  }
}
```

Set `CLI_PROXY_API_KEY` or the token your upstream expects in the Agent0 container environment. Keep embeddings local if Ollama is available:

```json
{
  "embedding_model": {
    "provider": "ollama",
    "name": "qwen3-embedding:8b",
    "api_base": "http://host.docker.internal:11434"
  }
}
```

Full Agent0 notes: [agent0.md](./agent0.md)

---

## Cursor

Cursor accepts an OpenAI-compatible base URL override.

1. Open **Cursor Settings** → **Models**
2. Toggle **"Override OpenAI Base URL"**
3. Set base URL to: `http://localhost:8457/v1`
4. Paste your API key (or any dummy string if your upstream is local Ollama / LM Studio)
5. Add the models you want to use in the model list

All Cursor chat/edit/composer requests will now route through trueGate.

> **Note**: Cursor's Cmd-K tab-completion uses a separate proprietary endpoint — those won't go through trueGate. The chat panel and Composer do.

---

## Continue.dev (VS Code / JetBrains)

In your `~/.continue/config.json`:

```json
{
  "models": [
    {
      "title": "Claude via trueGate",
      "provider": "anthropic",
      "model": "claude-sonnet-4-6",
      "apiBase": "http://localhost:8457",
      "apiKey": "your-token-here"
    },
    {
      "title": "OpenAI via trueGate",
      "provider": "openai",
      "model": "gpt-4o",
      "apiBase": "http://localhost:8457/v1",
      "apiKey": "your-token-here"
    }
  ]
}
```

---

## Zed

Zed's AI panel supports custom OpenAI-compatible providers. In your `settings.json`:

```json
{
  "language_models": {
    "openai": {
      "api_url": "http://localhost:8457/v1",
      "available_models": [{ "name": "gpt-4o", "max_tokens": 128000 }]
    },
    "anthropic": {
      "api_url": "http://localhost:8457",
      "available_models": [{ "name": "claude-sonnet-4-6", "max_tokens": 200000 }]
    }
  }
}
```

Set your API key in Zed's standard settings.

---

## Cody (Sourcegraph)

Cody's enterprise/custom provider:

1. Settings → Sourcegraph → Endpoint
2. Use `http://localhost:8457` as the API endpoint
3. Provide your auth token

---

## GitHub Copilot

Copilot does **not** support a configurable endpoint — it always calls GitHub's own API. trueGate cannot intercept Copilot's inline completions.

What you *can* do:

- Use trueGate as the **upstream for Copilot Chat replacements** via Continue.dev or Cody
- Use trueGate's `github-copilot` provider preset to route OTHER tools (e.g. Codex CLI, your own SDK) through your Copilot subscription:

```bash
TRUEGATE_PROVIDER=github-copilot \
GITHUB_TOKEN=$(gh auth token) \
truegate serve
```

Then point an OpenAI-shaped tool at `http://localhost:8457/v1`.

---

## Raw SDKs

### OpenAI Python SDK

```python
from openai import OpenAI
client = OpenAI(
    base_url="http://localhost:8457/v1",
    api_key="your-token-here",  # forwarded verbatim
)
resp = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "hi"}],
)
```

### OpenAI Node.js SDK

```js
import OpenAI from 'openai';
const client = new OpenAI({
  baseURL: 'http://localhost:8457/v1',
  apiKey: 'your-token-here',
});
```

### Anthropic Python SDK

```python
from anthropic import Anthropic
client = Anthropic(
    base_url="http://localhost:8457",
    api_key="your-token-here",
)
resp = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    messages=[{"role": "user", "content": "hi"}],
)
```

### Anthropic Node.js SDK

```js
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({
  baseURL: 'http://localhost:8457',
  apiKey: 'your-token-here',
});
```

### LangChain (Python)

```python
from langchain_openai import ChatOpenAI
llm = ChatOpenAI(
    base_url="http://localhost:8457/v1",
    api_key="your-token-here",
    model="gpt-4o",
)
```

---

## Browser / web app

Run trueGate with permissive CORS (planned — see [#cors](#cors-future) below) and use it from a browser fetch. For now, you must call from server-side code.

---

## Using trueGate across all your work

trueGate is installed **once** and runs continuously as your personal governance layer. A single instance on port 8457 covers every IDE, every project, every AI tool on your machine. There is no per-project setup — governance lives in trueGate's own `data/` and `.state/` directories, not in your repos.

Point all your IDEs at the same address:

```
http://localhost:8457/v1
```

If you want to run trueGate on a non-standard port (e.g. to avoid a conflict):

```bash
truegate serve --port 8458
```

Then point your IDEs at `http://localhost:8458/v1` instead.

---

## CORS (future)

A `TRUEGATE_CORS=*` env var will be added so browser apps can call trueGate directly. Today, call from server-side only.

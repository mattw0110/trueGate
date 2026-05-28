import { readUserConfig, resolveConfig } from '../../config/user-config.js';

const SUPPORTED = [
  'claude-code',
  'codex',
  'cursor',
  'continue',
  'zed',
  'openai-sdk',
  'anthropic-sdk',
] as const;
type IdeKey = (typeof SUPPORTED)[number];

export async function runIde(name: string | undefined): Promise<void> {
  if (!name || !SUPPORTED.includes(name as IdeKey)) {
    console.log('Usage: truegate ide <name>');
    console.log('Supported names:');
    SUPPORTED.forEach((s) => console.log(`  - ${s}`));
    if (name) process.exit(1);
    return;
  }

  // Use the saved user config only — do not leak unrelated env tokens
  // (e.g. printing GITHUB_TOKEN in a Claude Code snippet).
  const userConfig = await readUserConfig();
  const config = resolveConfig(userConfig);
  const port = config.port;
  const base = `http://localhost:${port}`;

  // Pick the token that matches the configured provider, from user-config only.
  let token: string;
  switch (userConfig.provider) {
    case 'anthropic':
      token = userConfig.anthropicApiKey ?? 'your-anthropic-key-here';
      break;
    case 'openai':
      token = userConfig.openAiApiKey ?? 'your-openai-key-here';
      break;
    case 'github-copilot':
      token = userConfig.githubToken ?? 'your-github-token-here';
      break;
    case 'cliproxy':
    case 'custom':
      token = userConfig.upstreamApiKey ?? 'your-token-here';
      break;
    case 'ollama':
    case 'lmstudio':
      token = 'ollama'; // any non-empty string; local providers ignore it
      break;
    default:
      token = userConfig.upstreamApiKey ?? userConfig.openAiApiKey ?? 'your-token-here';
  }

  const ide = name as IdeKey;

  console.log(`━━━ trueGate IDE setup: ${ide} ━━━`);
  console.log();

  switch (ide) {
    case 'claude-code':
      console.log('Run Claude Code with these env vars (or export them in your shell):');
      console.log();
      console.log(`  ANTHROPIC_BASE_URL=${base} \\`);
      console.log(`  ANTHROPIC_AUTH_TOKEN=${token} \\`);
      console.log('  ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-4-5-20251001 \\');
      console.log('  ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-6 \\');
      console.log('  ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-7 \\');
      console.log('  claude');
      break;

    case 'codex':
      console.log('Run Codex CLI / OpenAI CLI:');
      console.log();
      console.log(`  OPENAI_BASE_URL=${base}/v1 \\`);
      console.log(`  OPENAI_API_KEY=${token} \\`);
      console.log('  codex');
      break;

    case 'cursor':
      console.log('Cursor → Settings → Models → "Override OpenAI Base URL":');
      console.log();
      console.log(`  Base URL: ${base}/v1`);
      console.log(`  API Key:  ${token}`);
      console.log();
      console.log('Then add the model(s) you want to use in the model list.');
      break;

    case 'continue':
      console.log('Add to ~/.continue/config.json:');
      console.log();
      console.log(
        JSON.stringify(
          {
            models: [
              {
                title: 'Claude via trueGate',
                provider: 'anthropic',
                model: 'claude-sonnet-4-6',
                apiBase: base,
                apiKey: token,
              },
              {
                title: 'OpenAI via trueGate',
                provider: 'openai',
                model: 'gpt-4o',
                apiBase: `${base}/v1`,
                apiKey: token,
              },
            ],
          },
          null,
          2,
        ),
      );
      break;

    case 'zed':
      console.log('Add to Zed settings.json:');
      console.log();
      console.log(
        JSON.stringify(
          {
            language_models: {
              openai: { api_url: `${base}/v1` },
              anthropic: { api_url: base },
            },
          },
          null,
          2,
        ),
      );
      console.log();
      console.log(`Then set Zed's standard API key field to: ${token}`);
      break;

    case 'openai-sdk':
      console.log('Python:');
      console.log();
      console.log('  from openai import OpenAI');
      console.log(`  client = OpenAI(base_url="${base}/v1", api_key="${token}")`);
      console.log();
      console.log('Node.js:');
      console.log();
      console.log("  import OpenAI from 'openai';");
      console.log(`  const client = new OpenAI({ baseURL: '${base}/v1', apiKey: '${token}' });`);
      break;

    case 'anthropic-sdk':
      console.log('Python:');
      console.log();
      console.log('  from anthropic import Anthropic');
      console.log(`  client = Anthropic(base_url="${base}", api_key="${token}")`);
      console.log();
      console.log('Node.js:');
      console.log();
      console.log("  import Anthropic from '@anthropic-ai/sdk';");
      console.log(`  const client = new Anthropic({ baseURL: '${base}', apiKey: '${token}' });`);
      break;
  }

  console.log();
}

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  readUserConfig,
  writeUserConfig,
  userConfigPath,
  type UserConfig,
} from '../../config/user-config.js';
import { PROVIDER_BASE_URLS, DEFAULT_PORT } from '../../config/constants.js';
import type { ProviderName } from '../../types/runtime.js';

interface ProviderOption {
  key: ProviderName;
  label: string;
  needs: 'none' | 'openai' | 'anthropic' | 'github' | 'token' | 'url+token?';
  hint: string;
}

const PROVIDERS: ProviderOption[] = [
  {
    key: 'cliproxy',
    label: 'CLIProxyAPI (multi-provider OAuth router on :8317)',
    needs: 'token',
    hint: 'Token = your CLIProxyAPI access token',
  },
  {
    key: 'anthropic',
    label: 'Anthropic / Claude direct',
    needs: 'anthropic',
    hint: 'Your sk-ant-... key from console.anthropic.com',
  },
  {
    key: 'openai',
    label: 'OpenAI direct',
    needs: 'openai',
    hint: 'Your sk-... key from platform.openai.com',
  },
  {
    key: 'ollama',
    label: 'Ollama (local, no key)',
    needs: 'none',
    hint: 'Make sure `ollama serve` is running',
  },
  {
    key: 'lmstudio',
    label: 'LM Studio (local, no key)',
    needs: 'none',
    hint: 'Enable the local server in LM Studio first',
  },
  {
    key: 'github-copilot',
    label: 'GitHub Copilot',
    needs: 'github',
    hint: 'Use `gh auth token` to grab a token',
  },
  {
    key: 'custom',
    label: 'Any OpenAI-compatible endpoint (Groq, Azure, …)',
    needs: 'url+token?',
    hint: 'Provide the base URL + (optional) API key',
  },
];

export async function runSetup(): Promise<void> {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' trueGate — interactive setup');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Saves to ~/.truegate/config.json (file is chmod 0600).');
  console.log();

  const existing = await readUserConfig();
  if (Object.keys(existing).length > 0) {
    console.log('An existing config was found. Press <Enter> to keep current values.');
    console.log(`  current provider: ${existing.provider ?? '(unset)'}`);
    console.log();
  }

  const rl = createInterface({ input, output });
  try {
    // 1. provider
    console.log('Which provider should trueGate forward requests to?');
    PROVIDERS.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.label}`);
    });
    console.log();
    const defaultIdx =
      PROVIDERS.findIndex((p) => p.key === existing.provider) === -1
        ? 1
        : PROVIDERS.findIndex((p) => p.key === existing.provider) + 1;
    const pickRaw = (await rl.question(`Pick 1-${PROVIDERS.length} [${defaultIdx}]: `)).trim();
    const pick = pickRaw ? parseInt(pickRaw, 10) : defaultIdx;
    const selected = PROVIDERS[pick - 1];
    if (!selected) {
      console.error('Invalid selection.');
      process.exit(1);
    }

    const next: UserConfig = { ...existing, provider: selected.key };

    console.log();
    console.log(`Selected: ${selected.label}`);
    console.log(`Hint: ${selected.hint}`);
    console.log();

    // 2. credentials per provider
    const promptSecret = async (
      label: string,
      current: string | undefined,
    ): Promise<string | undefined> => {
      const masked = current ? ` (current: ${maskToken(current)})` : '';
      const v = (await rl.question(`${label}${masked}: `)).trim();
      return v === '' ? current : v;
    };

    switch (selected.needs) {
      case 'openai':
        next.openAiApiKey = await promptSecret('OpenAI API key', existing.openAiApiKey);
        break;
      case 'anthropic':
        next.anthropicApiKey = await promptSecret('Anthropic API key', existing.anthropicApiKey);
        break;
      case 'github':
        next.githubToken = await promptSecret('GitHub token', existing.githubToken);
        break;
      case 'token':
        next.upstreamApiKey = await promptSecret('CLIProxyAPI token', existing.upstreamApiKey);
        break;
      case 'url+token?': {
        const defaultUrl = existing.upstreamUrl ?? '';
        const urlAns = (
          await rl.question(`Upstream base URL${defaultUrl ? ` [${defaultUrl}]` : ''}: `)
        ).trim();
        next.upstreamUrl = urlAns || defaultUrl || undefined;
        if (!next.upstreamUrl) {
          console.error('A base URL is required for the custom provider.');
          process.exit(1);
        }
        next.upstreamApiKey = await promptSecret(
          'API key (leave blank if none)',
          existing.upstreamApiKey,
        );
        break;
      }
      case 'none':
        // nothing to ask
        break;
    }

    // 3. optional advanced
    console.log();
    console.log('Advanced (press <Enter> to skip):');
    const portAns = (await rl.question(`  Port [${existing.port ?? DEFAULT_PORT}]: `)).trim();
    if (portAns) next.port = parseInt(portAns, 10);

    const upstreamOverride =
      selected.needs === 'url+token?'
        ? ''
        : (
            await rl.question(
              `  Override upstream URL (default: ${selected.key === 'custom' ? '(required)' : PROVIDER_BASE_URLS[selected.key]}) [${existing.upstreamUrl ?? ''}]: `,
            )
          ).trim();
    if (upstreamOverride) next.upstreamUrl = upstreamOverride;

    const path = await writeUserConfig(next);
    console.log();
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Config saved → ${path}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log();
    console.log('Start trueGate:');
    console.log('  truegate serve');
    console.log();
    console.log('Point an IDE at it:');
    console.log('  truegate ide claude-code      # Claude Code env vars');
    console.log('  truegate ide cursor           # Cursor settings');
    console.log('  truegate ide codex            # Codex / OpenAI CLI');
    console.log('  truegate ide continue         # Continue.dev config');
    console.log();
  } finally {
    rl.close();
  }
}

function maskToken(t: string): string {
  if (t.length <= 8) return '••••';
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

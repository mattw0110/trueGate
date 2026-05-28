import { readUserConfig, resolveConfig, type ConfigOverrides } from '../../config/user-config.js';
import { buildServer } from '../../proxy/server.js';
import type { ProviderName } from '../../types/runtime.js';

export interface ServeFlags {
  provider?: string;
  port?: string;
  logLevel?: string;
  projectRoot?: string;
  upstreamUrl?: string;
  token?: string;
  openaiKey?: string;
  anthropicKey?: string;
  githubToken?: string;
  stripClientSystem?: boolean;
  responseMarker?: string | false;
}

const VALID: ProviderName[] = [
  'openai',
  'anthropic',
  'ollama',
  'lmstudio',
  'github-copilot',
  'cliproxy',
  'custom',
];

function parseProvider(raw: string | undefined): ProviderName | undefined {
  if (raw === undefined) return undefined;
  if ((VALID as string[]).includes(raw)) return raw as ProviderName;
  throw new Error(`Unknown --provider: ${raw}. Valid: ${VALID.join(', ')}`);
}

export async function runServe(flags: ServeFlags): Promise<void> {
  const overrides: ConfigOverrides = {};
  const provider = parseProvider(flags.provider);
  if (provider) overrides.provider = provider;
  if (flags.port) overrides.port = parseInt(flags.port, 10);
  if (flags.logLevel) overrides.logLevel = flags.logLevel;
  if (flags.projectRoot) overrides.projectRoot = flags.projectRoot;
  if (flags.upstreamUrl) overrides.upstreamUrl = flags.upstreamUrl;
  if (flags.openaiKey) overrides.openAiApiKey = flags.openaiKey;
  if (flags.anthropicKey) overrides.anthropicApiKey = flags.anthropicKey;
  if (flags.githubToken) overrides.githubToken = flags.githubToken;
  if (flags.stripClientSystem !== undefined) overrides.stripClientSystem = flags.stripClientSystem;
  // Commander gives `false` when --no-response-marker is passed
  if (flags.responseMarker === false) overrides.responseMarker = '';
  else if (typeof flags.responseMarker === 'string')
    overrides.responseMarker = flags.responseMarker;
  // --token is a generic "use this for whichever provider is active"
  if (flags.token) {
    overrides.upstreamApiKey = flags.token;
    if (overrides.provider === 'openai' || provider === 'openai') {
      overrides.openAiApiKey = flags.token;
    } else if (overrides.provider === 'anthropic' || provider === 'anthropic') {
      overrides.anthropicApiKey = flags.token;
    } else if (overrides.provider === 'github-copilot' || provider === 'github-copilot') {
      overrides.githubToken = flags.token;
    }
  }

  const userConfig = await readUserConfig();
  const config = resolveConfig(userConfig, overrides);

  const server = buildServer(config);

  try {
    await server.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`trueGate proxy listening on http://localhost:${config.port}`);
    console.log(`  → provider: ${config.provider}`);
    console.log(`  → project root: ${config.projectRoot}`);
    if (config.upstreamUrl) console.log(`  → upstream URL: ${config.upstreamUrl}`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

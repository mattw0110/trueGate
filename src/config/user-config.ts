import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import type { ProviderName, TrueGateConfig } from '../types/runtime.js';
import { DEFAULT_LOG_LEVEL, DEFAULT_PORT } from './constants.js';

const PROVIDER_NAMES: [ProviderName, ...ProviderName[]] = [
  'openai',
  'anthropic',
  'ollama',
  'lmstudio',
  'github-copilot',
  'cliproxy',
  'custom',
];

export const UserConfigSchema = z
  .object({
    provider: z.enum(PROVIDER_NAMES).optional(),
    port: z.number().int().positive().optional(),
    logLevel: z.string().optional(),
    projectRoot: z.string().optional(),
    openAiApiKey: z.string().optional(),
    anthropicApiKey: z.string().optional(),
    githubToken: z.string().optional(),
    upstreamUrl: z.string().optional(),
    upstreamApiKey: z.string().optional(),
    stripClientSystem: z.boolean().optional(),
    responseMarker: z.string().optional(),
  })
  .partial();

export type UserConfig = z.infer<typeof UserConfigSchema>;

export function userConfigPath(): string {
  return join(homedir(), '.truegate', 'config.json');
}

export async function readUserConfig(): Promise<UserConfig> {
  try {
    const raw = await readFile(userConfigPath(), 'utf-8');
    const parsed = UserConfigSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return {};
    return parsed.data;
  } catch {
    return {};
  }
}

export async function writeUserConfig(config: UserConfig): Promise<string> {
  const path = userConfigPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  // Best-effort lock down — file contains tokens.
  try {
    await chmod(path, 0o600);
  } catch {
    /* ignore on Windows */
  }
  return path;
}

export interface ConfigOverrides {
  provider?: ProviderName;
  port?: number;
  logLevel?: string;
  projectRoot?: string;
  openAiApiKey?: string;
  anthropicApiKey?: string;
  githubToken?: string;
  upstreamUrl?: string;
  upstreamApiKey?: string;
  stripClientSystem?: boolean;
  responseMarker?: string;
}

/**
 * Resolve the effective config by layering, lowest priority first:
 *   defaults < user-config file < env vars < CLI overrides
 */
export function resolveConfig(
  userConfig: UserConfig,
  overrides: ConfigOverrides = {},
): TrueGateConfig {
  const env = process.env;

  const provider =
    overrides.provider ??
    (env['TRUEGATE_PROVIDER'] as ProviderName | undefined) ??
    userConfig.provider ??
    'openai';

  const port =
    overrides.port ??
    (env['TRUEGATE_PORT'] ? parseInt(env['TRUEGATE_PORT'], 10) : undefined) ??
    userConfig.port ??
    DEFAULT_PORT;

  const logLevel =
    overrides.logLevel ?? env['TRUEGATE_LOG_LEVEL'] ?? userConfig.logLevel ?? DEFAULT_LOG_LEVEL;

  const projectRoot =
    overrides.projectRoot ??
    env['TRUEGATE_PROJECT_ROOT'] ??
    userConfig.projectRoot ??
    process.cwd();

  const openAiApiKey = overrides.openAiApiKey ?? env['OPENAI_API_KEY'] ?? userConfig.openAiApiKey;
  const anthropicApiKey =
    overrides.anthropicApiKey ?? env['ANTHROPIC_API_KEY'] ?? userConfig.anthropicApiKey;
  const githubToken = overrides.githubToken ?? env['GITHUB_TOKEN'] ?? userConfig.githubToken;
  const upstreamUrl =
    overrides.upstreamUrl ?? env['TRUEGATE_UPSTREAM_URL'] ?? userConfig.upstreamUrl;
  const upstreamApiKey =
    overrides.upstreamApiKey ?? env['TRUEGATE_API_KEY'] ?? userConfig.upstreamApiKey;

  const stripEnv = env['TRUEGATE_STRIP_CLIENT_SYSTEM'];
  const stripClientSystem =
    overrides.stripClientSystem ??
    (stripEnv ? stripEnv === '1' || stripEnv.toLowerCase() === 'true' : undefined) ??
    userConfig.stripClientSystem;

  const responseMarker =
    overrides.responseMarker ?? env['TRUEGATE_RESPONSE_MARKER'] ?? userConfig.responseMarker;

  const config: TrueGateConfig = {
    port: isNaN(port) ? DEFAULT_PORT : port,
    logLevel,
    projectRoot,
    provider,
  };
  if (openAiApiKey !== undefined) config.openAiApiKey = openAiApiKey;
  if (anthropicApiKey !== undefined) config.anthropicApiKey = anthropicApiKey;
  if (githubToken !== undefined) config.githubToken = githubToken;
  if (upstreamUrl !== undefined) config.upstreamUrl = upstreamUrl;
  if (upstreamApiKey !== undefined) config.upstreamApiKey = upstreamApiKey;
  if (stripClientSystem !== undefined) config.stripClientSystem = stripClientSystem;
  if (responseMarker !== undefined) config.responseMarker = responseMarker;

  return config;
}

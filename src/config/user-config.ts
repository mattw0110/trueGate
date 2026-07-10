import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { PolicyMode, ProviderName, TrueGateConfig, TrueGateMode } from '../types/runtime.js';
import { DEFAULT_LOG_LEVEL, DEFAULT_PORT } from './constants.js';
import { stateDir } from './paths.js';

const PROVIDER_NAMES: [ProviderName, ...ProviderName[]] = [
  'openai',
  'anthropic',
  'ollama',
  'lmstudio',
  'github-copilot',
  'cliproxy',
  'custom',
];

const POLICY_MODES: [PolicyMode, ...PolicyMode[]] = ['off', 'targeted', 'light', 'full'];

export const UserConfigSchema = z
  .object({
    provider: z.enum(PROVIDER_NAMES).optional(),
    port: z.number().int().positive().optional(),
    logLevel: z.string().optional(),
    openAiApiKey: z.string().optional(),
    anthropicApiKey: z.string().optional(),
    githubToken: z.string().optional(),
    upstreamUrl: z.string().optional(),
    upstreamApiKey: z.string().optional(),
    stripClientSystem: z.boolean().optional(),
    policyMode: z.enum(POLICY_MODES).optional(),
    /** Deprecated compatibility shim for early MVP builds. */
    injectGovernance: z.boolean().optional(),
    responseMarker: z.string().optional(),
    mode: z.enum(['auto', 'locked']).optional(),
    modelOverrides: z.record(z.enum(PROVIDER_NAMES)).optional(),
    providerPriority: z.array(z.enum(PROVIDER_NAMES)).optional(),
  })
  .partial();

export type UserConfig = z.infer<typeof UserConfigSchema>;

export function userConfigPath(): string {
  return join(stateDir(), 'config.json');
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
  openAiApiKey?: string;
  anthropicApiKey?: string;
  githubToken?: string;
  upstreamUrl?: string;
  upstreamApiKey?: string;
  stripClientSystem?: boolean;
  policyMode?: PolicyMode;
  responseMarker?: string;
  mode?: TrueGateMode;
  providerForced?: boolean;
  modelOverrides?: Record<string, ProviderName>;
  providerPriority?: ProviderName[];
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
  const providerForced =
    overrides.providerForced ??
    (overrides.provider !== undefined || env['TRUEGATE_PROVIDER'] !== undefined);

  const port =
    overrides.port ??
    (env['TRUEGATE_PORT'] ? parseInt(env['TRUEGATE_PORT'], 10) : undefined) ??
    userConfig.port ??
    DEFAULT_PORT;

  const logLevel =
    overrides.logLevel ?? env['TRUEGATE_LOG_LEVEL'] ?? userConfig.logLevel ?? DEFAULT_LOG_LEVEL;

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

  const injectEnv = env['TRUEGATE_INJECT_GOVERNANCE'];
  const legacyInjectGovernance =
    injectEnv !== undefined
      ? injectEnv === '1' || injectEnv.toLowerCase() === 'true'
      : userConfig.injectGovernance;
  const policyMode =
    overrides.policyMode ??
    (env['TRUEGATE_POLICY_MODE'] as PolicyMode | undefined) ??
    userConfig.policyMode ??
    (legacyInjectGovernance === undefined
      ? undefined
      : legacyInjectGovernance
        ? 'full'
        : 'off');

  const responseMarker =
    overrides.responseMarker ?? env['TRUEGATE_RESPONSE_MARKER'] ?? userConfig.responseMarker;

  const mode: TrueGateMode | undefined =
    overrides.mode ?? (env['TRUEGATE_MODE'] as TrueGateMode | undefined) ?? userConfig.mode;
  const modelOverrides = overrides.modelOverrides ?? userConfig.modelOverrides;
  const providerPriority = overrides.providerPriority ?? userConfig.providerPriority;

  const config: TrueGateConfig = {
    port: isNaN(port) ? DEFAULT_PORT : port,
    logLevel,
    provider,
  };
  if (providerForced) config.providerForced = true;
  if (mode !== undefined) config.mode = mode;
  if (modelOverrides !== undefined) config.modelOverrides = modelOverrides;
  if (providerPriority !== undefined) config.providerPriority = providerPriority;
  if (openAiApiKey !== undefined) config.openAiApiKey = openAiApiKey;
  if (anthropicApiKey !== undefined) config.anthropicApiKey = anthropicApiKey;
  if (githubToken !== undefined) config.githubToken = githubToken;
  if (upstreamUrl !== undefined) config.upstreamUrl = upstreamUrl;
  if (upstreamApiKey !== undefined) config.upstreamApiKey = upstreamApiKey;
  if (stripClientSystem !== undefined) config.stripClientSystem = stripClientSystem;
  if (policyMode !== undefined) config.policyMode = policyMode;
  if (responseMarker !== undefined) config.responseMarker = responseMarker;

  return config;
}

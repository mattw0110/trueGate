import { DEFAULT_PROVIDER_PRIORITY, PROVIDER_BASE_URLS } from '../config/constants.js';
import type {
  ProviderName,
  TrueGateConfig,
  UpstreamEndpoint,
  UpstreamRegistry,
} from '../types/runtime.js';
import { probe } from './probe.js';

const PROBE_TIMEOUT_MS = 1500;

interface ProbeDef {
  provider: ProviderName;
  baseUrl: string;
  apiKey?: string;
  buildHeaders?: (apiKey?: string) => Record<string, string>;
  url: string;
  parseModels: (body: unknown) => string[];
  /** When set and the env-key is missing, skip the probe entirely. */
  requiresKey?: boolean;
  /** Models advertised even when enumeration is unavailable. */
  staticModels?: string[];
}

function parseOpenAiStyleModels(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const entry of data) {
    if (entry && typeof entry === 'object') {
      const id = (entry as { id?: unknown }).id;
      if (typeof id === 'string') ids.push(id);
    }
  }
  return ids;
}

function parseOllamaTags(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  const ids: string[] = [];
  for (const entry of models) {
    if (entry && typeof entry === 'object') {
      const name = (entry as { name?: unknown }).name;
      if (typeof name === 'string') ids.push(name);
    }
  }
  return ids;
}

function buildProbeDefs(config: TrueGateConfig): ProbeDef[] {
  const defs: ProbeDef[] = [];

  const cliproxyDef: ProbeDef = {
    provider: 'cliproxy',
    baseUrl: PROVIDER_BASE_URLS.cliproxy,
    url: `${PROVIDER_BASE_URLS.cliproxy}/v1/models`,
    parseModels: parseOpenAiStyleModels,
    buildHeaders: (apiKey) => (apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
  if (config.upstreamApiKey !== undefined) cliproxyDef.apiKey = config.upstreamApiKey;
  defs.push(cliproxyDef);

  defs.push({
    provider: 'ollama',
    baseUrl: PROVIDER_BASE_URLS.ollama,
    url: `${PROVIDER_BASE_URLS.ollama}/api/tags`,
    parseModels: parseOllamaTags,
  });

  defs.push({
    provider: 'lmstudio',
    baseUrl: PROVIDER_BASE_URLS.lmstudio,
    url: `${PROVIDER_BASE_URLS.lmstudio}/v1/models`,
    parseModels: parseOpenAiStyleModels,
  });

  if (config.openAiApiKey) {
    defs.push({
      provider: 'openai',
      baseUrl: PROVIDER_BASE_URLS.openai,
      apiKey: config.openAiApiKey,
      url: `${PROVIDER_BASE_URLS.openai}/v1/models`,
      parseModels: parseOpenAiStyleModels,
      buildHeaders: (apiKey) => ({ authorization: `Bearer ${apiKey}` }),
      requiresKey: true,
    });
  }

  if (config.anthropicApiKey) {
    defs.push({
      provider: 'anthropic',
      baseUrl: PROVIDER_BASE_URLS.anthropic,
      apiKey: config.anthropicApiKey,
      url: `${PROVIDER_BASE_URLS.anthropic}/v1/models`,
      parseModels: parseOpenAiStyleModels,
      buildHeaders: (apiKey) => ({
        'x-api-key': apiKey ?? '',
        'anthropic-version': '2023-06-01',
      }),
      requiresKey: true,
      // Anthropic /v1/models may 404 on some accounts; fall back to known IDs.
      staticModels: ['claude-sonnet-4-6', 'claude-opus-4-5', 'claude-haiku-4-5'],
    });
  }

  if (config.githubToken) {
    defs.push({
      provider: 'github-copilot',
      baseUrl: PROVIDER_BASE_URLS['github-copilot'],
      apiKey: config.githubToken,
      url: `${PROVIDER_BASE_URLS['github-copilot']}/v1/models`,
      parseModels: parseOpenAiStyleModels,
      buildHeaders: (apiKey) => ({
        authorization: `Bearer ${apiKey}`,
        'copilot-integration-id': 'vscode-chat',
        'editor-version': 'truegate/0.1.0',
      }),
      requiresKey: true,
      // Copilot doesn't reliably expose an enumeration endpoint.
      staticModels: ['gpt-4o', 'gpt-4o-mini', 'claude-3.5-sonnet'],
    });
  }

  return defs;
}

function priorityIndex(provider: ProviderName, priority: ProviderName[]): number {
  const idx = priority.indexOf(provider);
  return idx === -1 ? priority.length : idx;
}

async function probeOne(def: ProbeDef): Promise<UpstreamEndpoint> {
  const headers = def.buildHeaders ? def.buildHeaders(def.apiKey) : undefined;
  const result = await probe(def.url, {
    timeoutMs: PROBE_TIMEOUT_MS,
    parseJson: true,
    ...(headers ? { headers } : {}),
  });

  const models = result.ok ? def.parseModels(result.body) : [];
  const reachable = result.ok;
  const finalModels =
    models.length > 0
      ? models
      : reachable && def.staticModels
        ? [...def.staticModels]
        : !reachable && def.staticModels
          ? [...def.staticModels]
          : [];

  const endpoint: UpstreamEndpoint = {
    provider: def.provider,
    baseUrl: def.baseUrl,
    models: finalModels,
    priority: 0,
    reachable,
  };
  if (def.apiKey !== undefined) endpoint.apiKey = def.apiKey;
  if (result.err) endpoint.err = result.err;
  return endpoint;
}

export interface BuildRegistryOptions {
  /** Skip probes — return a locked-mode registry built from config alone. */
  noAuto?: boolean;
}

/**
 * Build the upstream registry. In auto mode this probes every potential
 * upstream in parallel with a 1.5s timeout each. In locked mode (or noAuto)
 * a single endpoint is synthesized from `config.provider`.
 */
export async function buildUpstreamRegistry(
  config: TrueGateConfig,
  options: BuildRegistryOptions = {},
): Promise<UpstreamRegistry> {
  const priority = config.providerPriority ?? DEFAULT_PROVIDER_PRIORITY;
  const modelOverrides = config.modelOverrides ?? {};
  const mode: 'auto' | 'locked' =
    options.noAuto || config.mode === 'locked' || config.providerForced
      ? 'locked'
      : (config.mode ?? 'auto');

  if (mode === 'locked') {
    const endpoint = synthesizeLockedEndpoint(config, priority);
    const registry: UpstreamRegistry = {
      endpoints: [endpoint],
      mode: 'locked',
      priority,
      modelOverrides,
    };
    if (config.providerForced || options.noAuto) {
      registry.forcedProvider = config.provider;
    }
    return registry;
  }

  const defs = buildProbeDefs(config);
  const probed = await Promise.all(defs.map(probeOne));
  const endpoints = probed
    .map((e) => ({ ...e, priority: priorityIndex(e.provider, priority) }))
    .sort((a, b) => a.priority - b.priority);

  return {
    endpoints,
    mode,
    priority,
    modelOverrides,
  };
}

function synthesizeLockedEndpoint(
  config: TrueGateConfig,
  priority: ProviderName[],
): UpstreamEndpoint {
  const provider = config.provider;
  const baseUrl =
    config.upstreamUrl ??
    PROVIDER_BASE_URLS[provider as keyof typeof PROVIDER_BASE_URLS] ??
    'http://localhost';
  const apiKey =
    provider === 'openai'
      ? config.openAiApiKey
      : provider === 'anthropic'
        ? config.anthropicApiKey
        : provider === 'github-copilot'
          ? (config.githubToken ?? config.upstreamApiKey)
          : config.upstreamApiKey;
  const endpoint: UpstreamEndpoint = {
    provider,
    baseUrl,
    models: [],
    priority: priorityIndex(provider, priority),
    reachable: true,
  };
  if (apiKey !== undefined) endpoint.apiKey = apiKey;
  return endpoint;
}

/** Concise startup summary suitable for `console.log`. */
export function formatRegistrySummary(registry: UpstreamRegistry): string[] {
  const lines: string[] = [];
  for (const ep of registry.endpoints) {
    const status = ep.reachable ? `✓ ${ep.models.length} models` : `✗ unreachable`;
    const sample = ep.models.slice(0, 3).join(', ');
    const more = ep.models.length > 3 ? ', …' : '';
    const provider = ep.provider.padEnd(15, ' ');
    const url = new URL(ep.baseUrl);
    const host = `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
    lines.push(
      `[truegate] ${provider} ${host.padEnd(22, ' ')} ${status}${sample ? ` (${sample}${more})` : ''}`,
    );
  }
  const mode = registry.mode === 'locked' ? `mode=locked` : `mode=auto`;
  const force = registry.forcedProvider ? `, forced=${registry.forcedProvider}` : '';
  const order = registry.priority.join('>');
  lines.push(`[truegate] ${mode}${force}, priority=${order}`);
  return lines;
}

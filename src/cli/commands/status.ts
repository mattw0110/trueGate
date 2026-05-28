import { fetch } from 'undici';
import { readUserConfig, resolveConfig } from '../../config/user-config.js';
import { PROVIDER_BASE_URLS } from '../../config/constants.js';

function pad(s: string, n: number): string {
  return (s + ' '.repeat(n)).slice(0, n);
}

async function probe(
  url: string,
  timeoutMs = 3000,
): Promise<{ ok: boolean; status?: number; err?: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, err: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(t);
  }
}

export async function runStatus(): Promise<void> {
  const userConfig = await readUserConfig();
  const config = resolveConfig(userConfig);
  const proxyUrl = `http://localhost:${config.port}`;

  console.log('━━━━ trueGate status ━━━━');
  console.log(`provider:    ${config.provider}`);
  console.log(`port:        ${config.port}`);
  console.log(`projectRoot: ${config.projectRoot}`);
  console.log();

  // proxy itself
  console.log('Checking proxy…');
  const proxy = await probe(proxyUrl);
  if (proxy.ok) {
    console.log(`  ${pad('proxy', 12)} OK (http ${proxy.status})`);
  } else {
    console.log(`  ${pad('proxy', 12)} DOWN — ${proxy.err}`);
    console.log('  → start it with: truegate serve');
  }

  // upstream
  const upstream =
    config.upstreamUrl ?? PROVIDER_BASE_URLS[config.provider as keyof typeof PROVIDER_BASE_URLS];
  if (upstream) {
    console.log(`Checking upstream (${upstream})…`);
    const up = await probe(upstream);
    if (up.ok) {
      console.log(`  ${pad('upstream', 12)} reachable (http ${up.status})`);
    } else {
      console.log(`  ${pad('upstream', 12)} unreachable — ${up.err}`);
    }
  }

  // governance
  console.log();
  console.log('Run `truegate inspect` to see the governance compiled for this project root.');
}

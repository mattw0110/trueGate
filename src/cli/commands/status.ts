import { readUserConfig, resolveConfig } from '../../config/user-config.js';
import { buildUpstreamRegistry } from '../../registry/upstream-registry.js';
import { probe } from '../../registry/probe.js';

function pad(s: string, n: number): string {
  return (s + ' '.repeat(n)).slice(0, n);
}

export async function runStatus(): Promise<void> {
  const userConfig = await readUserConfig();
  const config = resolveConfig(userConfig);
  const proxyUrl = `http://localhost:${config.port}`;

  console.log('━━━━ trueGate status ━━━━');
  console.log(`mode:        ${config.mode ?? (config.providerForced ? 'locked' : 'auto')}`);
  console.log(`provider:    ${config.provider}${config.providerForced ? ' (forced)' : ''}`);
  console.log(`port:        ${config.port}`);
  console.log(`governance:  bundled defaults (data/) + operator overrides (.state/)`);
  console.log();

  // proxy itself
  console.log('Checking proxy…');
  const proxyResult = await probe(proxyUrl);
  if (proxyResult.ok) {
    console.log(`  ${pad('proxy', 12)} OK (http ${proxyResult.status})`);
  } else {
    console.log(`  ${pad('proxy', 12)} DOWN — ${proxyResult.err}`);
    console.log('  → start it with: truegate serve');
  }

  // Upstreams via registry
  console.log();
  console.log('Probing upstreams…');
  const registry = await buildUpstreamRegistry(config);
  if (registry.endpoints.length === 0) {
    console.log('  (no upstream endpoints configured)');
  } else {
    for (const ep of registry.endpoints) {
      const status = ep.reachable ? `✓ reachable` : `✗ unreachable`;
      const models = ep.models.length === 0 ? 'no models' : `${ep.models.length} models`;
      const sample = ep.models.slice(0, 5).join(', ');
      const more = ep.models.length > 5 ? `, +${ep.models.length - 5} more` : '';
      console.log(
        `  ${pad(ep.provider, 16)} ${pad(ep.baseUrl, 32)} ${status}  ${models}${sample ? ` — ${sample}${more}` : ''}`,
      );
    }
    console.log();
    console.log(`mode=${registry.mode}, priority=${registry.priority.join('>')}`);
    if (registry.forcedProvider) console.log(`forced=${registry.forcedProvider}`);
  }

  console.log();
  console.log('Run `truegate inspect` to see the governance compiled for this project root.');
}

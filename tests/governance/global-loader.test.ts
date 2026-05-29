import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGlobalContext } from '../../src/governance/loaders/global-loader.js';

let fakeData: string;
let fakeState: string;
let origData: string | undefined;
let origState: string | undefined;

beforeEach(async () => {
  fakeData = await mkdtemp(join(tmpdir(), 'truegate-data-'));
  fakeState = await mkdtemp(join(tmpdir(), 'truegate-state-'));
  origData = process.env['TRUEGATE_DATA_DIR'];
  origState = process.env['TRUEGATE_STATE_DIR'];
  process.env['TRUEGATE_DATA_DIR'] = fakeData;
  process.env['TRUEGATE_STATE_DIR'] = fakeState;
});

afterEach(async () => {
  if (origData === undefined) delete process.env['TRUEGATE_DATA_DIR'];
  else process.env['TRUEGATE_DATA_DIR'] = origData;
  if (origState === undefined) delete process.env['TRUEGATE_STATE_DIR'];
  else process.env['TRUEGATE_STATE_DIR'] = origState;
  await rm(fakeData, { recursive: true, force: true });
  await rm(fakeState, { recursive: true, force: true });
});

describe('loadGlobalContext', () => {
  it('returns null when both data/ and .state/ are empty', async () => {
    expect(await loadGlobalContext()).toBeNull();
  });

  it('loads bundled defaults from data/governance.md', async () => {
    await writeFile(join(fakeData, 'governance.md'), '# Operator policy\nNever leak secrets.');
    const result = await loadGlobalContext();
    expect(result?.source).toBe('global');
    expect(result?.content).toContain('Never leak secrets');
  });

  it('parses data/rules.yaml and exposes it on frontMatter.rules', async () => {
    await writeFile(
      join(fakeData, 'rules.yaml'),
      'version: "1"\nforbiddenDependencies:\n  - eval\n',
    );
    const result = await loadGlobalContext();
    const rules = result?.frontMatter?.['rules'] as { forbiddenDependencies: string[] };
    expect(rules.forbiddenDependencies).toContain('eval');
  });

  it('prefers .state/ overrides over data/ defaults', async () => {
    await writeFile(join(fakeData, 'governance.md'), '# Shipped default');
    await writeFile(join(fakeState, 'governance.md'), '# Operator override');
    const result = await loadGlobalContext();
    expect(result?.content).toContain('Operator override');
    expect(result?.content).not.toContain('Shipped default');
  });

  it('falls back to data/ for files the operator did not override', async () => {
    await mkdir(fakeData, { recursive: true });
    await writeFile(join(fakeData, 'governance.md'), '# Shipped governance');
    await writeFile(
      join(fakeData, 'rules.yaml'),
      'version: "1"\nforbiddenDependencies:\n  - moment\n',
    );
    // .state has only rules.yaml override, no governance.md
    await writeFile(
      join(fakeState, 'rules.yaml'),
      'version: "1"\nforbiddenDependencies:\n  - lodash\n',
    );
    const result = await loadGlobalContext();
    expect(result?.content).toContain('Shipped governance');
    const rules = result?.frontMatter?.['rules'] as { forbiddenDependencies: string[] };
    expect(rules.forbiddenDependencies).toContain('lodash');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGlobalContext } from '../../src/governance/loaders/global-loader.js';

let fakeHome: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), 'truegate-fakehome-'));
  originalHome = process.env['HOME'];
  originalUserProfile = process.env['USERPROFILE'];
  process.env['HOME'] = fakeHome;
  process.env['USERPROFILE'] = fakeHome;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = originalHome;
  if (originalUserProfile === undefined) delete process.env['USERPROFILE'];
  else process.env['USERPROFILE'] = originalUserProfile;
  await rm(fakeHome, { recursive: true, force: true });
});

describe('loadGlobalContext', () => {
  it('returns null when ~/.truegate is missing', async () => {
    expect(await loadGlobalContext()).toBeNull();
  });

  it('loads ~/.truegate/governance.md', async () => {
    const dir = join(fakeHome, '.truegate');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'governance.md'), '# Operator policy\nNever leak secrets.');

    const result = await loadGlobalContext();
    expect(result).not.toBeNull();
    expect(result?.source).toBe('global');
    expect(result?.content).toContain('Never leak secrets');
  });

  it('parses ~/.truegate/rules.yaml and exposes it on frontMatter.rules', async () => {
    const dir = join(fakeHome, '.truegate');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'rules.yaml'), 'version: "1"\nforbiddenDependencies:\n  - eval\n');

    const result = await loadGlobalContext();
    const rules = result?.frontMatter?.['rules'] as { forbiddenDependencies: string[] };
    expect(rules.forbiddenDependencies).toContain('eval');
  });
});

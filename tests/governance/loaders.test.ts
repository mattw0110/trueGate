import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadClaudeContext } from '../../src/governance/loaders/claude-loader.js';
import { loadAgentsContext } from '../../src/governance/loaders/agents-loader.js';
import { loadCursorContext } from '../../src/governance/loaders/cursor-loader.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'truegate-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('claude-loader', () => {
  it('returns null when CLAUDE.md is missing', async () => {
    expect(await loadClaudeContext(tmpDir)).toBeNull();
  });

  it('loads CLAUDE.md body', async () => {
    await writeFile(join(tmpDir, 'CLAUDE.md'), '# Claude\nUse strict TypeScript.');
    const result = await loadClaudeContext(tmpDir);
    expect(result?.source).toBe('claude');
    expect(result?.content).toContain('Use strict TypeScript');
  });

  it('strips front matter from CLAUDE.md', async () => {
    await writeFile(join(tmpDir, 'CLAUDE.md'), '---\ntitle: Test\n---\n# Body\nContent here.');
    const result = await loadClaudeContext(tmpDir);
    expect(result?.content).toContain('Content here');
    expect(result?.content).not.toContain('title: Test');
  });
});

describe('agents-loader', () => {
  it('returns null when AGENTS.md is missing', async () => {
    expect(await loadAgentsContext(tmpDir)).toBeNull();
  });

  it('loads AGENTS.md', async () => {
    await writeFile(join(tmpDir, 'AGENTS.md'), '# Agents\nFollow these rules.');
    const result = await loadAgentsContext(tmpDir);
    expect(result?.source).toBe('agents');
    expect(result?.content).toContain('Follow these rules');
  });
});

describe('cursor-loader', () => {
  it('returns null when .cursor/rules is missing', async () => {
    expect(await loadCursorContext(tmpDir)).toBeNull();
  });

  it('returns null when no .mdc files', async () => {
    await mkdir(join(tmpDir, '.cursor', 'rules'), { recursive: true });
    await writeFile(join(tmpDir, '.cursor', 'rules', 'readme.txt'), 'ignored');
    expect(await loadCursorContext(tmpDir)).toBeNull();
  });

  it('loads and concatenates .mdc files alphabetically', async () => {
    const dir = join(tmpDir, '.cursor', 'rules');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'b-rule.mdc'), 'Rule B');
    await writeFile(join(dir, 'a-rule.mdc'), 'Rule A');

    const result = await loadCursorContext(tmpDir);
    expect(result?.source).toBe('cursor');
    expect(result?.content.indexOf('Rule A')).toBeLessThan(result?.content.indexOf('Rule B') ?? -1);
  });
});

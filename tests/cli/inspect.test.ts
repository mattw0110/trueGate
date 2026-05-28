import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInspect } from '../../src/cli/commands/inspect.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'truegate-inspect-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('runInspect', () => {
  it('prints context summary for a project with CLAUDE.md', async () => {
    await writeFile(join(tmpDir, 'CLAUDE.md'), '# Project conventions\nUse strict TS.');

    const lines: string[] = [];
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });

    await runInspect({ project: tmpDir });

    consoleSpy.mockRestore();

    const output = lines.join('\n');
    expect(output).toContain('CLAUDE.md');
  });

  it('runs without error for empty project', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(runInspect({ project: tmpDir })).resolves.not.toThrow();
    consoleSpy.mockRestore();
  });
});

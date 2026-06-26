import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  flushGovernanceLog,
  logGovernanceEvent,
  printGovernanceLog,
  printGovernanceSummary,
} from '../../src/governance/events/logger.js';

let tmpDir: string;
let originalStateDir: string | undefined;

class CaptureStream extends Writable {
  chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(String(chunk));
    callback();
  }

  text(): string {
    return this.chunks.join('');
  }
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'truegate-logger-test-'));
  originalStateDir = process.env['TRUEGATE_STATE_DIR'];
  process.env['TRUEGATE_STATE_DIR'] = join(tmpDir, '.state');
});

afterEach(async () => {
  await flushGovernanceLog();
  if (originalStateDir === undefined) delete process.env['TRUEGATE_STATE_DIR'];
  else process.env['TRUEGATE_STATE_DIR'] = originalStateDir;
  await rm(tmpDir, { recursive: true, force: true });
});

describe('governance event logger', () => {
  it('prints related governance line items for fired rules', async () => {
    await logGovernanceEvent({
      event: 'governance_decision',
      decision: 'warn',
      route: '/v1/chat/completions',
      issues: [
        {
          severity: 'warn',
          rule: 'dangerous-patterns',
          message: 'console.log left in code — use a real logger or remove before commit',
          match: 'console.log(',
        },
      ],
      governance: {
        bundleSource: 'data',
        governancePath: '/repo/data/governance.md',
        rulesPath: '/repo/data/rules.yaml',
        governanceHash: 'abc123def0',
        anchors: [{ title: 'Code quality floor', line: 64, endLine: 77 }],
        ruleRefs: [
          {
            id: 'dangerous:no-console-log',
            rule: 'dangerous-patterns',
            label: 'console.log left in code — use a real logger or remove before commit',
            line: 119,
          },
        ],
        guidanceItems: [
          {
            id: 'guidance:code-quality-floor-no-debug-leftovers',
            section: 'Code quality floor',
            line: 71,
            endLine: 72,
            text: "No debug leftovers (`console.log`, `print(...)`, `dump`, `debugger`) in committed code unless routed through the project's logger.",
          },
        ],
      },
    });
    await flushGovernanceLog();

    const stream = new CaptureStream();
    await printGovernanceLog({ lines: 1, pretty: true, color: false, stream });

    expect(stream.text()).toContain('dangerous-patterns [dangerous:no-console-log] (rules.yaml:119)');
    expect(stream.text()).toContain('[dangerous:no-console-log]');
    expect(stream.text()).toContain(
      'related guidance [guidance:code-quality-floor-no-debug-leftovers]: governance.md:71-72 Code quality floor',
    );
  });

  it('summarizes decisions, rule ids, and related guidance ids', async () => {
    await logGovernanceEvent({
      event: 'governance_decision',
      decision: 'warn',
      route: '/v1/chat/completions',
      issues: [
        {
          severity: 'warn',
          rule: 'dangerous-patterns',
          message: 'console.log left in code — use a real logger or remove before commit',
          match: 'console.log(',
        },
      ],
      governance: {
        bundleSource: 'data',
        governancePath: '/repo/data/governance.md',
        rulesPath: '/repo/data/rules.yaml',
        governanceHash: 'abc123def0',
        anchors: [],
        ruleRefs: [
          {
            id: 'dangerous:no-console-log',
            rule: 'dangerous-patterns',
            label: 'console.log left in code — use a real logger or remove before commit',
            line: 119,
          },
        ],
        guidanceItems: [
          {
            id: 'guidance:code-quality-floor-no-debug-leftovers',
            section: 'Code quality floor',
            line: 71,
            endLine: 72,
            text: "No debug leftovers (`console.log`, `print(...)`, `dump`, `debugger`) in committed code unless routed through the project's logger.",
          },
        ],
      },
    });
    await flushGovernanceLog();

    const stream = new CaptureStream();
    await printGovernanceSummary({ lines: 10, stream });

    expect(stream.text()).toContain('warn');
    expect(stream.text()).toContain('dangerous:no-console-log (rules.yaml:119)');
    expect(stream.text()).toContain('guidance:code-quality-floor-no-debug-leftovers');
  });
});

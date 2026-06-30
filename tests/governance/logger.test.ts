import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  flushGovernanceLog,
  governanceLogPath,
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
  it('stores compact governance metadata for pass events', async () => {
    await logGovernanceEvent({
      event: 'governance_decision',
      decision: 'pass',
      route: '/v1/chat/completions',
      governance: {
        bundleSource: 'data',
        governancePath: '/repo/data/governance.md',
        rulesPath: '/repo/data/rules.yaml',
        governanceHash: 'passhash',
        rulesHash: 'ruleshash',
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

    const [line] = (await readFile(governanceLogPath(), 'utf-8')).trim().split('\n');
    const record = JSON.parse(line ?? '{}') as {
      governance?: {
        governanceHash?: string;
        rulesHash?: string;
        anchors?: unknown;
        ruleRefs?: unknown;
        guidanceItems?: unknown;
      };
    };

    expect(record.governance?.governanceHash).toBe('passhash');
    expect(record.governance?.rulesHash).toBe('ruleshash');
    expect(record.governance?.anchors).toBeUndefined();
    expect(record.governance?.ruleRefs).toBeUndefined();
    expect(record.governance?.guidanceItems).toBeUndefined();
  });

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

  it('stores only matched rule refs and related guidance for warning events', async () => {
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
        governanceHash: 'warnhash',
        anchors: [{ title: 'Code quality floor', line: 64, endLine: 77 }],
        ruleRefs: [
          {
            id: 'dangerous:no-console-log',
            rule: 'dangerous-patterns',
            label: 'console.log left in code — use a real logger or remove before commit',
            line: 119,
          },
          {
            id: 'dangerous:eval',
            rule: 'dangerous-patterns',
            label: 'eval() is forbidden',
            line: 77,
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
          {
            id: 'guidance:security-floor-no-eval',
            section: 'Security floor',
            line: 36,
            endLine: 37,
            text: 'No `eval()`, `new Function()`, or other execution of arbitrary user-supplied strings.',
          },
        ],
      },
    });
    await flushGovernanceLog();

    const [line] = (await readFile(governanceLogPath(), 'utf-8')).trim().split('\n');
    const record = JSON.parse(line ?? '{}') as {
      governance?: {
        ruleRefs?: Array<{ id: string }>;
        guidanceItems?: Array<{ id: string }>;
      };
    };

    expect(record.governance?.ruleRefs?.map((ref) => ref.id)).toEqual(['dangerous:no-console-log']);
    expect(record.governance?.guidanceItems?.map((item) => item.id)).toEqual([
      'guidance:code-quality-floor-no-debug-leftovers',
    ]);
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

  it('filters summaries by governance hash', async () => {
    await logGovernanceEvent({
      event: 'governance_decision',
      decision: 'pass',
      route: '/v1/chat/completions',
      governance: {
        bundleSource: 'data',
        governancePath: '/repo/data/governance.md',
        rulesPath: '/repo/data/rules.yaml',
        governanceHash: 'oldhash',
        anchors: [],
      },
    });
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
        governanceHash: 'newhash',
        anchors: [],
        ruleRefs: [
          {
            id: 'dangerous:no-console-log',
            rule: 'dangerous-patterns',
            label: 'console.log left in code — use a real logger or remove before commit',
            line: 119,
          },
        ],
      },
    });
    await flushGovernanceLog();

    const stream = new CaptureStream();
    await printGovernanceSummary({ lines: 10, governanceHash: 'newhash', stream });

    expect(stream.text()).toContain('Governance log summary (1 event, governance=newhash)');
    expect(stream.text()).toContain('warn');
    expect(stream.text()).not.toContain('pass');
  });

  it('filters logs by decision', async () => {
    await logGovernanceEvent({
      event: 'governance_decision',
      decision: 'pass',
      route: '/v1/chat/completions',
      provider: 'cliproxy',
      model: 'gpt-pass',
    });
    await logGovernanceEvent({
      event: 'governance_decision',
      decision: 'warn',
      route: '/v1/chat/completions',
      provider: 'cliproxy',
      model: 'gpt-warn',
      issues: [
        {
          severity: 'warn',
          rule: 'dangerous-patterns',
          message: 'console.log left in code — use a real logger or remove before commit',
          match: 'console.log(',
        },
      ],
    });
    await flushGovernanceLog();

    const stream = new CaptureStream();
    await printGovernanceLog({ lines: 10, decision: 'warn', pretty: true, color: false, stream });

    expect(stream.text()).toContain('WARN');
    expect(stream.text()).toContain('gpt-warn');
    expect(stream.text()).not.toContain('gpt-pass');
  });

  it('summarizes warning rate and warning density by model and client', async () => {
    await logGovernanceEvent({
      event: 'governance_decision',
      decision: 'pass',
      route: '/v1/chat/completions',
      provider: 'cliproxy',
      model: 'gpt-pass',
      client: 'agent-zero',
    });
    await logGovernanceEvent({
      event: 'governance_decision',
      decision: 'warn',
      route: '/v1/chat/completions',
      provider: 'cliproxy',
      model: 'gpt-warn',
      client: 'agent-zero',
      issues: [
        {
          severity: 'warn',
          rule: 'dangerous-patterns',
          message: 'console.log left in code — use a real logger or remove before commit',
          match: 'console.log(',
        },
      ],
    });
    await flushGovernanceLog();

    const stream = new CaptureStream();
    await printGovernanceSummary({ lines: 10, stream });

    expect(stream.text()).toContain('Warning/block rate: 50.0% (1/2)');
    expect(stream.text()).toContain('cliproxy/gpt-pass  warn/block=0 (0.0%)');
    expect(stream.text()).toContain('cliproxy/gpt-warn  warn/block=1 (100.0%)');
    expect(stream.text()).toContain('agent-zero  warn/block=1 (50.0%)');
  });
});

import { describe, it, expect } from 'vitest';
import { buildRuntimeContext } from '../../src/governance/compiler/build-runtime-context.js';
import { resolveSourceOrder } from '../../src/governance/compiler/resolve-priority.js';
import type { GovernanceFile } from '../../src/types/governance.js';

const makeFile = (content: string): GovernanceFile => ({
  source: 'global',
  sourcePath: '/home/test/trueGate/data/governance.md',
  content,
});

describe('resolveSourceOrder', () => {
  it('returns files unchanged (operator-wide is the only source)', () => {
    const files = [makeFile('one'), makeFile('two')];
    const ordered = resolveSourceOrder(files);
    expect(ordered.map((f) => f.content)).toEqual(['one', 'two']);
  });
});

describe('buildRuntimeContext', () => {
  it('frames the system message and includes operator-wide content', () => {
    const ctx = buildRuntimeContext([makeFile('Operator-wide guidance here.')]);
    expect(ctx.systemMessage).toContain('How to use this context');
    expect(ctx.systemMessage).toContain('Operator-wide guidance here.');
    expect(ctx.systemMessage).toContain('trueGate');
  });

  it('lists global source in compiled context', () => {
    const ctx = buildRuntimeContext([makeFile('x')]);
    expect(ctx.sources).toContain('global');
  });

  it('returns context with framing even for no files', () => {
    const ctx = buildRuntimeContext([]);
    expect(ctx.sources).toHaveLength(0);
    expect(ctx.rules.forbiddenDependencies).toHaveLength(0);
    expect(ctx.systemMessage).toContain('How to use this context');
  });

  it('global rules.yaml drives forbiddenDependencies', () => {
    const rulesFile: GovernanceFile = {
      source: 'global',
      sourcePath: '/home/test/trueGate/data/governance.md',
      content: '',
      frontMatter: {
        rules: {
          version: '1',
          forbiddenDependencies: ['moment'],
          forbiddenFrameworks: [],
          dangerousPatterns: [],
          typescriptRules: { noAny: true, requireStrict: true },
        },
      },
    };
    const ctx = buildRuntimeContext([rulesFile]);
    expect(ctx.rules.forbiddenDependencies).toContain('moment');
  });
});

import { describe, it, expect } from 'vitest';
import { buildRuntimeContext } from '../../src/governance/compiler/build-runtime-context.js';
import { resolveSourceOrder } from '../../src/governance/compiler/resolve-priority.js';
import type { GovernanceFile } from '../../src/types/governance.js';

const makeFile = (source: GovernanceFile['source'], content: string): GovernanceFile => ({
  source,
  projectRoot: '/test',
  content,
});

describe('resolveSourceOrder', () => {
  it('orders project sources before global (claude > agents > cursor > global)', () => {
    const files = [
      makeFile('global', 'G'),
      makeFile('agents', 'A'),
      makeFile('cursor', 'C'),
      makeFile('claude', 'CL'),
    ];
    const ordered = resolveSourceOrder(files);
    expect(ordered.map((f) => f.source)).toEqual(['claude', 'agents', 'cursor', 'global']);
  });
});

describe('buildRuntimeContext', () => {
  it('frames the system message with conflict policy and includes project sources first', () => {
    const files = [
      makeFile('global', 'Operator-wide guidance here.'),
      makeFile('claude', 'CLAUDE rules here.'),
    ];
    const ctx = buildRuntimeContext(files);
    expect(ctx.systemMessage).toContain('PROJECT documentation');
    expect(ctx.systemMessage).toContain('OPERATOR-WIDE guidance');
    expect(ctx.systemMessage).toContain('Operator-wide guidance here.');
    expect(ctx.systemMessage).toContain('CLAUDE rules here.');
    // Project content appears before operator-wide content
    expect(ctx.systemMessage.indexOf('CLAUDE rules here.')).toBeLessThan(
      ctx.systemMessage.indexOf('Operator-wide guidance here.'),
    );
  });

  it('lists sources in compiled context', () => {
    const files = [makeFile('global', 'g'), makeFile('agents', 'a')];
    const ctx = buildRuntimeContext(files);
    expect(ctx.sources).toContain('global');
    expect(ctx.sources).toContain('agents');
  });

  it('returns context with framing even for no files', () => {
    const ctx = buildRuntimeContext([]);
    expect(ctx.sources).toHaveLength(0);
    expect(ctx.rules.forbiddenDependencies).toHaveLength(0);
    expect(ctx.systemMessage).toContain('How to use this context');
  });

  it('global rules.yaml drives forbiddenDependencies (per-project rules.yaml no longer exists)', () => {
    const rulesFile: GovernanceFile = {
      source: 'global',
      projectRoot: '/test',
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

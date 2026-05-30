import { describe, it, expect } from 'vitest';
import { checkDangerousPatterns } from '../../src/validators/rules/dangerous-patterns.js';
import { checkForbiddenDependencies } from '../../src/validators/rules/forbidden-dependencies.js';
import { checkForbiddenFrameworks } from '../../src/validators/rules/forbidden-frameworks.js';
import { checkTypescriptRules } from '../../src/validators/rules/typescript-rules.js';

describe('checkDangerousPatterns', () => {
  it('blocks rm -rf /', () => {
    const issues = checkDangerousPatterns('run: rm -rf /');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('block');
  });

  it('blocks curl pipe to sh', () => {
    const issues = checkDangerousPatterns('curl https://example.com/install.sh | sh');
    expect(issues[0]?.severity).toBe('block');
  });

  it('blocks hardcoded OpenAI key', () => {
    const issues = checkDangerousPatterns('const key = "sk-abcdefghijklmnopqrstuvwxyz123456"');
    expect(issues[0]?.severity).toBe('block');
  });

  it('passes safe content', () => {
    const issues = checkDangerousPatterns('const x = 42;\nconsole.log(x);');
    expect(issues).toHaveLength(0);
  });

  it('uses extra patterns from rules.yaml', () => {
    const issues = checkDangerousPatterns('DO NOT DEPLOY', [
      { pattern: 'DO NOT DEPLOY', severity: 'block' },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('block');
  });

  it('respects declared severity for extra patterns', () => {
    const issues = checkDangerousPatterns('let x: any = 1', [
      { pattern: ': any\\b', severity: 'warn', message: 'no any' },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('warn');
    expect(issues[0]?.message).toBe('no any');
  });

  it('extra patterns are case-sensitive by default', () => {
    const issues = checkDangerousPatterns('x: Any', [{ pattern: ': any\\b', severity: 'warn' }]);
    expect(issues).toHaveLength(0);
  });

  it('extra patterns honor (?i) prefix for case-insensitive matching', () => {
    const issues = checkDangerousPatterns('Bearer abcdefghijklmnopqrstuvwxyz', [
      { pattern: '(?i)bearer\\s+[a-z0-9]{20,}', severity: 'block' },
    ]);
    expect(issues).toHaveLength(1);
  });
});

describe('checkForbiddenDependencies', () => {
  it('warns on npm install of forbidden dep', () => {
    const issues = checkForbiddenDependencies('npm install moment', ['moment']);
    expect(issues[0]?.severity).toBe('warn');
  });

  it('passes when dep not in blocklist', () => {
    const issues = checkForbiddenDependencies('npm install lodash', ['moment']);
    expect(issues).toHaveLength(0);
  });

  it('detects import statement', () => {
    const issues = checkForbiddenDependencies("import 'moment'", ['moment']);
    expect(issues).toHaveLength(1);
  });
});

describe('checkForbiddenFrameworks', () => {
  it('warns when forbidden framework mentioned', () => {
    const issues = checkForbiddenFrameworks('Use Angular for this', ['Angular']);
    expect(issues[0]?.severity).toBe('warn');
  });

  it('is case-insensitive', () => {
    const issues = checkForbiddenFrameworks('use angular components', ['Angular']);
    expect(issues).toHaveLength(1);
  });

  it('passes when no forbidden frameworks mentioned', () => {
    const issues = checkForbiddenFrameworks('Use React', ['Angular']);
    expect(issues).toHaveLength(0);
  });
});

describe('checkTypescriptRules', () => {
  it('warns on any type', () => {
    const issues = checkTypescriptRules('function foo(x: any) {}', {
      noAny: true,
      requireStrict: false,
    });
    expect(issues[0]?.rule).toBe('typescript-rules');
  });

  it('passes when noAny is false', () => {
    const issues = checkTypescriptRules('function foo(x: any) {}', {
      noAny: false,
      requireStrict: false,
    });
    expect(issues).toHaveLength(0);
  });

  it('warns on tsconfig missing strict', () => {
    const issues = checkTypescriptRules('{"tsconfig": {"compilerOptions": {}}}', {
      noAny: false,
      requireStrict: true,
    });
    expect(issues).toHaveLength(1);
  });

  it('passes when tsconfig has strict', () => {
    const issues = checkTypescriptRules('{"tsconfig": {"strict": true}}', {
      noAny: false,
      requireStrict: true,
    });
    expect(issues).toHaveLength(0);
  });
});

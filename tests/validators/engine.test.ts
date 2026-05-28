import { describe, it, expect } from 'vitest';
import { validateResponse } from '../../src/validators/engine/validate-response.js';
import type { RuleSet } from '../../src/types/governance.js';

const defaultRules: RuleSet = {
  forbiddenDependencies: [],
  forbiddenFrameworks: [],
  dangerousPatterns: [],
  typescriptRules: { noAny: false, requireStrict: false },
};

describe('validateResponse', () => {
  it('returns pass for clean content', () => {
    const result = validateResponse('Here is a safe TypeScript snippet.', defaultRules);
    expect(result.severity).toBe('pass');
    expect(result.blocked).toBe(false);
    expect(result.issues).toHaveLength(0);
  });

  it('returns block for dangerous content', () => {
    const result = validateResponse('Run: rm -rf /', defaultRules);
    expect(result.severity).toBe('block');
    expect(result.blocked).toBe(true);
  });

  it('returns warn for forbidden dependency', () => {
    const rules: RuleSet = { ...defaultRules, forbiddenDependencies: ['moment'] };
    const result = validateResponse('npm install moment', rules);
    expect(result.severity).toBe('warn');
    expect(result.blocked).toBe(false);
  });

  it('block severity wins over warn', () => {
    const rules: RuleSet = { ...defaultRules, forbiddenDependencies: ['moment'] };
    const result = validateResponse('npm install moment && rm -rf /', rules);
    expect(result.severity).toBe('block');
    expect(result.blocked).toBe(true);
    expect(result.issues.length).toBeGreaterThan(1);
  });
});

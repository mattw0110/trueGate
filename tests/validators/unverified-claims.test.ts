import { describe, it, expect } from 'vitest';
import { checkUnverifiedClaims } from '../../src/validators/rules/unverified-claims.js';
import type { ChatMessage } from '../../src/types/providers.js';

const msg = (role: ChatMessage['role'], content: string): ChatMessage => ({ role, content });

describe('checkUnverifiedClaims', () => {
  it('flags a SHA in a commit-context claim when no prior message contains it', () => {
    const issues = checkUnverifiedClaims(
      'Commit e9e2e87 has been pushed to origin/main. ✅ Verified!',
      [msg('user', 'please make the change')],
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.match === 'e9e2e87')).toBe(true);
    expect(issues[0]?.rule).toBe('unverified-claims');
    expect(issues[0]?.severity).toBe('warn');
  });

  it('does NOT flag a SHA that appears in a prior tool result', () => {
    const issues = checkUnverifiedClaims(
      'Commit e9e2e87 has been pushed to origin/main. ✅ Verified!',
      [
        msg('user', 'do it'),
        msg('user', '$ git log --oneline\ne9e2e87 fix: add validation\n2c784f3 prior commit'),
      ],
    );
    expect(issues.find((i) => i.match === 'e9e2e87')).toBeUndefined();
  });

  it('ignores SHA-shaped hex without a git/commit context nearby', () => {
    const issues = checkUnverifiedClaims(
      'The hex color #abcdef12 is a nice shade. The temperature is 1234567 kelvin.',
      [],
    );
    // No git context near these hex strings → no issue
    expect(issues.filter((i) => i.rule === 'unverified-claims').length).toBe(0);
  });

  it('flags an unbacked success claim ("pushed to origin/main") with no tool evidence', () => {
    const issues = checkUnverifiedClaims('Done — commits are pushed to origin/main.', [
      msg('user', 'please commit the fix'),
    ]);
    expect(issues.some((i) => i.message.includes('operational success'))).toBe(true);
  });

  it('does NOT flag an unbacked success claim if a prior message shows git output', () => {
    const issues = checkUnverifiedClaims('Done — commits are pushed to origin/main.', [
      msg('user', 'commit it'),
      msg(
        'user',
        '$ git push origin main\nTo github.com:foo/bar.git\n   abc1234..def5678  main -> main',
      ),
    ]);
    expect(issues.some((i) => i.message.includes('operational success'))).toBe(false);
  });

  it('flags ✅ Complete claim without backing', () => {
    const issues = checkUnverifiedClaims('✅ Complete! All systems go.', [
      msg('user', 'do the thing'),
    ]);
    expect(issues.some((i) => i.message.includes('operational success'))).toBe(true);
  });

  it('flags multiple unverified SHAs independently', () => {
    const issues = checkUnverifiedClaims('Commits e9e2e87 and e65fd4e are pushed.', [
      msg('user', 'commit'),
    ]);
    const matched = new Set(issues.map((i) => i.match));
    expect(matched.has('e9e2e87')).toBe(true);
    expect(matched.has('e65fd4e')).toBe(true);
  });
});

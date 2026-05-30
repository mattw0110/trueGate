# Verification and Self-Healing

How to know a change is actually done — and what to do when one of
the checks fails. Referenced from `data/governance.md`.

## The verification loop

Run these **in order** before claiming any change is complete:

1. **Typecheck** — zero errors.
2. **Lint** — zero errors. Warnings reviewed; new warnings explained.
3. **Tests covering the change** — green.

All three must pass. "Two out of three" is not done.

## Stack-specific commands

### TypeScript

```bash
tsc --noEmit            # or: npm run typecheck
eslint .                # or: npm run lint
vitest run <pattern>    # or: jest <pattern>
```

### Python

```bash
mypy --strict app/      # or: project's mypy script
ruff check .            # or: ruff check --fix .
pytest tests/<path>
```

If the project defines `npm run check`, `make check`, or similar, use
that — it usually wires up all three.

## Self-healing protocol

When verification fails, **don't report the failure as the answer.**
Read the error, fix the cause, re-run. Specifically:

### Typecheck fails

1. Read the full error message (file:line:col, expected vs actual).
2. Identify whether the type is wrong or the code is wrong. Usually the
   code is wrong — the type was telling you something true.
3. Fix the code. Re-run.
4. If the same error reappears in a different shape, the root cause is
   elsewhere — widen the search.

### Lint fails

1. Try auto-fix first: `eslint --fix .` or `ruff check --fix .`.
2. For rules that aren't auto-fixable, read the rule docs and fix by
   hand.
3. Never disable the rule to make it pass.

### A test fails

1. Read the assertion. What value was expected? What did it get?
2. Reproduce mentally: which code path produced the actual value?
3. Fix the cause — almost always the production code, not the test.
4. Only edit the test when it is provably wrong (testing yesterday's
   behaviour, asserting an irrelevant detail). Explain the change.
5. Re-run the full test file, not just the one test, before moving on.

### The three-attempt cap

If you fix and re-run the same failure three times and it still fails,
**stop**. Report to the operator:

- The exact error (last seen).
- What you tried each attempt and what changed.
- Your best hypothesis for the root cause.

Don't loop indefinitely. Don't disable the check. Don't ship the failure.

## "Looks right to me" is not verification

Common failure modes when skipping the loop:

- A type assertion (`as Foo`, `cast(Foo, x)`) hid the real issue. The
  code compiles but explodes at runtime.
- A lint warning ("variable assigned but never used") was actually
  pointing at a missing call.
- A test asserts on a stub'd value and would pass even if the function
  did nothing.
- A test in an adjacent module covers the function but not the path the
  change touches.

Run the full loop. Read the output. Don't trust intuition over the tool.

## Preflight checklist

Before reporting **done** (adapted from trueCreate's deploy-preflight):

- [ ] Working tree clean _or_ staged changes match the described scope.
- [ ] Typecheck: zero errors.
- [ ] Lint: zero errors.
- [ ] Tests: all green; new tests added for new behaviour.
- [ ] No secrets, API keys, tokens, or private hostnames committed.
- [ ] No debug leftovers (`console.log`, bare `print`, `debugger`,
      `import pdb`).
- [ ] No `TODO` without an owner: `// TODO(name):` or `# TODO(name):`.
- [ ] No new files exceed 200 lines without a reason.
- [ ] Documentation updated when behaviour changed visibly.

If a box is unchecked, the change is not done. Fix and re-run the loop.

## When verification can't run

If the tool literally isn't available (no Node installed, no Python
env), say so explicitly: "I cannot verify; here's what I'd run." Don't
imply the check passed.

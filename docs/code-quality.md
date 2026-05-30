# Code Quality Floor

The code-quality guidance from `data/governance.md`, expanded.

## Naming

Names are the highest-leverage form of documentation. Get them right.

- **Functions are verbs**: `parseConfig`, `loadUser`, `compileRules`,
  `dispatchEvent`. The verb describes what the function does to the
  arguments.
- **Classes are nouns**: `UserService`, `RuleEngine`, `RequestContext`.
  A class name should answer "what is this thing?", not "what does
  this thing do?".
- **Booleans are predicates**: `isReady`, `hasParent`, `canEdit`,
  `shouldRetry`. Reading the code aloud should sound like a sentence:
  `if (user.isReady) ...`.
- **Plurals for collections**: `users` is a list; `user` is one.
- **Avoid abbreviations**: `config`, not `cfg`. `request`, not `req`,
  except where it's standard (`req`, `res` in Express handlers).
- **Avoid `data`, `info`, `obj`, `manager`, `helper`**: these are
  type-shaped, not meaning-shaped. Name the thing.
- **Match the domain language**: if the product calls it a "workspace",
  call it `workspace` in code. Don't translate.

## Comments

Comments explain **why**, not what. The code shows what.

```ts
// WRONG: explains what
// Increment counter by 1.
counter += 1;

// RIGHT: explains why
// Retry budget is per-minute; reset on the next tick.
counter += 1;
```

Banned forms:

- Restating the code in English.
- Outdated comments left in after a refactor.
- `// TODO: fix this` with no owner.
- Section banners (`// ====== USER STUFF ======`) — if a region needs a
  banner, split the file.

Encouraged forms:

- Why a non-obvious algorithm was chosen.
- Links to a ticket explaining an unusual constraint.
- A one-line justification next to an escape hatch (`any`, `# type: ignore`).

## Error handling

- **Errors surface at module boundaries.** Inside a module, let them
  propagate. At the boundary (HTTP handler, CLI entry point,
  background-worker run loop), catch and translate.
- **No silent fallbacks.** A `catch` that returns a default value
  without logging is hiding a bug. If a fallback is intentional, log
  the cause.
- **Throw `Error` subclasses, not strings.** `throw new ConfigError(...)`,
  not `throw 'bad config'`.
- **Wrap with cause** when re-throwing: `throw new MyError('msg', { cause: e })`
  in JS; `raise MyError('msg') from e` in Python.
- **`except Exception: pass` is banned.** So is `catch (e) {}`.

## Silent fallbacks — examples

```ts
// WRONG: swallows the parse failure, returns empty.
try {
  return JSON.parse(input);
} catch {
  return {};
}

// RIGHT: surface or wrap.
return JSON.parse(input);
// or, if a fallback IS the contract:
try {
  return JSON.parse(input);
} catch (e) {
  logger.warn('invalid_config_json', { cause: e });
  return DEFAULT_CONFIG;
}
```

## Debug leftovers

These belong in your editor, never in commits:

- `console.log`, `console.dir`, `console.trace`
- `print(...)`, `pprint(...)`, `pp(...)`
- `debugger;`, `import pdb; pdb.set_trace()`, `breakpoint()`
- `dump(...)` helpers

If you legitimately need diagnostics in production, use the project's
logger with a meaningful event name.

## One env-access module per project

A single module reads `process.env` / `os.environ`, validates types,
and exports a typed `config` object. Everything else imports from there.

Why: env access scattered across the codebase makes it impossible to
know what the program depends on, prevents typing, and lets typos in
variable names ship to production.

## Size limits (soft)

- **Files ≤ 200 lines.** If you breach this, the file is doing too
  much. Split by responsibility.
- **Functions ≤ 50 lines.** Same logic. Pull subroutines.

These are soft caps — exceed them when there's a real reason (a long
flat list of static data, a state machine that genuinely fits in one
function). Don't exceed them by accident.

## Anti-patterns

- **Type-cast-to-pass.** `as any`, `cast(Any, x)`, `@ts-ignore` to make
  the compiler stop complaining without understanding why.
- **Catch-and-ignore.** Hides the bug for weeks.
- **Hand-rolled validation** when a schema library would do it.
- **Reaching past a library's public API** — fork it or open a PR.
- **Cleanup commits** that mix refactor with behaviour change.
- **Disabled tests** to make the suite green.
- **Config flags for unimplemented behaviour** — implement first.
- **Copy-paste to avoid a small refactor** — extract the function.
- **God modules** — one file that everyone imports from.
- **Unused exports** — if nothing imports it, delete it.

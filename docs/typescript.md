# TypeScript Standards

The TypeScript-specific guidance referenced from `data/governance.md`.

## Strict mode is non-negotiable

Every TypeScript project must have these in `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
  },
}
```

`strict` alone is the minimum. The other flags catch real bugs that
`strict` lets through (e.g. an array access returning `T` when it
should be `T | undefined`).

## The `any` policy

**No `any`. Ever — unless justified by a one-line comment.**

When `any` is unavoidable (a third-party library with no types,
deserializing wire data before validation), add a comment naming the
reason on the same or preceding line:

```ts
// any: legacy `vendor-sdk` ships no types; PR open at vendor#421
const client: any = require('vendor-sdk');
```

Prefer in this order:

1. A real type (write it if missing).
2. `unknown` plus a narrow at the boundary (`zod`, a type predicate).
3. A generic with a constraint.
4. `any` with a justifying comment — last resort.

## Suppression directives

- `@ts-ignore` — banned. Fix the type.
- `@ts-expect-error` — allowed only with a comment explaining why and
  what the expected error is. The validator warns on bare uses.
- `@ts-nocheck` — banned. Never in committed code.
- `eslint-disable` — banned by default. Disable a single rule on a
  single line with a `// eslint-disable-next-line <rule> -- reason`
  comment when there is a real reason.

## Naming

- Functions are verbs: `parseConfig`, `loadUser`, `compileRules`.
- Classes are nouns: `UserService`, `RuleEngine`, `RequestContext`.
- Booleans are predicates: `isReady`, `hasParent`, `canEdit`,
  `shouldRetry`.
- Types and interfaces are PascalCase nouns: `UserRecord`, `ConfigShape`.
- Generics are descriptive when they carry meaning: `TRow`, `TKey`, not
  `T1`, `T2`. Single letters are fine for truly generic positions.

## File layout

- Tests sit next to source: `foo.ts` + `foo.test.ts`.
- One primary export per file. Co-located helpers are fine; they don't
  need their own file unless reused.
- Barrel `index.ts` files are allowed only at package boundaries — not
  inside a package, where they hurt tree-shaking and circular-import
  diagnostics.
- Module paths use the package's own alias (`@/lib/...`) or a relative
  path. Don't mix the two within one file.

## Tooling

- Type check: `tsc --noEmit` (or the project's `typecheck` script).
- Lint: `eslint .` with `@typescript-eslint/recommended-type-checked`.
- Tests: `vitest run` or `jest --runInBand` per the project; tests must
  run typed (no `// @ts-ignore` to silence test types).
- Format: `prettier --check .` in CI; `prettier --write .` locally.

## Common mistakes to avoid

- `as SomeType` to satisfy the compiler when the value isn't that type.
  Cast at boundaries after validation; don't cast to hide a bug.
- `as any` followed by a property access — the type system will not save
  you and you've lost autocomplete.
- `Record<string, unknown>` everywhere instead of a real interface.
- `Function` as a type — use a specific signature.
- `Object` / `object` / `{}` when you mean "any non-null thing" —
  prefer `unknown` and narrow.
- Throwing strings (`throw 'bad'`). Always throw `Error` subclasses.
- `Promise<void>` returned from a function that should return the
  awaited value, so callers can't act on it.
- Optional chaining (`a?.b?.c`) to mask a real "this should exist" bug
  — find the missing setup instead.

## Errors

- Define a small set of error classes per package: `ConfigError`,
  `ValidationError`, etc. Don't re-derive `Error` ad hoc inline.
- Throw at the boundary; let callers catch where they have context.
- Never `catch (e) {}` — at minimum, re-throw or log with the cause.

## Async

- `async` functions return `Promise<T>`; never `Promise<any>`.
- Don't mix `.then(...)` and `await` in the same function.
- Always `await` or explicitly `void` a floating promise.
  ESLint rule: `@typescript-eslint/no-floating-promises`.

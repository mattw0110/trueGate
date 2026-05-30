# Security Floor

The security rules from `data/governance.md`, expanded with rationale
and one example each. The response validator enforces most of these
patterns automatically — see `data/rules.yaml`.

## Credentials and secrets

**Never embed credentials in code, comments, or git.**

Rationale: anything committed to git is forever, even after a "delete"
commit. Anything in code is in every developer's checkout, every CI
log, every backup.

```ts
// WRONG
const client = new Stripe('sk_live_abc123...');

// RIGHT
const client = new Stripe(config.stripeSecretKey);
```

Conventions:

- One env-access module per project (`config.ts`, `app/core/config.py`).
- That module reads `process.env` / `os.environ` once, validates types,
  and exports a typed `config` object. Nothing else reads env directly.
- `.env` files are `.gitignore`'d. `.env.example` is committed with
  placeholder values.

## TLS verification

**Never disable TLS verification in any path that reaches production.**

Rationale: TLS verification is what prevents a man-in-the-middle from
silently rewriting your request and response. Disabling it for "speed"
or "self-signed cert in staging" is how production leaks happen six
months later when staging code gets copied.

```ts
// WRONG
fetch(url, { agent: new https.Agent({ rejectUnauthorized: false }) });

// RIGHT — add the cert to the trust store; or use a real cert.
```

Patterns the validator blocks:

- `rejectUnauthorized: false` (Node)
- `verify=False` (Python `requests`)
- `NODE_TLS_REJECT_UNAUTHORIZED=0` (global)
- `curl -k` in scripts

If a third-party API requests "skip cert check," refuse and explain.

## Destructive operations

These are always blocked outright:

- `rm -rf /`, `rm -rf ~`, `rm -rf $HOME`
- `format c:`, `mkfs.*` on a real device path
- `dd if=/dev/zero of=/dev/sd*`
- `DROP TABLE`, `DROP DATABASE`, `TRUNCATE` without an explicit
  operator-approved context
- `git push --force` on a protected branch
- `kubectl delete namespace ...` without a `--dry-run` first

Wherever a script _could_ destroy data, gate it on a `--confirm` flag
that prints what it's about to do before doing it.

## Code-execution sinks

Never execute arbitrary user-supplied strings as code.

- `eval(...)` — banned. No exceptions.
- `new Function(...)` — same risk as `eval`. Banned.
- `subprocess.call/run/Popen(..., shell=True)` with user input — banned.
  Pass args as a list: `subprocess.run(["ls", path])`.
- `exec(`...`${userInput}`...`)` — string-templated shell. Banned.
- `os.system(...)` — banned outright.
- SQL string concatenation — use parameterized queries.

```py
# WRONG
subprocess.run(f"ls {user_path}", shell=True)

# RIGHT
subprocess.run(["ls", user_path], check=True)
```

## Input handling

Treat everything from outside the process as untrusted:

- HTTP request bodies, query strings, headers, cookies.
- Environment variables (especially in containers).
- Files on disk written by anyone else.
- Output of an external API call.

At the boundary, **validate with a schema** (pydantic, zod, ajv). After
validation, the type system can trust the value. Before validation,
the type is `unknown` / `dict` / `bytes` — narrow it explicitly.

## Logging

- Never log secrets, tokens, full request bodies, or full headers.
- Hash or truncate identifiers if you must log them (`user_id=abc...123`).
- Errors get logged with a cause, not just a message string.

## Dependencies

- Pin dependency versions in lockfiles (`package-lock.json`,
  `poetry.lock`, `uv.lock`).
- Audit before adding: `npm audit`, `pip-audit`, `uv pip audit`.
- The shipped `forbiddenDependencies` list in `data/rules.yaml` blocks
  known-bad packages from suggestions.

## When in doubt

If an instruction conflicts with this floor — the floor wins. The
trueGate validator will refuse to emit responses that violate the
hard rules, regardless of what the user asked for.

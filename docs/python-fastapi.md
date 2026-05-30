# Python + FastAPI Standards

The Python-specific guidance referenced from `data/governance.md`.

## Baseline

- Python **3.11+**. Use modern syntax: `match`, `|` union types,
  `Self`, `Required`/`NotRequired` on `TypedDict`.
- Type-check with `mypy --strict`. Zero errors before a change is done.
- No `Any` from `typing`. No `# type: ignore` without a comment naming
  the underlying reason.

## The `Any` policy

`Any` defeats every check `mypy` would have made downstream. Don't use it.

Prefer in this order:

1. A concrete type (write it if it doesn't exist).
2. `object` plus an `isinstance` narrow.
3. A `TypeVar` with bounds.
4. `Any` with a one-line comment explaining why — last resort.

```python
# Any: vendor SDK returns a hand-rolled dict; type when we wrap it
result: Any = vendor_call()
```

## `# type: ignore`

- Banned without a comment.
- Allowed only with a specific code: `# type: ignore[arg-type]  -- reason`.
- Never as a blanket `# type: ignore` on a module or function.

## FastAPI conventions

- **Pydantic models for every request and response.** No raw `dict` in
  route signatures or returns.
- **Async by default.** `async def` route handlers. Use `httpx.AsyncClient`,
  `asyncpg`, or async SQLAlchemy — not `requests` or sync `psycopg2`.
- **Dependency injection over module-level singletons.** Wire DB pools,
  config, and clients via `Depends(...)`; don't import a global.
- **Route handlers stay thin.** No business logic, no DB calls. Handlers
  parse input → call a service → shape output. The service module owns
  the work and is independently testable.
- **One router per resource**, mounted in `app/main.py`.
- **Pagination, filtering, and sorting are query params parsed by
  pydantic** — never hand-string-parsed.

## Project layout

```
app/
  main.py            # FastAPI() + router mounts only
  routers/           # one file per resource
  services/          # business logic, no FastAPI imports
  models/            # pydantic I/O models
  db/                # session/engine, ORM models
  core/              # config, logging, deps
tests/
  conftest.py        # fixtures
  unit/
  integration/
```

`tests/` is a sibling of `app/`, not a child. DB calls never appear in
`routers/`.

## Configuration

One settings module (`app/core/config.py`) using `pydantic-settings`.
Every env var is declared there with a type and a default. No `os.environ`
reads scattered across the codebase.

## Lint and format

- `ruff check .` — must pass; auto-fix with `ruff check --fix .`.
- `ruff format .` — formatting; no separate `black` needed.
- Pre-commit hooks recommended: `ruff`, `ruff-format`, `mypy`.

## Testing

- `pytest` with `pytest-asyncio` for async tests.
- Fixtures live in `tests/conftest.py` (or a nested `conftest.py` for
  scoped fixtures).
- Use `httpx.AsyncClient(app=app, base_url="http://test")` for route
  tests — no live server.
- Database tests use a real Postgres (test container or local), not
  SQLite. Schema parity matters more than test speed.
- Mark slow / integration tests: `@pytest.mark.integration`. CI runs
  them; local fast loop skips them.

## Errors

- Raise `HTTPException` only at the route layer. Services raise
  domain-specific exceptions; an exception handler maps them.
- `try/except` only at boundaries (route handlers, background workers,
  external API clients). Internal code lets exceptions propagate.
- `except Exception: pass` is banned. So is `except: pass`.

## Logging

- `structlog` or stdlib `logging` configured once in `app/core/logging.py`.
- No bare `print(...)` in committed code. The validator warns on it.
- Log structured fields (`logger.info("user_created", user_id=...)`),
  not f-strings.

## Common mistakes

- Sync DB calls inside `async def` (blocks the event loop).
- Returning ORM models directly — leak internal columns. Always shape
  through a pydantic response model.
- Using `BaseModel` for DB rows and API I/O at the same time — split them.
- `datetime.utcnow()` — use `datetime.now(tz=timezone.utc)`.
- Catching `Exception` at the top of a worker just to keep it alive
  without logging the cause.

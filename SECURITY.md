# Security Policy

## Reporting a vulnerability

If you believe you've found a security vulnerability in trueGate, please
**do not** open a public GitHub issue.

Instead, report it privately via one of these channels:

- **GitHub Security Advisories**: open a private advisory at
  https://github.com/mattw0110/trueGate/security/advisories/new
- **Email**: matthew.white011@gmail.com — include `[trueGate security]` in
  the subject line.

Please include:

- A clear description of the vulnerability and its impact.
- Steps to reproduce, ideally with a minimal proof-of-concept.
- The trueGate version (`truegate --version`) and your environment
  (Node.js version, OS).
- Whether the issue affects governance enforcement, response validation,
  credential handling, the proxy itself, or a bundled upstream integration.

## What to expect

- **Acknowledgement** within 72 hours of your report.
- **Initial assessment** within 7 days, including a severity estimate and
  whether we accept the report as a vulnerability.
- **Fix timeline** depends on severity: critical issues are prioritized;
  lower-severity issues are batched into regular releases.
- **Disclosure**: we'll coordinate a public disclosure date with you once
  a fix is available. By default we credit reporters in the release notes
  unless you ask to remain anonymous.

## Scope

In scope:

- The trueGate proxy server (`src/proxy/`)
- Governance loader and validator (`src/governance/`, `src/validators/`)
- The CLI (`src/cli/`)
- Bundled response-marker, tool-translation, and rules-engine logic

Out of scope:

- Upstream provider APIs (Anthropic, OpenAI, GitHub Copilot, Ollama, etc.)
  — report those to the upstream vendor.
- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) — report
  there directly; trueGate only routes to it.
- The developer IDE/client (Claude Code, Cursor, Continue.dev, etc.).
- Issues that require an already-compromised local machine (since
  trueGate runs locally with the operator's permissions).

## Hardening guidance

- Run trueGate as your own user; do not run it as root.
- Keep `.state/` outside any directory that gets backed up to a shared
  location (it stores provider credentials).
- Rotate provider tokens periodically; trueGate never stores them
  outside `.state/config.json` or the OS keychain mechanism used by
  CLIProxyAPI.
- Review `data/rules.yaml` and `.state/rules.yaml` before enabling
  new upstream models — the patterns there are your last line of
  defense against accidental credential or secret leakage.

Thank you for helping keep trueGate and its users safe.

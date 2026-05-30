import { join } from 'node:path';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { GOVERNANCE_FILE, RULES_FILE } from '../../config/constants.js';
import { stateDir } from '../../config/paths.js';

const DEFAULT_GLOBAL_GOVERNANCE_MD = `# Operator Governance — applies to EVERY project

This file lives in trueGate's own state directory (.state/governance.md inside
the trueGate repo) and is loaded on every request. Use it for rules you want
enforced everywhere, regardless of which repo trueGate is serving.

## Always

- Never generate destructive shell commands.
- Never embed credentials, API keys, or private hostnames in code.
- Never write secrets to files or environment variables.
- Treat all user input as untrusted.

## Style

- Prefer explicit, readable code over clever one-liners.
- Add error handling at module boundaries only — don't bury try/catch deep in business logic.

## Forbidden

- No \`eval()\`, \`Function()\`, or arbitrary code execution.
- No silent fallbacks that mask real errors.
`;

const DEFAULT_GLOBAL_RULES_YAML = `version: "1"

# These apply on TOP of every project's rules — they cannot be disabled
# by anything outside this trueGate repo.

forbiddenDependencies: []

forbiddenFrameworks: []

dangerousPatterns:
  - pattern: "process\\\\.env\\\\.\\\\w*SECRET"
    severity: block
    message: "Do not log or echo environment secrets"
  - pattern: "console\\\\.log\\\\(.*api[_-]?key"
    severity: block
    message: "Do not log API keys to console"

typescriptRules:
  noAny: true
  requireStrict: true
`;

export async function runGlobalInit(options: { force?: boolean }): Promise<void> {
  const dir = stateDir();
  const govPath = join(dir, GOVERNANCE_FILE);
  const rulesPath = join(dir, RULES_FILE);

  await mkdir(dir, { recursive: true });

  for (const [path, content, name] of [
    [govPath, DEFAULT_GLOBAL_GOVERNANCE_MD, GOVERNANCE_FILE],
    [rulesPath, DEFAULT_GLOBAL_RULES_YAML, RULES_FILE],
  ] as const) {
    const exists = await fileExists(path);
    if (exists && !options.force) {
      console.log(`  skip  .state/${name} (already exists; --force to overwrite)`);
      continue;
    }
    await writeFile(path, content, 'utf-8');
    console.log(`  ${exists ? 'overwrite' : 'create'}  .state/${name}`);
  }

  console.log();
  console.log(`Operator governance initialized at ${dir}`);
  console.log('These rules apply to every request trueGate serves.');
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

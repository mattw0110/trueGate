import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { TRUEGATE_DIR, GOVERNANCE_FILE, RULES_FILE } from '../../config/constants.js';

const DEFAULT_GLOBAL_GOVERNANCE_MD = `# Operator Governance — applies to EVERY project

This file is loaded from ~/.truegate/governance.md on every request, BEFORE
any per-project governance. Use it for rules you want enforced everywhere,
regardless of which repo trueGate is serving.

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
# by a project's local .truegate/rules.yaml.

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
  const dir = join(homedir(), TRUEGATE_DIR);
  const govPath = join(dir, GOVERNANCE_FILE);
  const rulesPath = join(dir, RULES_FILE);

  await mkdir(dir, { recursive: true });

  for (const [path, content, name] of [
    [govPath, DEFAULT_GLOBAL_GOVERNANCE_MD, GOVERNANCE_FILE],
    [rulesPath, DEFAULT_GLOBAL_RULES_YAML, RULES_FILE],
  ] as const) {
    const exists = await fileExists(path);
    if (exists && !options.force) {
      console.log(`  skip  ~/${TRUEGATE_DIR}/${name} (already exists; --force to overwrite)`);
      continue;
    }
    await writeFile(path, content, 'utf-8');
    console.log(`  ${exists ? 'overwrite' : 'create'}  ~/${TRUEGATE_DIR}/${name}`);
  }

  console.log();
  console.log('Global governance initialized at ~/.truegate/');
  console.log('These rules apply on top of every project trueGate serves.');
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

import { join } from 'node:path';
import { safeReadFile } from '../../utils/filesystem.js';
import { parseYaml, parseYamlWithSchema } from '../../utils/yaml.js';
import { splitFrontMatter } from '../../utils/markdown.js';
import { RulesYamlSchema } from '../schemas/rules-schema.js';
import { GovernanceFrontMatterSchema } from '../schemas/governance-schema.js';
import { GOVERNANCE_FILE, RULES_FILE } from '../../config/constants.js';
import { dataDir, stateDir } from '../../config/paths.js';
import type { GovernanceFile, GovernanceRuleRef } from '../../types/governance.js';

function findLine(lines: string[], needle: string): number | undefined {
  const idx = lines.findIndex((line) => line.includes(needle));
  return idx >= 0 ? idx + 1 : undefined;
}

interface ParsedDangerousPattern {
  id?: string | undefined;
  pattern: string;
  message?: string | undefined;
  severity?: 'warn' | 'block' | undefined;
}

interface ParsedRulesLike {
  forbiddenDependencies?: string[] | undefined;
  forbiddenFrameworks?: string[] | undefined;
  dangerousPatterns?: Array<string | ParsedDangerousPattern> | undefined;
  typescriptRules?: {
    noAny?: boolean | undefined;
    requireStrict?: boolean | undefined;
  } | undefined;
}

function normalizedDangerousPattern(entry: string | ParsedDangerousPattern): ParsedDangerousPattern {
  return typeof entry === 'string' ? { pattern: entry, severity: 'warn' } : entry;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function buildRuleRefs(yamlContent: string, rules: ParsedRulesLike | null): GovernanceRuleRef[] {
  if (!rules) return [];
  const lines = yamlContent.split('\n');
  const refs: GovernanceRuleRef[] = [];

  for (const dep of rules.forbiddenDependencies ?? []) {
    const line = findLine(lines, `- ${dep}`);
    if (line) refs.push({ id: `forbidden-dependency:${slug(dep)}`, rule: 'forbidden-dependencies', label: dep, line });
  }

  for (const framework of rules.forbiddenFrameworks ?? []) {
    const line = findLine(lines, `- ${framework}`);
    if (line) refs.push({ id: `forbidden-framework:${slug(framework)}`, rule: 'forbidden-frameworks', label: framework, line });
  }

  for (const rawPattern of rules.dangerousPatterns ?? []) {
    const pattern = normalizedDangerousPattern(rawPattern);
    const label = pattern.message ?? pattern.pattern;
    const line =
      (pattern.message ? findLine(lines, `message: ${JSON.stringify(pattern.message)}`) : undefined) ??
      (pattern.message ? findLine(lines, `message: '${pattern.message}'`) : undefined) ??
      findLine(lines, `pattern: ${JSON.stringify(pattern.pattern)}`) ??
      findLine(lines, `pattern: '${pattern.pattern}'`);
    if (line) refs.push({ id: pattern.id ?? `dangerous:${slug(label)}`, rule: 'dangerous-patterns', label, line });
  }

  const noAnyLine = findLine(lines, 'noAny:');
  if (noAnyLine) refs.push({ id: 'typescript:no-any', rule: 'typescript-rules', label: 'Use of `any` type detected — prefer explicit types', line: noAnyLine });
  const strictLine = findLine(lines, 'requireStrict:');
  if (strictLine) refs.push({ id: 'typescript:require-strict', rule: 'typescript-rules', label: 'tsconfig missing "strict": true — strict mode is required', line: strictLine });

  return refs;
}

/**
 * Load operator-wide governance. Resolution order:
 *
 *   1. `<repo>/.state/governance.md` + `<repo>/.state/rules.yaml`
 *      — operator customizations, populated by `truegate global-init`.
 *   2. `<repo>/data/governance.md` + `<repo>/data/rules.yaml`
 *      — shipped defaults, tracked in git.
 *
 * Per file, state wins if present; otherwise data is used. This lets the
 * operator override individual files without copying the whole bundle.
 *
 * trueGate is self-contained: nothing under `~/` is consulted.
 */
export async function loadGlobalContext(): Promise<GovernanceFile | null> {
  const dataPath = dataDir();
  const statePath = stateDir();
  const stateGovernancePath = join(statePath, GOVERNANCE_FILE);
  const dataGovernancePath = join(dataPath, GOVERNANCE_FILE);
  const stateRulesPath = join(statePath, RULES_FILE);
  const dataRulesPath = join(dataPath, RULES_FILE);

  const stateMdContent = await safeReadFile(stateGovernancePath);
  const dataMdContent = stateMdContent === null ? await safeReadFile(dataGovernancePath) : null;
  const mdContent = stateMdContent ?? dataMdContent;
  const governancePath =
    stateMdContent !== null ? stateGovernancePath : dataMdContent !== null ? dataGovernancePath : undefined;

  const stateYamlContent = await safeReadFile(stateRulesPath);
  const dataYamlContent = stateYamlContent === null ? await safeReadFile(dataRulesPath) : null;
  const yamlContent = stateYamlContent ?? dataYamlContent;
  const rulesPath =
    stateYamlContent !== null ? stateRulesPath : dataYamlContent !== null ? dataRulesPath : undefined;

  if (!mdContent && !yamlContent) return null;

  const { frontMatter, body } = mdContent
    ? splitFrontMatter(mdContent)
    : { frontMatter: null, body: '' };

  const parsedFrontMatter = frontMatter
    ? GovernanceFrontMatterSchema.safeParse(parseYaml(frontMatter)).data
    : undefined;

  const rules = yamlContent ? parseYamlWithSchema(yamlContent, RulesYamlSchema) : null;
  const ruleRefs = yamlContent ? buildRuleRefs(yamlContent, rules) : [];

  return {
    source: 'global',
    sourcePath: governancePath ?? rulesPath ?? dataPath,
    ...(rulesPath !== undefined ? { rulesPath } : {}),
    bundleSource:
      governancePath?.startsWith(statePath) || rulesPath?.startsWith(statePath)
        ? governancePath?.startsWith(dataPath) || rulesPath?.startsWith(dataPath)
          ? 'mixed'
          : '.state'
        : 'data',
    content: body || '',
    frontMatter: {
      ...(parsedFrontMatter ?? {}),
      ...(rules !== null ? { rules } : {}),
      ...(ruleRefs.length > 0 ? { ruleRefs } : {}),
    },
  };
}

import { join } from 'node:path';
import { safeReadFile } from '../../utils/filesystem.js';
import { parseYaml, parseYamlWithSchema } from '../../utils/yaml.js';
import { splitFrontMatter } from '../../utils/markdown.js';
import { RulesYamlSchema } from '../schemas/rules-schema.js';
import { GovernanceFrontMatterSchema } from '../schemas/governance-schema.js';
import { GOVERNANCE_FILE, RULES_FILE } from '../../config/constants.js';
import { dataDir, stateDir } from '../../config/paths.js';
import type { GovernanceFile } from '../../types/governance.js';

/**
 * Load operator-wide governance. Resolution order:
 *
 *   1. `<repo>/.state/governance.md` + `<repo>/.state/rules.yaml`
 *      — operator customizations, populated by `truegate kb-init` / `global-init`.
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

  const mdContent =
    (await safeReadFile(join(statePath, GOVERNANCE_FILE))) ??
    (await safeReadFile(join(dataPath, GOVERNANCE_FILE)));
  const yamlContent =
    (await safeReadFile(join(statePath, RULES_FILE))) ??
    (await safeReadFile(join(dataPath, RULES_FILE)));

  if (!mdContent && !yamlContent) return null;

  const { frontMatter, body } = mdContent
    ? splitFrontMatter(mdContent)
    : { frontMatter: null, body: '' };

  const parsedFrontMatter = frontMatter
    ? GovernanceFrontMatterSchema.safeParse(parseYaml(frontMatter)).data
    : undefined;

  const rules = yamlContent ? parseYamlWithSchema(yamlContent, RulesYamlSchema) : null;

  return {
    source: 'global',
    sourcePath: dataPath,
    content: body || '',
    frontMatter: {
      ...(parsedFrontMatter ?? {}),
      ...(rules !== null ? { rules } : {}),
    },
  };
}

import { homedir } from 'node:os';
import { join } from 'node:path';
import { safeReadFile } from '../../utils/filesystem.js';
import { parseYaml, parseYamlWithSchema } from '../../utils/yaml.js';
import { splitFrontMatter } from '../../utils/markdown.js';
import { RulesYamlSchema } from '../schemas/rules-schema.js';
import { GovernanceFrontMatterSchema } from '../schemas/governance-schema.js';
import { GOVERNANCE_FILE, RULES_FILE, TRUEGATE_DIR } from '../../config/constants.js';
import type { GovernanceFile } from '../../types/governance.js';

/**
 * Load operator-wide governance from `~/.truegate/governance.md` and
 * `~/.truegate/rules.yaml`. These ALWAYS apply, on top of whatever
 * per-project governance exists. Rules from global sources cannot be
 * disabled by a project — they layer ABOVE project rules.
 */
export async function loadGlobalContext(): Promise<GovernanceFile | null> {
  const dir = join(homedir(), TRUEGATE_DIR);
  const mdContent = await safeReadFile(join(dir, GOVERNANCE_FILE));
  const yamlContent = await safeReadFile(join(dir, RULES_FILE));

  if (!mdContent && !yamlContent) return null;

  const { frontMatter, body } = mdContent
    ? splitFrontMatter(mdContent)
    : { frontMatter: null, body: '' };

  const parsedFrontMatter = frontMatter
    ? GovernanceFrontMatterSchema.safeParse(parseYaml(frontMatter)).data
    : undefined;

  const rules = yamlContent ? parseYamlWithSchema(yamlContent, RulesYamlSchema) : null;

  const content = body || '';

  return {
    source: 'global',
    projectRoot: dir,
    content,
    frontMatter: {
      ...(parsedFrontMatter ?? {}),
      ...(rules !== null ? { rules } : {}),
    },
  };
}

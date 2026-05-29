import { join, dirname } from 'node:path';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { KB_TEMPLATES } from '../kb-templates.js';
import { stateDir } from '../../config/paths.js';

export interface KbInitOptions {
  force?: boolean;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function runKbInit(options: KbInitOptions): Promise<void> {
  // The knowledge base is operator-wide — it lives in trueGate's own state
  // directory (`<repo>/.state/`). trueGate is self-contained; nothing is
  // written outside the repo.
  const target = stateDir();
  const files = Object.entries(KB_TEMPLATES).sort(([a], [b]) => a.localeCompare(b));

  console.log(`Scaffolding trueGate knowledge base into ${target}\n`);

  let created = 0;
  let skipped = 0;
  for (const [rel, content] of files) {
    const full = join(target, rel);
    const exists = await fileExists(full);
    if (exists && !options.force) {
      console.log(`  skip       ${rel}`);
      skipped++;
      continue;
    }
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf-8');
    console.log(`  ${exists ? 'overwrite' : 'create   '} ${rel}`);
    created++;
  }

  console.log();
  console.log(`${created} files written, ${skipped} skipped.`);
  if (skipped > 0 && !options.force) {
    console.log('Use --force to overwrite existing files.');
  }
  console.log();
  console.log('Next steps:');
  console.log(`  1. Edit ${join(target, 'governance.md')} (your operator-wide index)`);
  console.log(`  2. Refine ${join(target, 'topics')}/* for your team's standards`);
  console.log('  3. Restart trueGate so the proxy picks up the new content');
}

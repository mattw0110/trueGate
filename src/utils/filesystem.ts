import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export async function safeReadRelative(
  projectRoot: string,
  relativePath: string,
): Promise<string | null> {
  return safeReadFile(join(projectRoot, relativePath));
}

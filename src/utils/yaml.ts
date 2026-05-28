import { parse } from 'yaml';
import { type ZodSchema } from 'zod';

export function parseYaml(content: string): unknown {
  return parse(content);
}

export function parseYamlWithSchema<T>(content: string, schema: ZodSchema<T>): T | null {
  try {
    const raw = parseYaml(content);
    const result = schema.safeParse(raw);
    if (!result.success) return null;
    return result.data;
  } catch {
    return null;
  }
}

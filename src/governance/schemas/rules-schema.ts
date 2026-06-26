import { z } from 'zod';

const RuleEntrySchema = z.object({
  id: z.string().optional(),
  pattern: z.string(),
  severity: z.enum(['warn', 'block']).default('warn'),
  message: z.string().optional(),
});

export const RulesYamlSchema = z.object({
  version: z.string().default('1'),
  forbiddenDependencies: z.array(z.string()).default([]),
  forbiddenFrameworks: z.array(z.string()).default([]),
  dangerousPatterns: z.array(z.union([z.string(), RuleEntrySchema])).default([]),
  typescriptRules: z
    .object({
      noAny: z.boolean().default(true),
      requireStrict: z.boolean().default(true),
    })
    .default({}),
});

export type RulesYaml = z.infer<typeof RulesYamlSchema>;

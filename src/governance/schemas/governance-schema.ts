import { z } from 'zod';

export const GovernanceFrontMatterSchema = z.object({
  title: z.string().optional(),
  version: z.string().optional(),
  priority: z.number().optional(),
  tags: z.array(z.string()).optional(),
});

export type GovernanceFrontMatter = z.infer<typeof GovernanceFrontMatterSchema>;

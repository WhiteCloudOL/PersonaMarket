import { z } from 'zod';
import { textSchema } from './common.js';

export const PersonaCurationSchema = z.strictObject({
  official: z.boolean(),
  featured: z.boolean(),
});

export const SetPersonaCurationSchema = PersonaCurationSchema.extend({
  expectedRevision: z.number().int().positive(),
  reason: textSchema(1, 2000).refine(
    (value) =>
      Array.from(value).every((character) => {
        const code = character.codePointAt(0);
        return code !== undefined && (code >= 32 || [9, 10, 13].includes(code)) && code !== 127;
      }),
    '理由不能包含控制字符',
  ),
  selfReviewConfirmed: z.boolean().default(false),
});

export type PersonaCuration = z.infer<typeof PersonaCurationSchema>;
export type SetPersonaCuration = z.infer<typeof SetPersonaCurationSchema>;

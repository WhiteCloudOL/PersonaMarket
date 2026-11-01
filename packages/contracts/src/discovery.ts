import { z } from 'zod';
import { IdSchema } from './common.js';
const count = z.number().int().nonnegative();
const taxonomy = z.strictObject({ id: IdSchema, name: z.string(), count });
const choice = z.strictObject({ value: z.string(), label: z.string(), count });
export const PublicFacetsResponseSchema = z.strictObject({
  data: z.strictObject({
    categories: z.array(taxonomy).max(100),
    tags: z.array(taxonomy).max(100),
    models: z.array(choice).max(100),
    platforms: z.strictObject({ maibot: count, astrbot: count }),
    origins: z.array(choice),
    policies: z.array(choice),
  }),
});
export type PublicFacets = z.infer<typeof PublicFacetsResponseSchema>['data'];

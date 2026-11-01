import { z } from 'zod';
import { MediaSettingsWriteSchema, MediaSettingsSchema } from '@personamarket/contracts';

// 允许编辑时保留空行，提交时忽略空行；域名规则仍复用业务契约
export const MediaSettingsFormSchema = MediaSettingsWriteSchema.extend({
  data: MediaSettingsSchema.extend({
    sourceDomains: z
      .array(z.string())
      .transform((domains) => domains.map((domain) => domain.trim()).filter(Boolean))
      .pipe(MediaSettingsSchema.shape.sourceDomains),
  }),
});

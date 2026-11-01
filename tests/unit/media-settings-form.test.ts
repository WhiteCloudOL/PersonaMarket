import { expect, it } from 'vitest';
import { defaultMediaSettings } from '@personamarket/contracts';
import { MediaSettingsFormSchema } from '../../apps/web/src/components/settings/media-settings-schema.js';
it('提交忽略域名空行并复用契约，理由保留原始首尾空白', () => {
  const reason = String.fromCharCode(10) + ' 原始依据 ' + String.fromCharCode(10);
  const result = MediaSettingsFormSchema.parse({
    data: { ...defaultMediaSettings, sourceDomains: ['', ' EXAMPLE.COM ', '   ', '例子.中国'] },
    reason,
  });
  expect(result.data.sourceDomains).toEqual(['example.com', '例子.中国']);
  expect(result.reason).toBe(reason);
});
it('空行清理不能放过重复或带路径的来源域', () => {
  for (const domains of [
    ['EXAMPLE.COM', '', 'example.com.'],
    ['', 'example.com/path'],
  ]) {
    expect(
      MediaSettingsFormSchema.safeParse({
        data: { ...defaultMediaSettings, sourceDomains: domains },
        reason: '核对边界',
      }).success,
    ).toBe(false);
  }
});

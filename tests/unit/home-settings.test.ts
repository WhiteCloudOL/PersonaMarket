import { expect, it } from 'vitest';
import {
  defaultHomeSettings,
  HomeSettingsSchema,
  HomeSettingsWriteSchema,
  PublicHomeSettingsResponseSchema,
  homeSettingsEtag,
} from '@personamarket/contracts';

it('首页设置保持当前默认布局，模块和导航只能从固定目录选择', () => {
  expect(HomeSettingsSchema.parse(defaultHomeSettings)).toEqual(defaultHomeSettings);
  const invalid = [
    { ...defaultHomeSettings, sections: defaultHomeSettings.sections.slice(1) },
    {
      ...defaultHomeSettings,
      sections: defaultHomeSettings.sections.map(() => ({ key: 'recent', enabled: true })),
    },
    { ...defaultHomeSettings, navigation: ['guides', 'guides'] },
    { ...defaultHomeSettings, navigation: ['javascript:alert(1)'] },
    { ...defaultHomeSettings, html: '<script>alert(1)</script>' },
    { ...defaultHomeSettings, heroNote: '不允许\n多行' },
    { ...defaultHomeSettings, heroNote: ' 首尾空格' },
    { ...defaultHomeSettings, featuredCount: 13 },
    { ...defaultHomeSettings, recentCount: 0 },
    { ...defaultHomeSettings, announcementCount: 6 },
  ];
  for (const value of invalid) expect(HomeSettingsSchema.safeParse(value).success).toBe(false);
  expect(
    HomeSettingsSchema.parse({
      ...defaultHomeSettings,
      sections: [...defaultHomeSettings.sections]
        .reverse()
        .map((row) => ({ ...row, enabled: false })),
      navigation: [],
      heroNote: '🌟'.repeat(200),
    }).navigation,
  ).toEqual([]);
});

it('保存需要具体理由，公开设置不会包含管理员资料或任意秘密', () => {
  expect(HomeSettingsWriteSchema.safeParse({ data: defaultHomeSettings }).success).toBe(false);
  expect(
    HomeSettingsWriteSchema.safeParse({ data: defaultHomeSettings, reason: ' ' }).success,
  ).toBe(false);
  expect(
    HomeSettingsWriteSchema.safeParse({ data: defaultHomeSettings, reason: '核对\u0000' }).success,
  ).toBe(false);
  expect(
    HomeSettingsWriteSchema.parse({ data: defaultHomeSettings, reason: ' 保留\n具体理由 ' }).reason,
  ).toBe(' 保留\n具体理由 ');
  expect(homeSettingsEtag(2)).toBe('"home-2"');
  expect(
    PublicHomeSettingsResponseSchema.safeParse({
      data: defaultHomeSettings,
      meta: { revision: 1, updatedBy: 'admin', password: 'secret' },
    }).success,
  ).toBe(false);
});

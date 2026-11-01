import { expect, it } from 'vitest';
import {
  MediaSettingsSchema,
  defaultMediaSettings,
  mediaSourceHostname,
} from '@personamarket/contracts';
import { assertMediaImage, assertMediaRemote, assertReadmeImages } from '@personamarket/server';

it('媒体默认策略保持现有预算，业务设置不能越过硬上限或写入存储配置', () => {
  expect(MediaSettingsSchema.parse(defaultMediaSettings)).toEqual(defaultMediaSettings);
  for (const data of [
    { ...defaultMediaSettings, maxImageKiB: 5121 },
    { ...defaultMediaSettings, maxImagesPerAccount: 101 },
    { ...defaultMediaSettings, maxReadmeImages: 21 },
    { ...defaultMediaSettings, maxStorageMiBPerAccount: 101 },
    { ...defaultMediaSettings, maxConcurrentImports: 4 },
    { ...defaultMediaSettings, storageRoot: '/another/storage' },
  ])
    expect(MediaSettingsSchema.safeParse(data).success).toBe(false);
});

it('README业务数量按实际图片语法计量，代码中的标记不占名额', () => {
  const url = 'asset://a96fa2ce-f1f8-43b2-a464-911065359d10';
  expect(() => assertReadmeImages('![同图1](' + url + ')\n![同图2](' + url + ')', 1)).toThrow(
    '当前上限',
  );
  expect(() => assertReadmeImages('```md\n![代码](' + url + ')\n```', 0)).not.toThrow();
  expect(() => assertReadmeImages('无图文字', 0)).not.toThrow();
});

it('来源域名规范化IDNA与尾点，拒绝地址、端口、通配和重复的实际域名', () => {
  expect(mediaSourceHostname('EXAMPLE.COM.')).toBe('example.com');
  expect(mediaSourceHostname('例子.中国')).toBe('xn--fsqu00a.xn--fiqs8s');
  for (const value of [
    'https://example.com',
    '*.example.com',
    'example.com/path',
    'example.com:443',
    '127.0.0.1',
    'example.com@other.test',
  ]) {
    expect(mediaSourceHostname(value)).toBeUndefined();
    expect(
      MediaSettingsSchema.safeParse({ ...defaultMediaSettings, sourceDomains: [value] }).success,
    ).toBe(false);
  }
  expect(
    MediaSettingsSchema.safeParse({
      ...defaultMediaSettings,
      sourceDomains: ['example.com', 'EXAMPLE.COM.'],
    }).success,
  ).toBe(false);
  expect(
    MediaSettingsSchema.safeParse({
      ...defaultMediaSettings,
      sourceDomains: ['例子.中国', 'xn--fsqu00a.xn--fiqs8s'],
    }).success,
  ).toBe(false);
});

it('本地与远程开关互相独立，原始字节大小在边界两侧有明确结果', () => {
  const settings = { ...defaultMediaSettings, maxImageKiB: 64 };
  expect(() => assertMediaImage(settings, 64 * 1024)).not.toThrow();
  expect(() => assertMediaImage(settings, 64 * 1024 + 1)).toThrow('大小限制');
  expect(() => assertMediaImage(settings, 0)).toThrow();
  expect(() => assertMediaImage(settings, Number.NaN)).toThrow();
  expect(() => assertMediaImage({ ...settings, uploadsEnabled: false }, 10)).toThrow('本地图片');
  expect(() => assertMediaImage({ ...settings, remoteImportsEnabled: false }, 10)).not.toThrow();
  expect(() =>
    assertMediaImage({ ...settings, uploadsEnabled: false }, 10, {
      kind: 'remote',
      urls: ['https://images.example.com/a.png'],
    }),
  ).not.toThrow();
  expect(() =>
    assertMediaRemote(
      { ...settings, remoteImportsEnabled: false },
      'https://images.example.com/a.png',
    ),
  ).toThrow('在线图片');
});

it('来源域精确匹配，子域和重定向链不能沿用其他域的许可', () => {
  const settings = { ...defaultMediaSettings, sourceDomains: ['EXAMPLE.COM.'] };
  expect(() => assertMediaRemote(settings, 'https://example.com/a.png')).not.toThrow();
  expect(() => assertMediaRemote(settings, 'https://sub.example.com/a.png')).toThrow('来源域');
  expect(() =>
    assertMediaImage(settings, 10, {
      kind: 'remote',
      urls: ['https://example.com/a.png', 'https://other.test/a.png'],
    }),
  ).toThrow('来源域');
  expect(() => assertMediaImage(settings, 10, { kind: 'remote', urls: [] })).toThrow();
  expect(() =>
    assertMediaRemote(defaultMediaSettings, 'https://images.example.com/a.png'),
  ).not.toThrow();
});

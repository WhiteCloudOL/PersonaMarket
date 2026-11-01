import { expect, it } from 'vitest';
import {
  normalizeImage,
  publicImageAddress,
  checkedImageUrl,
  markdownImages,
  assertReadmeImages,
} from '@personamarket/server';
import { fixturePng } from '../fixtures/image.js';
it('真实图片解码重编码移除元数据，并拒绝伪造、动画/SVG和超大输入', async () => {
  const image = await normalizeImage(fixturePng);
  expect(image.width).toBe(2);
  expect(image.height).toBe(1);
  expect(image.data.subarray(8, 12).toString()).toBe('WEBP');
  expect(image.data.includes(Buffer.from('private metadata'))).toBe(false);
  for (const value of [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    Buffer.from('not image'),
    Buffer.alloc(5242881),
  ])
    await expect(normalizeImage(value)).rejects.toThrow();
});
it('地址分类拒绝内网、保留地址、映射IPv6和非标准回环写法', () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.0.1',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '64:ff9b::7f00:1',
  ])
    expect(publicImageAddress(ip), ip).toBe(false);
  expect(publicImageAddress('93.184.216.34')).toBe(true);
  for (const url of [
    'http://example.com/a.png',
    'https://user:pw@example.com/a.png',
    'https://example.com:8443/a.png',
    'https://2130706433/a.png',
    'https://0x7f000001/a.png',
    'https://[::ffff:127.0.0.1]/a.png',
  ])
    expect(() => checkedImageUrl(url)).toThrow();
});
it('Markdown AST 同时处理直接和引用图片，拒绝外链与超量素材', () => {
  const id = '00000000-0000-4000-8000-000000000099';
  expect(
    markdownImages(`![图片](asset://${id})\n![第二图][ref]\n\n[ref]: asset://${id}`).ids,
  ).toEqual([id]);
  expect(() => assertReadmeImages('![外链](https://example.com/a.png)')).toThrow('先将');
  expect(() =>
    assertReadmeImages(Array.from({ length: 21 }, () => `![](asset://${id})`).join('\n')),
  ).toThrow('20');
});

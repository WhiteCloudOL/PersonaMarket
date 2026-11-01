import { expect, it } from 'vitest';
import { TransferSettingsSchema, defaultTransferSettings } from '@personamarket/contracts';
import { assertTransferImport } from '@personamarket/server';

it('只开放现有格式，大小配置可收紧但不能放宽固定上限', () => {
  expect(TransferSettingsSchema.parse(defaultTransferSettings)).toEqual(defaultTransferSettings);
  expect(
    TransferSettingsSchema.safeParse({
      ...defaultTransferSettings,
      importFormats: [],
      exportFormats: [],
    }).success,
  ).toBe(true);
  for (const data of [
    { ...defaultTransferSettings, importFormats: ['market-json', 'market-json'] },
    { ...defaultTransferSettings, maxImportFileKiB: 4097 },
    { ...defaultTransferSettings, maxImportArchiveMiB: 129 },
  ])
    expect(TransferSettingsSchema.safeParse(data).success).toBe(false);
});
it('原始上传大小区分文本与归档，边界字节准确', () => {
  const settings = { ...defaultTransferSettings, maxImportFileKiB: 64, maxImportArchiveMiB: 1 };
  expect(() => assertTransferImport(settings, 'market-json', 64 * 1024)).not.toThrow();
  expect(() => assertTransferImport(settings, 'market-json', 64 * 1024 + 1)).toThrow('大小限制');
  expect(() => assertTransferImport(settings, 'market-zip', 1024 * 1024)).not.toThrow();
  expect(() => assertTransferImport(settings, 'market-zip', 1024 * 1024 + 1)).toThrow('大小限制');
});
it('格式关闭阻止确认，历史未知大小只在原有完整预算下可继续', () => {
  expect(() =>
    assertTransferImport(defaultTransferSettings, 'market-json', 4 * 1024 * 1024 + 1),
  ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_FORMAT' }));
  expect(() => assertTransferImport(defaultTransferSettings, 'maibot-toml', null)).not.toThrow();
  expect(() =>
    assertTransferImport({ ...defaultTransferSettings, maxImportFileKiB: 64 }, 'maibot-toml', null),
  ).toThrow('重新选择文件');
  expect(() =>
    assertTransferImport({ ...defaultTransferSettings, importFormats: [] }, 'maibot-toml', 10),
  ).toThrow('关闭');
});

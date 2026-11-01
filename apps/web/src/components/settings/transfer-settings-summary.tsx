import type { TransferSettings } from '@personamarket/contracts';
export const transferFormatLabels: Record<string, string> = {
  'maibot-toml': 'MaiBot TOML',
  'astrbot-json': 'AstrBot JSON',
  'text-plain': 'TXT 文本',
  'text-markdown': 'Markdown',
  text: 'TXT 文本',
  markdown: 'Markdown',
  'market-json': '通用 JSON',
  'market-zip': '完整 ZIP 包',
};
export function TransferSettingsSummary({ value }: { value: TransferSettings }) {
  return (
    <dl className="grid min-w-0 gap-3 text-sm [overflow-wrap:anywhere]">
      <div>
        <dt className="font-medium">访客导出</dt>
        <dd className="text-muted-foreground">{value.guestExportsEnabled ? '允许' : '需要登录'}</dd>
      </div>
      <div>
        <dt className="font-medium">可用导入格式</dt>
        <dd className="text-muted-foreground">
          {value.importFormats.map((key) => transferFormatLabels[key]).join('、') || '全部关闭'}
        </dd>
      </div>
      <div>
        <dt className="font-medium">可用导出格式</dt>
        <dd className="text-muted-foreground">
          {value.exportFormats.map((key) => transferFormatLabels[key]).join('、') || '全部关闭'}
        </dd>
      </div>
      <div>
        <dt className="font-medium">导入大小上限</dt>
        <dd className="text-muted-foreground">
          文本和 JSON {value.maxImportFileKiB} KiB · ZIP {value.maxImportArchiveMiB} MiB
        </dd>
      </div>
    </dl>
  );
}

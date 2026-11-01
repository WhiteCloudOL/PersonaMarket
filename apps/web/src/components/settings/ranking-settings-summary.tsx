import type { RankingSettings } from '@personamarket/contracts';
export function RankingSettingsSummary({ value }: { value: RankingSettings }) {
  return (
    <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
      {[
        [
          '热门权重',
          `点赞 ${value.weights.likes} · 收藏 ${value.weights.favorites} · 导出 ${value.weights.exports}`,
        ],
        ['刷新周期', `${value.refreshMinutes} 分钟`],
        ['每榜展示上限', `${value.entryLimit} 项`],
        ['运营新作窗口', `首次公开后 ${value.newcomerWindowDays} 天`],
      ].map(([label, text]) => (
        <div key={label} className="min-w-0 [overflow-wrap:anywhere]">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="mt-1 text-foreground">{text}</dd>
        </div>
      ))}
    </dl>
  );
}

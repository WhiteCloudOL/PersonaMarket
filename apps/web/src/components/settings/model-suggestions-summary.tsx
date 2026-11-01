import type { ModelSuggestions } from '@personamarket/contracts';
import { Badge } from '@personamarket/ui/components/badge';

export function ModelSuggestionsSummary({ value }: { value: ModelSuggestions }) {
  if (!value.entries.length)
    return <p className="text-sm text-muted-foreground">暂无模型建议，作者可以自由填写</p>;
  return (
    <ol
      tabIndex={0}
      aria-label="模型建议内容"
      className="flex max-h-80 min-w-0 flex-col gap-3 overflow-y-auto overscroll-contain rounded-lg p-1 text-sm focus-visible:outline-2 focus-visible:outline-ring"
    >
      {value.entries.map((entry, index) => (
        <li
          key={entry.id}
          className="min-w-0 space-y-2 rounded-lg border p-3 [overflow-wrap:anywhere]"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0">
              {index + 1} · {entry.modelId || '未填写模型标识'}
            </span>
            <Badge variant={entry.enabled ? 'secondary' : 'outline'}>
              {entry.enabled ? '启用' : '停用'}
            </Badge>
          </div>
          {entry.note && <p className="text-muted-foreground">{entry.note}</p>}
        </li>
      ))}
    </ol>
  );
}

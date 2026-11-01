import type { MediaSettings } from '@personamarket/contracts';

export function MediaSettingsSummary({ value }: { value: MediaSettings }) {
  return (
    <dl className="grid min-w-0 gap-3 text-sm [overflow-wrap:anywhere]">
      <div>
        <dt className="font-medium">图片来源</dt>
        <dd className="text-muted-foreground">
          本地上传{value.uploadsEnabled ? '开放' : '关闭'} · 在线导入
          {value.remoteImportsEnabled ? '开放' : '关闭'}
        </dd>
      </div>
      <div>
        <dt className="font-medium">文件与账号预算</dt>
        <dd className="text-muted-foreground">
          原图 {value.maxImageKiB} KiB · 每账号 {value.maxImagesPerAccount} 张 /{' '}
          {value.maxStorageMiBPerAccount} MiB
        </dd>
      </div>
      <div>
        <dt className="font-medium">README 与在途任务</dt>
        <dd className="text-muted-foreground">
          新送审 README 最多 {value.maxReadmeImages} 张图片 · 排队和处理任务合计{' '}
          {value.maxConcurrentImports} 个
        </dd>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <dt className="font-medium">在线来源域</dt>
        {value.sourceDomains.length ? (
          <dd
            role="region"
            aria-label="允许的图片来源域"
            tabIndex={0}
            className="max-h-40 overflow-y-auto overscroll-contain rounded-lg text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ul className="flex flex-col gap-1">
              {value.sourceDomains.map((domain) => (
                <li key={domain}>{domain}</li>
              ))}
            </ul>
          </dd>
        ) : (
          <dd className="text-muted-foreground">不另限制域名，公网 HTTPS 与文件校验继续执行</dd>
        )}
      </div>
    </dl>
  );
}

import Link from 'next/link';
import type { OwnReport } from '@personamarket/contracts';
import { Badge } from '@personamarket/ui/components/badge';
import { buttonVariants } from '@personamarket/ui/components/button';
import { Avatar, AvatarImage, AvatarFallback } from '@personamarket/ui/components/avatar';
import { reportStatuses, reportReasons, reportTypes } from './labels';
import { announcementDate } from '../announcements/announcement-content';

export function ReportEvidence({ report, mode }: { report: OwnReport; mode: 'own' | 'admin' }) {
  const snapshot = report.snapshot;
  return (
    <section
      aria-label="举报内容快照"
      className="flex min-w-0 flex-col gap-4 [overflow-wrap:anywhere]"
    >
      <div className="flex flex-wrap gap-2">
        <Badge>{reportStatuses[report.status]}</Badge>
        <Badge variant="outline">{reportTypes[report.type]}</Badge>
        <Badge variant="outline">{reportReasons[report.reason]}</Badge>
      </div>
      <h2 className="text-xl font-semibold">{report.personaTitle}</h2>
      {snapshot.type === 'profile' ? (
        <div className="flex min-w-0 items-start gap-4">
          <Avatar className="size-20 shrink-0">
            {snapshot.profile.content.avatarAssetId && (
              <AvatarImage
                width={80}
                height={80}
                src={
                  '/api/v1/' +
                  (mode === 'admin' ? 'admin' : 'me') +
                  '/reports/' +
                  report.id +
                  '/avatar'
                }
                alt="举报提交时的获批头像"
              />
            )}
            <AvatarFallback>{Array.from(snapshot.title).slice(0, 2).join('')}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-3">
            <p className="whitespace-pre-wrap text-base leading-7">
              {snapshot.profile.content.bio || '未填写公开简介'}
            </p>
            {snapshot.profile.content.links.map((link) => (
              <a
                key={link.url}
                className="flex min-h-11 items-center text-primary underline [overflow-wrap:anywhere]"
                href={link.url}
                target="_blank"
                rel="noopener noreferrer nofollow ugc"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">{snapshot.summary}</p>
      )}
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">公开作者</dt>
        <dd>{snapshot.author.username}</dd>
        <dt className="text-muted-foreground">
          {snapshot.type === 'profile' ? '资料快照' : '关联版本'}
        </dt>
        <dd>
          {snapshot.type === 'profile' ? (
            snapshot.profile.submissionId
          ) : (
            <>
              v{snapshot.version} · {snapshot.platform === 'maibot' ? 'MaiBot' : 'AstrBot'}
            </>
          )}
        </dd>
        <dt className="text-muted-foreground">提交时间</dt>
        <dd>
          <time dateTime={report.createdAt}>{announcementDate(report.createdAt)}</time>
        </dd>
        <dt className="text-muted-foreground">举报编号</dt>
        <dd>{report.id}</dd>
        <dt className="text-muted-foreground">当前修订</dt>
        <dd>{report.revision}</dd>
      </dl>
      {snapshot.type === 'comment' && (
        <div className="flex flex-col gap-2 rounded-xl border p-4">
          <h3 className="font-medium">提交时的获批评论</h3>
          <p className="whitespace-pre-wrap text-base leading-7">{snapshot.comment.body}</p>
        </div>
      )}
      <div className="flex flex-col gap-2 rounded-xl border p-4">
        <h3 className="font-medium">私有补充说明</h3>
        <p className="whitespace-pre-wrap text-base leading-7">
          {report.details || '未填写补充说明'}
        </p>
      </div>
      {report.publicPath ? (
        <Link
          className={buttonVariants({ variant: 'outline', className: 'self-start' })}
          href={report.publicPath}
          target="_blank"
          rel="noopener noreferrer"
          prefetch={false}
        >
          查看当前可访问的公开内容
        </Link>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">
          目标暂不可公开访问，提交时的内容快照仍保留
        </p>
      )}
    </section>
  );
}

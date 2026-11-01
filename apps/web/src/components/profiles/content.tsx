import type { ProfileContent } from '@personamarket/contracts';
import type { ReactNode } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@personamarket/ui/components/avatar';

export const profileStatuses = {
  PENDING: '等待审核',
  APPROVED: '审核通过',
  REJECTED: '需要调整',
  WITHDRAWN: '已撤回',
} as const;
export function ProfileContentView({
  content,
  avatarSrc,
  children,
}: {
  content: ProfileContent;
  avatarSrc?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-5 [overflow-wrap:anywhere]">
      <div className="flex min-w-0 items-center gap-4">
        <Avatar className="size-20 shrink-0">
          {avatarSrc && (
            <AvatarImage
              src={avatarSrc}
              alt={content.displayName + '的头像'}
              width={80}
              height={80}
            />
          )}
          <AvatarFallback>{Array.from(content.displayName).slice(0, 2).join('')}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          {children ?? <p className="text-xl font-semibold">{content.displayName}</p>}
        </div>
      </div>
      <p className="whitespace-pre-wrap text-base leading-7">
        {content.bio || '这位创作者还没有填写简介'}
      </p>
      {content.links.length > 0 && (
        <ul className="flex min-w-0 flex-col gap-1">
          {content.links.map((link) => (
            <li key={link.url}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer nofollow ugc"
                className="flex min-h-11 items-center text-primary underline underline-offset-4"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

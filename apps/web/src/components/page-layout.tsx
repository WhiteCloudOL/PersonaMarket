import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@personamarket/ui/lib/utils';

export function PageContainer({
  className,
  size = 'wide',
  ...props
}: ComponentProps<'main'> & { size?: 'wide' | 'content' | 'reading' }) {
  return (
    <main
      id="main"
      tabIndex={-1}
      className={cn(
        'mx-auto flex w-full min-w-0 flex-1 flex-col gap-6 px-4 py-6 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring sm:gap-8 sm:px-6 lg:px-8 lg:py-8',
        { wide: 'max-w-[86rem]', content: 'max-w-6xl', reading: 'max-w-4xl' }[size],
        className,
      )}
      {...props}
    />
  );
}

export function PageIntro({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-5 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && <p className="mb-2 text-sm font-medium text-primary">{eyebrow}</p>}
        <h1 className="break-words text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
          {title}
        </h1>
        {description && (
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

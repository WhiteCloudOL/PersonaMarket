import { BotIcon, SparklesIcon } from 'lucide-react';
import { cn } from '@personamarket/ui/lib/utils';

export function PlatformArtwork({
  platform,
  className,
}: {
  platform: 'maibot' | 'astrbot';
  className?: string;
}) {
  const Icon = platform === 'maibot' ? BotIcon : SparklesIcon;
  return (
    <svg
      viewBox="0 0 144 144"
      fill="none"
      aria-hidden="true"
      className={cn('w-full', platform === 'maibot' ? 'text-maibot' : 'text-astrbot', className)}
    >
      <circle cx="72" cy="76" r="57" fill="currentColor" opacity="0.08" />
      <circle cx="72" cy="76" r="46" stroke="currentColor" strokeDasharray="2 7" opacity="0.2" />
      <path
        d="M20 105Q72 133 123 98"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.25"
      />
      <Icon x="35" y="38" size="74" strokeWidth="1.4" />
      <path
        d="m118 28 2.5 7.5L128 38l-7.5 2.5L118 48l-2.5-7.5L108 38l7.5-2.5Z"
        fill="currentColor"
        opacity="0.65"
      />
      <circle cx="29" cy="38" r="4" fill="currentColor" opacity="0.2" />
      <circle cx="116" cy="112" r="3" fill="currentColor" opacity="0.35" />
    </svg>
  );
}

export function StorybookArtwork({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 160 128"
      fill="none"
      aria-hidden="true"
      className={cn('w-full text-primary', className)}
    >
      <circle cx="80" cy="67" r="52" fill="currentColor" opacity="0.08" />
      <path
        d="M23 38q28-12 57 3 29-15 57-3v59q-28-12-57 3-29-15-57-3Z"
        fill="var(--card)"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M80 41v59M35 53q16-5 32 2M35 65q16-5 32 2M35 77q16-5 24 0M93 55q16-7 32-2M93 67q16-7 32-2M93 79q12-5 24-3"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.4"
      />
      <path
        d="m121 13 3 9 9 3-9 3-3 9-3-9-9-3 9-3Z"
        fill="currentColor"
        className="text-highlight"
      />
      <path d="m35 17 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="currentColor" opacity="0.45" />
      <path
        d="M16 108q9-14-1-21-7 14 1 21Zm0 0q6-16 18-10-6 13-18 10Z"
        fill="currentColor"
        opacity="0.25"
      />
    </svg>
  );
}

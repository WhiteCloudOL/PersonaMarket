/** 原创星光书页标识，与站点二次元创作主题一致，不依赖位图或角色头像。 */
export function BrandMark({ className = 'size-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <rect x="2" y="2" width="44" height="44" rx="15" fill="var(--accent)" />
      <path
        d="M9 23c6-2 10 0 15 3 5-3 9-5 15-3v14c-6-2-11 0-15 3-4-3-9-5-15-3V23Z"
        fill="var(--card)"
        stroke="var(--primary)"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="M24 26v14M13 28l6 2m-6 3 6 2m10-5 6-2m-6 7 6-2"
        stroke="var(--primary)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="m25 7 2.4 6.6L34 16l-6.6 2.4L25 25l-2.4-6.6L16 16l6.6-2.4L25 7Z"
        fill="var(--primary)"
      />
      <path d="m37 7 1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" fill="var(--highlight)" />
    </svg>
  );
}

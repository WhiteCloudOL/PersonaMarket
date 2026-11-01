'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import {
  SearchIcon,
  PlusIcon,
  ArrowRightIcon,
  ShieldCheckIcon,
  LayersIcon,
  SparklesIcon,
} from 'lucide-react';
import { fetchPublicConfig } from '@personamarket/api-client';
import type { PublicConfigResponse } from '@personamarket/contracts';
import { buttonVariants } from '@personamarket/ui/components/button';
import { Badge } from '@personamarket/ui/components/badge';
import { FormNotice } from './auth/auth-fields';
import { HomeStatistics } from './home-statistics';
import type { PublicStatisticsResponseSchema } from '@personamarket/contracts';
import type { z } from 'zod';
export function HomeHero({
  initialData,
  statistics,
  homeNote,
}: {
  initialData: PublicConfigResponse | null;
  statistics: z.infer<typeof PublicStatisticsResponseSchema> | null;
  homeNote: string | null;
}) {
  const query = useQuery({
    queryKey: ['public', 'config'],
    ...(initialData ? { initialData } : {}),
    retry: 1,
    retryDelay: 1000,
    refetchOnWindowFocus: (query) => (query.state.status === 'error' ? 'always' : false),
    refetchOnReconnect: (query) => (query.state.status === 'error' ? 'always' : true),
    queryFn: ({ signal }) => fetchPublicConfig('', signal),
  });
  const name = query.data?.data.name ?? '清蒸云鸭·人设市场';
  const divider = name.indexOf('·');
  return (
    <section
      aria-label="站点介绍"
      className="relative isolate grid min-w-0 items-center overflow-hidden py-3 md:min-h-80 md:py-4"
    >
      <div className="relative z-10 flex min-w-0 flex-col items-start gap-4 pb-44 sm:pb-48 md:max-w-[60%] md:pb-0 lg:max-w-[58%]">
        <h1 className="max-w-full break-words text-[clamp(2rem,4vw,3.75rem)] leading-[1.18] font-extrabold tracking-tight text-balance">
          {divider > 0 ? (
            <>
              {name.slice(0, divider + 1)}
              <span className="relative inline-block max-w-full pb-2 text-primary">
                {name.slice(divider + 1)}
                <svg
                  aria-hidden="true"
                  viewBox="0 0 200 18"
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-4 w-full text-primary/25"
                  fill="none"
                >
                  <path
                    d="M3 13C50 3 132 2 195 9"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </>
          ) : (
            name
          )}
        </h1>
        <p className="max-w-xl break-words text-base leading-7 font-medium text-muted-foreground sm:text-lg">
          {query.data?.data.description ?? '创作、分享与发现 MaiBot 和 AstrBot 人设'}
        </p>
        {homeNote && (
          <p className="max-w-xl text-sm leading-7 text-muted-foreground [overflow-wrap:anywhere]">
            {homeNote}
          </p>
        )}
        <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-3 pt-1 sm:flex sm:w-auto sm:flex-wrap">
          <Link href="/explore" className={buttonVariants({ size: 'lg' })}>
            <SearchIcon data-icon="inline-start" />
            探索人设
            <ArrowRightIcon data-icon="inline-end" className="hidden sm:block" />
          </Link>
          <Link
            href="/dashboard/personas/new"
            className={buttonVariants({ variant: 'secondary', size: 'lg' })}
          >
            <PlusIcon data-icon="inline-start" />
            发布作品
          </Link>
        </div>
        <HomeStatistics initialData={statistics} />
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:gap-x-5">
          <Badge variant="outline">
            <SparklesIcon data-icon="inline-start" aria-hidden />
            双平台创作
          </Badge>
          <Badge variant="outline">
            <LayersIcon data-icon="inline-start" aria-hidden />
            私有草稿
          </Badge>
          <Badge variant="outline">
            <ShieldCheckIcon data-icon="inline-start" aria-hidden />
            审核发布
          </Badge>
        </div>
        {query.isError && <FormNotice error="站点介绍暂时无法更新，当前内容已保留" />}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-48 sm:h-56 md:inset-0 md:h-auto"
      >
        <Image
          src="/images/anime-home-panorama.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="home-hero-art object-cover object-[78%_center] md:object-top"
        />
      </div>
    </section>
  );
}

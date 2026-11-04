import type { ReactNode } from 'react';
import type { PublicGuide } from '@personamarket/contracts';
import Link from 'next/link';
import { buttonVariants } from '@personamarket/ui/components/button';
import { GuideBody } from '@/components/guides/guide-body';
import { guideSections } from '@/components/guides/guide-sections';
import { readPublicGuides } from '@/lib/public-guides';
import { ReloadButton } from '@/components/reload-button';

export const dynamic = 'force-dynamic';
import { pageMetadata } from '@/lib/public-seo';
import { PageContainer, PageIntro } from '@/components/page-layout';
import { GuideNavigation } from '@/components/guides/guide-navigation';
import { openSourceProjects } from '@/components/guides/open-source-projects';

export function generateMetadata() {
  return pageMetadata(
    '/guides',
    '使用指南',
    '按步骤了解 MaiBot 和 AstrBot 人设使用、创作、版本审核和文件导入',
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="py-8">
      <h2
        id={id}
        tabIndex={-1}
        className="mb-5 scroll-mt-40 text-xl font-semibold tracking-tight [overflow-wrap:anywhere] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        {title}
      </h2>
      <div className="flex min-w-0 flex-col gap-4 text-base leading-8 break-words [&_h3]:font-semibold [&_ol]:flex [&_ol]:list-decimal [&_ol]:flex-col [&_ol]:gap-3 [&_ol]:pl-6 [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-6 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-sm">
        {children}
      </div>
    </section>
  );
}

export default async function Page() {
  const result = await readPublicGuides();
  const items = new Map<string, PublicGuide>(result?.data.map((item) => [item.slug, item]) ?? []);
  const sections = guideSections
    .filter(({ id }) => id === 'license' || id === 'credits' || items.has(id))
    .map(({ id, title }) => ({ id, title: items.get(id)?.title ?? title }));
  return (
    <PageContainer size="content">
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-8">
        <GuideNavigation sections={sections} />
        <article
          aria-labelledby="guides-title"
          className="min-w-0 rounded-2xl border bg-card px-5 py-7 text-card-foreground sm:px-9 sm:py-10"
        >
          <header className="border-b pb-8">
            <PageIntro
              eyebrow="文档"
              title={<span id="guides-title">使用指南</span>}
              description="按步骤查找作品、创作人设、导入文件"
            />
            <p className="mt-5 text-sm leading-7 text-muted-foreground">
              第一次使用可从头阅读，也可以通过目录直接查看需要的章节
            </p>
          </header>
          <div className="divide-y">
            {!result ? (
              <div role="alert" className="flex flex-col items-start gap-4 py-8">
                <p>指南暂时无法读取，可以重新加载</p>
                <ReloadButton />
              </div>
            ) : result.data.length === 0 ? (
              <div className="flex flex-col items-start gap-4 py-8">
                <h2 className="text-xl font-semibold">指南正在整理</h2>
                <p className="text-muted-foreground">公开章节会在这里展示，可以稍后再来</p>
                <ReloadButton />
              </div>
            ) : (
              sections.map(({ id, title }) => {
                const item = items.get(id);
                if (!item) return null;
                return (
                  <Section key={id} id={id} title={title}>
                    <div data-guide-body={id}>
                      <GuideBody text={item.bodyMarkdown} />
                    </div>
                    <Link
                      href={'/guides/' + item.slug}
                      prefetch={false}
                      aria-label={'单独阅读本章：' + item.title}
                      className={buttonVariants({ variant: 'outline', className: 'self-start' })}
                    >
                      单独阅读本章
                    </Link>
                  </Section>
                );
              })
            )}
            <Section id="license" title="开源许可">
              <p>清蒸云鸭·人设市场的软件使用 AGPL-3.0 许可</p>
              <a
                href="https://github.com/WhiteCloudOL/PersonaMarket"
                className={buttonVariants({ variant: 'outline', className: 'self-start' })}
              >
                在 GitHub 查看项目源码
              </a>
              <p>
                用户发布的人设、图片和作品介绍由各自作者维护来源和转载声明，使用作品时以该作品的许可信息为准，软件许可不会自动改变用户作品的授权范围
              </p>
            </Section>
            <Section id="credits" title="开源致谢">
              <p>
                感谢开源社区的维护者和贡献者，清蒸云鸭·人设市场使用了以下项目，也受益于它们所依赖的众多开源组件
              </p>
              <dl className="divide-y">
                {openSourceProjects.map(({ name, href, purpose }) => (
                  <div
                    key={name}
                    className="py-3 sm:grid sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-5"
                  >
                    <dt className="font-medium">
                      <a
                        href={href}
                        className="inline-flex min-h-11 items-center text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                      >
                        {name}
                      </a>
                    </dt>
                    <dd className="flex min-h-11 items-center text-muted-foreground">{purpose}</dd>
                  </div>
                ))}
              </dl>
              <p>
                第三方项目保留各自的版权和许可证，完整依赖清单及许可说明随项目源码和运行镜像提供
              </p>
            </Section>
          </div>
        </article>
      </div>
    </PageContainer>
  );
}

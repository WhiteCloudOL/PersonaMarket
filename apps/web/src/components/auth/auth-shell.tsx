import Link from 'next/link';
import Image from 'next/image';
import { SparklesIcon, ArrowLeftIcon } from 'lucide-react';
import { PageContainer } from '@/components/page-layout';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@personamarket/ui/components/card';
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <PageContainer size="content" className="justify-center lg:py-12">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(23rem,1fr)] lg:gap-14">
        <aside className="hidden min-w-0 flex-col gap-5 lg:flex">
          <div className="flex flex-col gap-4">
            <span className="flex items-center gap-2 text-sm font-medium text-primary">
              <SparklesIcon className="size-4" aria-hidden />
              为灵感，留一个位置
            </span>
            <p className="text-4xl leading-snug font-bold tracking-tight">
              让喜欢的角色
              <br />
              走进日常对话
            </p>
            <p className="max-w-sm text-base leading-7 text-muted-foreground">
              在清蒸云鸭，发现鲜明的设定，也把自己的故事分享给更多人
            </p>
          </div>
          <div aria-hidden="true" className="auth-companion-art relative h-72 w-full">
            <Image
              src="/images/anime-account-library.png"
              alt=""
              fill
              sizes="480px"
              className="object-cover object-[center_30%]"
            />
          </div>
          <p className="text-sm font-medium text-primary">MaiBot · AstrBot · 让灵感成为角色</p>
        </aside>
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="gap-6 py-7 shadow-panel sm:py-9">
            <CardHeader>
              <CardTitle>
                <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
              </CardTitle>
              <CardDescription className="leading-7">{description}</CardDescription>
            </CardHeader>
            <CardContent>{children}</CardContent>
          </Card>
          <Link
            href="/"
            className="flex min-h-11 w-fit items-center gap-2 px-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            <ArrowLeftIcon className="size-4" aria-hidden />
            返回首页
          </Link>
        </div>
      </div>
    </PageContainer>
  );
}

import Link from 'next/link';
import { ArrowRightIcon, CheckCircle2Icon } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@personamarket/ui/components/card';
import { Badge } from '@personamarket/ui/components/badge';
import { buttonVariants } from '@personamarket/ui/components/button';
import { cn } from '@personamarket/ui/lib/utils';
import { PlatformArtwork } from './artwork';

const platforms = {
  maibot: {
    name: 'MaiBot',
    feature: '三段设定',
    description: '描绘角色的性格和表达',
    facts: ['自动保存私有草稿', '支持 TOML 片段导出'],
  },
  astrbot: {
    name: 'AstrBot',
    feature: '预设对话',
    description: '让角色在对话里鲜活起来',
    facts: ['按顺序编排预设对话', '支持原生 JSON 导出'],
  },
} as const;

export function HomePlatformCard({ platform }: { platform: keyof typeof platforms }) {
  const content = platforms[platform];
  return (
    <Card className="h-full gap-3 [--card-spacing:--spacing(4)]">
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-[1_1_8rem] flex-col items-start gap-2">
          <CardTitle>
            <h3 translate="no">{content.name}</h3>
          </CardTitle>
          <Badge variant="secondary">{content.feature}</Badge>
          <CardDescription>{content.description}</CardDescription>
        </div>
        <PlatformArtwork platform={platform} className="w-24 max-w-full shrink-0" />
      </CardHeader>
      <CardContent className="flex-1">
        <ul className="flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
          {content.facts.map((text) => (
            <li key={text} className="flex items-start gap-2">
              <CheckCircle2Icon
                aria-hidden
                className={cn(
                  'mt-1 size-4 shrink-0',
                  platform === 'maibot' ? 'text-maibot' : 'text-astrbot',
                )}
              />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        <Link
          href={'/explore?platform=' + platform}
          className={cn(
            buttonVariants({ variant: 'outline' }),
            'h-auto min-h-11 w-full py-2 whitespace-normal',
          )}
        >
          <span className="min-w-0 break-words">探索人设</span>
          <ArrowRightIcon data-icon="inline-end" aria-hidden />
        </Link>
      </CardFooter>
    </Card>
  );
}

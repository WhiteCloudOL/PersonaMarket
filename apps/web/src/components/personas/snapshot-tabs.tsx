'use client';
import { useState, type ReactNode } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@personamarket/ui/components/tabs';
/** 正文只有一个活动实例，避免切换过渡期间重复展示长内容和复制操作 */
export function SnapshotTabs({
  readme,
  content,
  origin,
  models,
}: {
  readme: ReactNode;
  content: ReactNode;
  origin: ReactNode;
  models: ReactNode;
}) {
  const [active, setActive] = useState(readme ? 'readme' : 'content');
  const selected = active === 'readme' && !readme ? 'content' : active;
  return (
    <Tabs
      value={selected}
      onValueChange={(value) => {
        if (typeof value === 'string') setActive(value);
      }}
      className="min-w-0 gap-5"
    >
      <TabsList className="w-full flex-wrap justify-start gap-1 rounded-xl border bg-card p-1.5 group-data-horizontal/tabs:h-auto">
        {readme && (
          <TabsTrigger
            value="readme"
            className="h-auto min-h-11 min-w-24 whitespace-normal px-3 py-2"
          >
            作品介绍
          </TabsTrigger>
        )}
        <TabsTrigger
          value="content"
          className="h-auto min-h-11 min-w-24 whitespace-normal px-3 py-2"
        >
          人设内容
        </TabsTrigger>
        <TabsTrigger
          value="origin"
          className="h-auto min-h-11 min-w-24 whitespace-normal px-3 py-2"
        >
          来源与许可
        </TabsTrigger>
      </TabsList>
      {readme && <TabsContent value="readme">{selected === 'readme' && readme}</TabsContent>}
      <TabsContent value="content">{selected === 'content' && content}</TabsContent>
      <TabsContent value="origin">{selected === 'origin' && origin}</TabsContent>
      {models}
    </Tabs>
  );
}

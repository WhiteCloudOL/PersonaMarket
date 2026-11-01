'use client';
import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@personamarket/ui/components/tabs';
import { useUserContentLocation } from './admin-user-content-navigation';
import { AdminUserPublicPersonas } from './admin-user-public-personas';
import { AdminUserReviewRecords } from './admin-user-review-records';

export function AdminUserContentTabs({
  accountId,
  id,
  children,
}: {
  accountId: string;
  id: string;
  children: ReactNode;
}) {
  const { search, update } = useUserContentLocation();
  const selected = search.get('userView');
  const view = selected === 'public' || selected === 'records' ? selected : 'management';
  return (
    <Tabs
      value={view}
      onValueChange={(value) => {
        if (value === 'management' || value === 'public' || value === 'records')
          update({ userView: value === 'management' ? null : value });
      }}
      className="min-w-0 gap-5"
    >
      <TabsList
        aria-label="用户详情分类"
        className="grid min-h-11 w-full grid-cols-3 group-data-horizontal/tabs:h-auto"
      >
        <TabsTrigger value="management" className="min-h-11 whitespace-normal">
          管理操作
        </TabsTrigger>
        <TabsTrigger value="public" className="min-h-11 whitespace-normal">
          公开作品
        </TabsTrigger>
        <TabsTrigger value="records" className="min-h-11 whitespace-normal">
          审核记录
        </TabsTrigger>
      </TabsList>
      <TabsContent value="management" keepMounted className="flex min-w-0 flex-col gap-6 text-base">
        {children}
      </TabsContent>
      <TabsContent value="public" className="min-w-0 text-base">
        <AdminUserPublicPersonas accountId={accountId} id={id} />
      </TabsContent>
      <TabsContent value="records" className="min-w-0 text-base">
        <AdminUserReviewRecords accountId={accountId} id={id} />
      </TabsContent>
    </Tabs>
  );
}

'use client';
import { useQuery } from '@tanstack/react-query';
import { publicTransferSettingsQuery } from '@/lib/transfer-settings-api';
import { Button } from '@personamarket/ui/components/button';
import { FormNotice } from '../auth/auth-fields';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@personamarket/ui/components/tabs';
import { ImportPersona } from './import-persona';
import { MarketImportWizard } from './market-import-wizard';
import { ManualImport } from './manual-import';

export function ImportWorkspace() {
  const policy = useQuery(publicTransferSettingsQuery);
  return (
    <>
      {policy.isPending && <p role="status">正在读取导入设置…</p>}
      <FormNotice error={policy.error} />
      {policy.isError && (
        <Button type="button" variant="outline" onClick={() => void policy.refetch()}>
          重新读取导入设置
        </Button>
      )}
      {policy.data && (
        <p role="status" className="mb-4 text-sm text-muted-foreground">
          {policy.data.data.importFormats.length
            ? `已启用 ${policy.data.data.importFormats.length} 种格式 · 文本和 JSON 最大 ${policy.data.data.maxImportFileKiB} KiB · ZIP 最大 ${policy.data.data.maxImportArchiveMiB} MiB`
            : '管理员已关闭全部导入格式，已有预览仍可查看和取消'}
        </p>
      )}
      <Tabs defaultValue="market" className="min-w-0 gap-6">
        <TabsList className="group-data-horizontal/tabs:h-auto min-h-11 max-w-full flex-wrap">
          <TabsTrigger value="market" className="min-h-11 px-4">
            通用 JSON / ZIP
          </TabsTrigger>
          <TabsTrigger value="native" className="min-h-11 px-4">
            平台原生文件
          </TabsTrigger>
          <TabsTrigger value="text" className="min-h-11 px-4">
            TXT / Markdown
          </TabsTrigger>
        </TabsList>
        <TabsContent value="market" keepMounted>
          <MarketImportWizard />
        </TabsContent>
        <TabsContent value="native" keepMounted>
          <ImportPersona />
        </TabsContent>
        <TabsContent value="text" keepMounted>
          <ManualImport />
        </TabsContent>
      </Tabs>
    </>
  );
}

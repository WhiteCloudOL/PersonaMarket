import { SettingsAccess } from './settings-navigation';
import { PageContainer, PageIntro } from '@/components/page-layout';
export function SettingsShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <PageContainer>
      <SettingsAccess>
        <div className="flex flex-col gap-6">
          <PageIntro eyebrow="管理后台 · 网站设置" title={title} description={description} />
          {children}
        </div>
      </SettingsAccess>
    </PageContainer>
  );
}

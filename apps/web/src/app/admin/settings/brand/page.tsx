import { SettingsShell } from '@/components/settings/settings-shell';
import { AdminBrandForm } from '@/components/auth/admin-brand-form';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@personamarket/ui/components/card';
export default function Page() {
  return (
    <SettingsShell title="站点品牌设置" description="管理首页显示的名称与简介">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>站点展示</h2>
          </CardTitle>
          <CardDescription>名称与简介会出现在首页和导航中</CardDescription>
        </CardHeader>
        <CardContent>
          <AdminBrandForm />
        </CardContent>
      </Card>
    </SettingsShell>
  );
}

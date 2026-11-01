'use client';
import { Button } from '@personamarket/ui/components/button';
import { PageContainer } from '@/components/page-layout';
import { Alert, AlertTitle, AlertDescription } from '@personamarket/ui/components/alert';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <PageContainer size="reading" className="items-start py-14">
      <Alert variant="destructive">
        <AlertTitle>
          <h1 className="text-xl font-semibold">暂时无法读取作品</h1>
        </AlertTitle>
        <AlertDescription>请稍后再试，或返回人设广场</AlertDescription>
      </Alert>
      <Button onClick={reset}>重新加载</Button>
    </PageContainer>
  );
}

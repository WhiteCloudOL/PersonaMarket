import { notFound } from 'next/navigation';
import { IdSchema } from '@personamarket/contracts';
import { PersonaEditor } from '@/components/personas/persona-editor';
import { PageContainer } from '@/components/page-layout';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!IdSchema.safeParse(id).success) notFound();
  return (
    <PageContainer>
      <PersonaEditor id={id} initialAction={query['createRelease'] === '1' ? 'release' : null} />
    </PageContainer>
  );
}

import { PublicDetail } from '@/components/personas/public-detail';
import { personaMetadata } from '@/lib/public-seo';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; releaseId: string }>;
}) {
  const { id, releaseId } = await params;
  return personaMetadata(id, releaseId);
}
export const dynamic = 'force-dynamic';
export default async function Page({
  params,
}: {
  params: Promise<{ id: string; releaseId: string }>;
}) {
  const { id, releaseId } = await params;
  return <PublicDetail id={id} releaseId={releaseId} />;
}

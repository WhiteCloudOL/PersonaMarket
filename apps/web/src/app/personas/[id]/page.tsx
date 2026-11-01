import { PublicDetail } from '@/components/personas/public-detail';
import { personaMetadata } from '@/lib/public-seo';
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return personaMetadata((await params).id);
}
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PublicDetail id={id} />;
}

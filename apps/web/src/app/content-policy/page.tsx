import { PolicyPage } from '@/components/policies/policy-page';
import { policyMetadata, policyPublicationId, type PolicyPageProps } from '@/lib/policies';

export const dynamic = 'force-dynamic';
export async function generateMetadata({ searchParams }: PolicyPageProps) {
  return policyMetadata('content-policy', await policyPublicationId(searchParams));
}
export default async function Page({ searchParams }: PolicyPageProps) {
  const publicationId = await policyPublicationId(searchParams);
  return <PolicyPage slug="content-policy" {...(publicationId ? { publicationId } : {})} />;
}

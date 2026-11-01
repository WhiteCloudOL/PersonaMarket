import { CreatePersonaForm } from '@/components/personas/create-persona-form';
import { PageContainer } from '@/components/page-layout';
export default function Page() {
  return (
    <PageContainer className="@container/creation">
      <CreatePersonaForm />
    </PageContainer>
  );
}

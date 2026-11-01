import { ShieldCheckIcon, StarIcon } from 'lucide-react';
import type { PersonaCuration } from '@personamarket/contracts';
import { Badge } from '@personamarket/ui/components/badge';

export function PersonaCurationBadges({ curation }: { curation: PersonaCuration | undefined }) {
  if (!curation?.official && !curation?.featured) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {curation.official && (
        <Badge variant="outline">
          <ShieldCheckIcon data-icon="inline-start" aria-hidden />
          官方作品
        </Badge>
      )}
      {curation.featured && (
        <Badge variant="secondary">
          <StarIcon data-icon="inline-start" aria-hidden />
          精选作品
        </Badge>
      )}
    </div>
  );
}

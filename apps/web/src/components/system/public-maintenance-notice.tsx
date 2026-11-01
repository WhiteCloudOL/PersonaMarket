import { readPublicSystemStatus } from '@/lib/public-system-status';
import { PublicMaintenanceBanner } from './public-maintenance-banner';

export async function PublicMaintenanceNotice() {
  const initial = await readPublicSystemStatus().catch(() => null);
  return <PublicMaintenanceBanner initial={initial} />;
}

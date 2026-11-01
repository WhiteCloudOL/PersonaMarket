import { z } from 'zod';
import { migrateDatabase } from './migrate.js';

try {
  const url = z.url({ protocol: /^postgres(ql)?$/ }).parse(process.env['MIGRATION_DATABASE_URL']);
  await migrateDatabase(url);
  console.log(JSON.stringify({ event: 'database.migrated' }));
} catch {
  console.error(JSON.stringify({ event: 'database.migration_failed', code: 'MIGRATION_FAILED' }));
  process.exitCode = 1;
}

import type { Database } from '@personamarket/database';
import type { Transaction } from '../auth/locked-identity.js';
import { administrationTransaction } from '../admin/administration-transaction.js';

export async function userManagementTransaction<T>(
  database: Database,
  operation: (tx: Transaction) => Promise<T>,
  serializeWrites = false,
  isolationLevel: 'read committed' | 'repeatable read' = 'read committed',
) {
  return administrationTransaction(database, operation, {
    serializeWrites,
    isolationLevel,
    area: 'users',
  });
}

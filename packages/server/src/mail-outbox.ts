import { createHash, randomUUID } from 'node:crypto';
import { outboxEvents, mailTaskContexts, type Database } from '@personamarket/database';
import { sealSecret } from './encryption.js';
import { MailMessageSchema, type MailMessage } from './mail.js';
type Transaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
export type MailContextInput = {
  purpose: typeof mailTaskContexts.$inferInsert.purpose;
  userId: string;
  tokenId?: string;
  sourceId?: string;
  sourceType?: 'account' | 'persona' | 'profile_submission' | 'auth_audit';
};
export const mailRecipientHash = (address: string) =>
  createHash('sha256').update(address.trim().toLowerCase()).digest('hex');
export async function enqueueMail(
  transaction: Transaction,
  key: string,
  input: MailMessage,
  context?: MailContextInput,
): Promise<string> {
  const message = MailMessageSchema.parse(input);
  const id = randomUUID();
  await transaction.insert(outboxEvents).values({
    id,
    topic: 'auth.email',
    payload: {
      schemaVersion: 1,
      encryptedMessage: sealSecret(key, 'mail:' + id, JSON.stringify(message)),
    },
  });
  if (context)
    await transaction.insert(mailTaskContexts).values({
      eventId: id,
      ...context,
      sourceType: context.sourceType ?? 'account',
      sourceId:
        context.sourceId ??
        (context.sourceType && context.sourceType !== 'account' ? null : context.userId),
      recipientHash: mailRecipientHash(message.to),
    });
  return id;
}

import { createHash } from 'node:crypto';
import { UnrecoverableError } from 'bullmq';
import type { Database } from '@personamarket/database';
import { MailJobSchema } from '@personamarket/contracts';
import { MailMessageSchema, type MailMessage, type MailSender } from './mail.js';
import { MailSendError } from './mail-send-error.js';
import { openSecret } from './encryption.js';
import { readMailContext } from './mail-context.js';

export async function deliverMail(
  database: Database,
  input: unknown,
  mail?: { sender: MailSender; encryptionKey: string },
) {
  const checked = MailJobSchema.safeParse(input);
  if (!checked.success) throw new UnrecoverableError('MAIL_PAYLOAD_INVALID');
  const data = { ...checked.data, eventId: checked.data.eventId.toLowerCase() },
    key = 'mail:' + data.eventId;
  const connection = await database.pool.connect().catch((cause: unknown) => {
    throw Error('MAIL_DELIVERY_FAILED', { cause });
  });
  let locked = false,
    discard = false;
  async function transaction<T>(action: () => Promise<T>) {
    await connection.query('BEGIN');
    try {
      const result = await action();
      await connection.query('COMMIT');
      return result;
    } catch (cause) {
      await connection.query('ROLLBACK').catch(() => {
        discard = true;
      });
      throw cause;
    }
  }
  try {
    locked =
      (
        await connection.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',
          [key],
        )
      ).rows[0]?.locked === true;
    if (!locked) throw Error('MAIL_DELIVERY_BUSY');
    const claim = await transaction(async () => {
      const event = (
        await connection.query<{ topic: string; payload: unknown }>(
          'SELECT topic,payload FROM outbox_events WHERE id=$1 FOR UPDATE',
          [data.eventId],
        )
      ).rows[0];
      if (!event || event.topic !== 'auth.email')
        throw new UnrecoverableError('MAIL_PAYLOAD_INVALID');
      const canonical = MailJobSchema.omit({ eventId: true }).safeParse(event.payload);
      if (!canonical.success || canonical.data.encryptedMessage !== data.encryptedMessage)
        throw new UnrecoverableError('MAIL_PAYLOAD_INVALID');
      const hash = createHash('sha256').update(JSON.stringify(canonical.data)).digest('hex');
      const done = await connection.query(
        "SELECT 1 FROM processed_events WHERE consumer='auth-email' AND event_id=$1",
        [data.eventId],
      );
      if (done.rowCount) return 'duplicate' as const;
      const old = (
        await connection.query<{ status: string; attempts: number; payload_hash: string }>(
          'SELECT status,attempts,payload_hash FROM mail_deliveries WHERE event_id=$1 FOR UPDATE',
          [data.eventId],
        )
      ).rows[0];
      if (old && old.payload_hash !== hash) throw new UnrecoverableError('MAIL_PAYLOAD_CHANGED');
      if (old && ['sending', 'uncertain', 'sent'].includes(old.status)) {
        if (old.status === 'sending')
          await connection.query(
            "UPDATE mail_deliveries SET status='uncertain',error_code='MAIL_RESULT_UNCERTAIN',completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE event_id=$1",
            [data.eventId],
          );
        // 锁由前一会话释放但仍是sending，意味着发送阶段可能中断，不可再次调用SMTP
        return 'uncertain' as const;
      }
      if (old && old.attempts >= 5) return 'exhausted' as const;
      if (old)
        await connection.query(
          "UPDATE mail_deliveries SET status='sending',attempts=attempts+1,error_code=NULL,completed_at=NULL,attempted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE event_id=$1",
          [data.eventId],
        );
      else
        await connection.query(
          "INSERT INTO mail_deliveries(event_id,status,payload_hash) VALUES($1,'sending',$2)",
          [data.eventId, hash],
        );
      return 'claimed' as const;
    });
    if (claim === 'duplicate') return claim;
    if (claim !== 'claimed')
      throw new UnrecoverableError(
        claim === 'exhausted' ? 'MAIL_RETRY_EXHAUSTED' : 'MAIL_RESULT_UNCERTAIN',
      );
    let accepted = false,
      smtpStarted = false;
    try {
      if (!mail) throw new MailSendError('MAIL_NOT_CONFIGURED', 'none');
      let message: MailMessage;
      try {
        message = MailMessageSchema.parse(
          JSON.parse(openSecret(mail.encryptionKey, key, data.encryptedMessage)),
        );
      } catch {
        throw new UnrecoverableError('MAIL_PAYLOAD_INVALID');
      }
      const context = await readMailContext(database, data.eventId, message.to);
      if (context && context.state !== 'valid')
        throw new UnrecoverableError('MAIL_PAYLOAD_INVALID');
      if (
        message.verificationCode &&
        !(
          await connection.query(
            'SELECT 1 FROM email_verification_codes WHERE event_id=$1 AND expires_at > clock_timestamp()',
            [data.eventId],
          )
        ).rowCount
      )
        throw new UnrecoverableError('MAIL_VERIFICATION_EXPIRED');
      smtpStarted = true;
      await mail.sender.send(data.eventId, message);
      accepted = true;
      await transaction(async () => {
        await connection.query(
          "INSERT INTO processed_events(consumer,event_id) VALUES('auth-email',$1)",
          [data.eventId],
        );
        const result = await connection.query(
          "UPDATE mail_deliveries SET status='sent',error_code=NULL,completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE event_id=$1 AND status='sending'",
          [data.eventId],
        );
        if (result.rowCount !== 1) throw Error('MAIL_STATE_CHANGED');
      });
      return 'delivered' as const;
    } catch (cause) {
      if (accepted) {
        // COMMIT应答丢失时先读事实，确认原子提交后不误报，也不重新发送
        const committed = await connection
          .query(
            "SELECT 1 FROM mail_deliveries m JOIN processed_events p ON p.event_id=m.event_id AND p.consumer='auth-email' WHERE m.event_id=$1 AND m.status='sent'",
            [data.eventId],
          )
          .catch(() => undefined);
        if (committed?.rowCount) return 'delivered' as const;
      }
      const uncertain =
        accepted ||
        (smtpStarted && (!(cause instanceof MailSendError) || cause.sideEffect === 'unknown'));
      const code = accepted
        ? 'MAIL_RECEIPT_UNCERTAIN'
        : uncertain
          ? 'MAIL_RESULT_UNCERTAIN'
          : cause instanceof UnrecoverableError
            ? cause.message === 'MAIL_VERIFICATION_EXPIRED'
              ? cause.message
              : 'MAIL_PAYLOAD_INVALID'
            : cause instanceof MailSendError
              ? cause.code
              : 'MAIL_SEND_FAILED';
      await connection
        .query(
          "UPDATE mail_deliveries SET status=$2,error_code=$3,completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE event_id=$1 AND status='sending'",
          [data.eventId, uncertain ? 'uncertain' : 'failed', code],
        )
        .catch(() => undefined); // 写入失败仍保留sending，下一次持久guard阻断发送
      if (uncertain) throw new UnrecoverableError('MAIL_RESULT_UNCERTAIN');
      if (cause instanceof UnrecoverableError) throw cause;
      if (code === 'MAIL_RECIPIENT_REJECTED') throw new UnrecoverableError(code);
      throw Error('MAIL_DELIVERY_FAILED', { cause });
    }
  } catch (cause) {
    if (cause instanceof UnrecoverableError) throw cause;
    throw Error('MAIL_DELIVERY_FAILED', { cause });
  } finally {
    if (locked)
      await connection
        .query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key])
        .catch(() => {
          discard = true;
        });
    connection.release(discard);
  }
}

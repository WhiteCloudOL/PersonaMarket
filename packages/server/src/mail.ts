import nodemailer from 'nodemailer';
import { z } from 'zod';
import type { ServerEnvironment } from './env.js';
import { environmentMail, type MailConnection } from './settings.js';
import {
  MailSendError,
  smtpDefinitelyNotAccepted,
  smtpRecipientRejected,
} from './mail-send-error.js';

export const MailMessageSchema = z.strictObject({
  to: z.email(),
  subject: z.string().max(200),
  text: z.string().max(20000),
  verificationCode: z.literal(true).optional(),
});
export type MailMessage = z.infer<typeof MailMessageSchema>;
export class MailSender {
  private closed = false;
  private readonly closers = new Set<() => void>();
  constructor(
    private readonly env: ServerEnvironment,
    private readonly configuration: () => Promise<MailConnection | undefined> = async () =>
      environmentMail(env),
  ) {}
  async configured() {
    return Boolean(await this.configuration());
  }
  private createTransport(connection: MailConnection) {
    return nodemailer.createTransport({
      host: connection.host,
      port: connection.port,
      secure: connection.secure,
      requireTLS: this.env.NODE_ENV === 'production' && !connection.secure,
      ...(connection.username && connection.password
        ? { auth: { user: connection.username, pass: connection.password } }
        : {}),
      connectionTimeout: 3000,
      greetingTimeout: 3000,
      socketTimeout: 5000,
      dnsTimeout: 2000,
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    });
  }
  private async using<T>(
    action: (
      transport: ReturnType<MailSender['createTransport']>,
      connection: MailConnection,
    ) => Promise<T>,
  ) {
    if (this.closed) throw new Error('SMTP_CLOSED');
    const connection = await this.configuration();
    if (!connection) throw new Error('SMTP_NOT_CONFIGURED');
    const transport = this.createTransport(connection);
    const close = () => transport.close();
    this.closers.add(close);
    try {
      return await action(transport, connection);
    } finally {
      close();
      this.closers.delete(close);
    }
  }
  async ready(): Promise<boolean> {
    try {
      return await this.using((transport) => transport.verify());
    } catch {
      return false;
    }
  }
  async send(id: string, message: MailMessage) {
    let started = false;
    try {
      const checked = MailMessageSchema.parse(message);
      await this.using(async (transport, connection) => {
        started = true;
        const result = await transport.sendMail({
          to: checked.to,
          subject: checked.subject,
          text: checked.text,
          from: connection.from,
          messageId: '<' + id + '@' + connection.from.split('@')[1] + '>',
        });
        if (
          !result.accepted.some(
            (recipient: string | { address: string }) =>
              (typeof recipient === 'string' ? recipient : recipient.address).toLowerCase() ===
              checked.to.toLowerCase(),
          )
        )
          throw new MailSendError('MAIL_SEND_FAILED', 'none');
      });
    } catch (cause) {
      if (cause instanceof MailSendError) throw cause;
      if (smtpRecipientRejected(cause))
        throw new MailSendError('MAIL_RECIPIENT_REJECTED', 'none', { cause });
      const known = !started || smtpDefinitelyNotAccepted(cause);
      throw new MailSendError(
        !started && cause instanceof Error && cause.message === 'SMTP_NOT_CONFIGURED'
          ? 'MAIL_NOT_CONFIGURED'
          : known
            ? 'MAIL_SEND_FAILED'
            : 'MAIL_RESULT_UNCERTAIN',
        known ? 'none' : 'unknown',
        { cause },
      );
    }
  }
  close() {
    this.closed = true;
    for (const close of this.closers) close();
    this.closers.clear();
  }
}

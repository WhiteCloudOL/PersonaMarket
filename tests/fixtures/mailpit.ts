import { z } from 'zod';
import { setTimeout } from 'node:timers/promises';

const origin = process.env['MAILPIT_API_ORIGIN'] ?? 'http://127.0.0.1:18025';
const listSchema = z.object({
  messages: z.array(z.object({ ID: z.string(), To: z.array(z.object({ Address: z.string() })) })),
});
async function waitForText(
  email: string,
  select: (text: string) => string | undefined,
  tick?: () => Promise<unknown>,
) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    await tick?.();
    const response = await fetch(
      origin + '/api/v1/search?query=' + encodeURIComponent('to:' + email),
      { signal: AbortSignal.timeout(3000) },
    );
    if (!response.ok) throw new Error('Mailpit 邮件查询失败');
    const list = listSchema.parse(await response.json());
    for (const message of list.messages) {
      if (!message.To.some((recipient) => recipient.Address.toLowerCase() === email.toLowerCase()))
        continue;
      const body = await fetch(origin + '/api/v1/message/' + encodeURIComponent(message.ID), {
        signal: AbortSignal.timeout(3000),
      });
      const mail = z.object({ Text: z.string() }).parse(await body.json());
      const selected = select(mail.Text);
      if (selected) return selected;
    }
    await setTimeout(150);
  }
  throw new Error('未在期限内收到目标邮件');
}
export function mailToken(
  email: string,
  path: 'verify-email' | 'reset-password' | 'change-email',
  tick?: () => Promise<unknown>,
  exclude?: string,
) {
  return waitForText(
    email,
    (text) => {
      const token = new RegExp('/' + path + '#token=([A-Za-z0-9_-]{43})').exec(text)?.[1];
      return token !== exclude ? token : undefined;
    },
    tick,
  );
}
export function mailText(email: string, contains: string, tick?: () => Promise<unknown>) {
  return waitForText(email, (text) => (text.includes(contains) ? text : undefined), tick);
}

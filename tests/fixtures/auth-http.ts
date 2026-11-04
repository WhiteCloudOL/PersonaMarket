import { AuthContextResponseSchema } from '@personamarket/contracts';
import { mailCode } from './mailpit.js';

export class AuthHttp {
  readonly cookies = new Map<string, string>();
  constructor(
    readonly base: string,
    readonly origin = 'http://127.0.0.1:3100',
  ) {}
  async raw(path: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    headers.set('Cookie', [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    if (options.body) headers.set('Content-Type', 'application/json');
    const response = await fetch(this.base + path, {
      ...options,
      headers,
      signal: AbortSignal.timeout(10000),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0] ?? '';
      const index = pair.indexOf('=');
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    return response;
  }
  async context() {
    const response = await this.raw('/api/v1/auth/context');
    return AuthContextResponseSchema.parse(await response.json());
  }
  async register(
    input: { username: string; email: string; password: string },
    tick?: () => Promise<unknown>,
  ) {
    const requested = await this.write('/api/v1/auth/register/code', { email: input.email });
    if (!requested.ok) return requested;
    const code = await mailCode(input.email, '注册', tick);
    return this.write('/api/v1/auth/register', { ...input, code });
  }
  async write(path: string, body?: unknown, method = 'POST', extra: Record<string, string> = {}) {
    const context = await this.context();
    return this.raw(path, {
      method,
      headers: { Origin: this.origin, 'X-CSRF-Token': context.data.csrfToken, ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
}

import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ExportFormat } from '@personamarket/contracts';
import { exportSubject, hashAuthSecret, type ServerEnvironment } from '@personamarket/server';
import { ENVIRONMENT } from '../tokens.js';
import { AuthService } from '../auth/auth.service.js';
import { cookieName, readCookie } from '../auth/cookie-security.js';
import { MetricsRepository } from './metrics.repository.js';

@Injectable()
export class MetricsService {
  constructor(
    @Inject(MetricsRepository) readonly repository: MetricsRepository,
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(ENVIRONMENT) readonly env: ServerEnvironment,
  ) {}
  summary() {
    return this.repository.summary();
  }
  persona(id: string) {
    return this.repository.persona(id);
  }
  async record(
    request: Request,
    response: Response,
    personaId: string,
    releaseId: string,
    format: ExportFormat,
  ) {
    // Express 会把 HEAD 分派给 GET；文件头探测不能成为下载事件或写入匿名标识
    if (request.method !== 'GET' || response.destroyed) return;
    const session = readCookie(request, cookieName(this.env, 'session'));
    const sessionHash = session && hashAuthSecret('session', session);
    const identity = sessionHash ? await this.auth.repository.session(sessionHash) : undefined;
    const accountId =
      identity && this.auth.assurance(identity) === 'authenticated'
        ? identity.account.id
        : undefined;
    const name = `${this.env.NODE_ENV === 'production' ? '__Host-' : ''}pm-export-subject`;
    const cookies = (request.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(name + '='));
    const subject = exportSubject(
      this.env.STATS_HMAC_KEY,
      cookies.length === 1 ? cookies[0]?.slice(name.length + 1) : undefined,
      accountId,
    );
    await this.repository.record({
      personaId,
      releaseId,
      format,
      day: subject.day,
      subjectHash: subject.hash,
      ...(accountId ? { accountId } : {}),
    });
    // 有效会话以账号去重，无需额外发匿名标识
    if (!accountId)
      response.cookie(name, subject.cookie, {
        httpOnly: true,
        secure: this.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: subject.maxAge,
      });
  }
}

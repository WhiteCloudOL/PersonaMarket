import { expect, it } from 'vitest';
import { redactInfrastructureLog } from '../../scripts/infra-log-redaction.js';

it('基础设施失败日志隐藏凭据的原文、URL 编码及有重叠的密钥，保留可诊断错误', () => {
  const short = 'example-secret';
  const password = 'example-secret-中文/@';
  const output = [
    'initdb: permission denied',
    `postgres://${encodeURIComponent(password)}@postgres`,
    `PASSWORD=${password}`,
    `KEY=${short}`,
    'http://127.0.0.1:15432',
  ].join('\n');
  const redacted = redactInfrastructureLog(output, {
    POSTGRES_PASSWORD: password,
    APP_ENCRYPTION_KEY: short,
    SMTP_PASSWORD: undefined,
    PUBLIC_ORIGIN: 'http://127.0.0.1:15432',
  });
  expect(redacted).not.toContain(password);
  expect(redacted).not.toContain(encodeURIComponent(password));
  expect(redacted).not.toContain(short);
  expect(redacted).toContain('initdb: permission denied');
  expect(redacted).toContain('http://127.0.0.1:15432');
  expect(redacted.match(/\[redacted\]/g)).toHaveLength(3);
});

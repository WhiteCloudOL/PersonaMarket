import { parseServerEnvironment, createLogger } from '@personamarket/server';
import { createApplication } from './app.js';
import { mountApiDocument } from './openapi-document.js';

const logger = createLogger('api');
try {
  const env = parseServerEnvironment(process.env);
  const app = await createApplication(env);
  if (env.NODE_ENV !== 'production') mountApiDocument(app);
  await app.listen(env.API_PORT, '0.0.0.0');
  logger.info({ event: 'api.started', port: env.API_PORT });
} catch (cause) {
  logger.error({
    event: 'api.start_failed',
    code: 'STARTUP_FAILED',
    reason:
      cause instanceof Error && cause.message.startsWith('环境配置无效：')
        ? cause.message
        : '服务启动失败。',
  });
  process.exitCode = 1;
}

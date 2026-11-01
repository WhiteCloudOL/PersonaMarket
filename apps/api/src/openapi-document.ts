import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function createApiDocument(app: INestApplication) {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('清蒸云鸭·人设市场 API')
      .setDescription('站点配置、账号认证、会话管理与二次验证接口')
      .setVersion('0.0.0')
      .build(),
  );
}
export function mountApiDocument(app: INestApplication) {
  SwaggerModule.setup('api/v1/docs', app, createApiDocument(app), {
    jsonDocumentUrl: 'api/v1/openapi.json',
  });
}

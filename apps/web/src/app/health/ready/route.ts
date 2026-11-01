import { randomUUID } from 'node:crypto';
import { ErrorResponseSchema, HealthResponseSchema } from '@personamarket/contracts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // 此ID关联本次Web转接，不冒充API上游的请求ID
  const requestId = randomUUID();
  const responseHeaders = { 'Cache-Control': 'no-store', 'X-Request-Id': requestId };
  try {
    // 只从运行期服务端配置确定固定只读目标，不使用来访URL、查询、Cookie或请求头
    const target = new URL(
      '/health/ready',
      process.env['API_INTERNAL_ORIGIN'] ?? 'http://127.0.0.1:3001',
    );
    const upstream = await fetch(target, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (upstream.status !== 200) throw new Error('UPSTREAM_NOT_READY');
    const payload: unknown = await upstream.json();
    return Response.json(HealthResponseSchema.parse(payload), { headers: responseHeaders });
  } catch {
    console.error(JSON.stringify({ event: 'web.readiness.unavailable', requestId }));
    return Response.json(
      ErrorResponseSchema.parse({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: '必要服务就绪状态暂时无法确认，请重新检查',
          fieldErrors: [],
          requestId,
        },
      }),
      { status: 503, headers: responseHeaders },
    );
  }
}

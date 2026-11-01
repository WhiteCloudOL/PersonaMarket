import { argon2id, hash, verify } from 'argon2';
import { BusinessError } from './errors.js';

// 每进程最多一个 Argon2 运算，避免登录突发占满本机内存；Redis 在 API 层分层限流。
let pending = Promise.resolve();
let queued = 0;
function limited<T>(action: () => Promise<T>): Promise<T> {
  if (queued >= 8)
    return Promise.reject(new BusinessError('RATE_LIMITED', '登录请求较多，请稍后重试'));
  queued++;
  const result = pending.then(action).finally(() => {
    queued--;
  });
  pending = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
export const passwordParameters = {
  type: argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
} as const;
export function hashPassword(password: string): Promise<string> {
  return limited(() => hash(password, passwordParameters));
}
export function verifyPassword(encoded: string, password: string): Promise<boolean> {
  return limited(async () => {
    try {
      return await verify(encoded, password);
    } catch {
      return false;
    }
  });
}
let dummy: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummy ??= hashPassword('constant-time-unmatched-account-credential');
  return dummy;
}

import { canonicalJson } from '@personamarket/contracts';
import { ApiError } from '@/lib/auth-api';

export const sameSettings = (left: unknown, right: unknown) =>
  canonicalJson(left) === canonicalJson(right);

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function merge(
  base: unknown,
  edited: unknown,
  latest: unknown,
): { data: unknown; conflict: boolean } {
  if (sameSettings(edited, base)) return { data: latest, conflict: false };
  if (sameSettings(latest, base) || sameSettings(latest, edited))
    return { data: edited, conflict: false };
  if (record(base) && record(edited) && record(latest)) {
    let conflict = false;
    const data = Object.fromEntries(
      [...new Set([...Object.keys(base), ...Object.keys(edited), ...Object.keys(latest)])]
        .map((key) => {
          const field = merge(base[key], edited[key], latest[key]);
          conflict ||= field.conflict;
          return [key, field.data];
        })
        .filter(([, value]) => value !== undefined),
    );
    return { data, conflict };
  }
  return { data: edited, conflict: true };
}

export function mergeSettings<T>(base: T, edited: T, latest: T) {
  const result = merge(base, edited, latest);
  return { data: result.data as T, conflict: result.conflict };
}

export const settingsConflictMessage =
  '其他管理员同时修改了相同设置。你的输入已保留，确认后可再次点击保存。';
export const isSettingsConflict = (error: unknown) =>
  error instanceof ApiError && error.code === 'REVISION_CONFLICT';

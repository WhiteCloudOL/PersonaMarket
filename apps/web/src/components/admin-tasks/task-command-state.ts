import {
  IdSchema,
  RetryAdminRankingGenerationSchema,
  OperationalTaskCommandSchema,
  canonicalJson,
  type AdminTaskFailure,
  type RetryAdminRankingGeneration,
  type OperationalTaskCommand,
} from '@personamarket/contracts';

export type ExactTaskTarget = { kind: 'ranking' | 'storage' | 'mail'; id: string };
export type ExactTaskCommand = {
  accountId: string;
  target: ExactTaskTarget;
  input: RetryAdminRankingGeneration | OperationalTaskCommand;
  key: string;
  hash: string;
  outcome: 'sending' | 'accepted' | 'unknown' | 'rejected';
};
export type ExactTaskDraft = {
  reason: string;
  command?: ExactTaskCommand | undefined;
  receipt?: { recorded: boolean; recordedAt: string | null } | undefined;
  message?: string | undefined;
};
export const taskDraftKey = (accountId: string, target: ExactTaskTarget) =>
  ['private', 'admin-task-command-draft', accountId, target.kind, target.id] as const;
export function parseExactTaskTarget(value: string | null): ExactTaskTarget | undefined {
  if (!value) return undefined;
  const [kind, id, extra] = value.split(':');
  const parsed = IdSchema.safeParse(id);
  if (
    extra !== undefined ||
    !parsed.success ||
    !['ranking', 'storage', 'mail'].includes(kind ?? '')
  )
    return undefined;
  return { kind: kind as ExactTaskTarget['kind'], id: parsed.data.toLowerCase() };
}
export function taskTargetForRow(task: AdminTaskFailure): ExactTaskTarget | undefined {
  if (task.source === 'ranking') return { kind: 'ranking', id: task.id };
  if (task.category === 'storage' && (task.source === 'dispatch' || task.source === 'queue'))
    return { kind: 'storage', id: task.eventId ?? task.id };
  if (task.category === 'mail') return { kind: 'mail', id: task.eventId ?? task.id };
  return undefined;
}
/** 与后端 contentHash 的 canonical JSON 相同；哈希绑定原 POST 对象，不能改成响应中的稳定根标识。 */
export async function taskCommandHash(target: ExactTaskTarget, input: ExactTaskCommand['input']) {
  const body =
    target.kind === 'ranking'
      ? { id: target.id, ...RetryAdminRankingGenerationSchema.parse(input) }
      : { kind: target.kind, id: target.id, ...OperationalTaskCommandSchema.parse(input) };
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(body)),
  );
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}
const definitiveErrors = new Set([
  'MFA_REQUIRED',
  'REAUTH_REQUIRED',
  'INVALID_INPUT',
  'CONFLICT',
  'REVISION_CONFLICT',
  'NOT_FOUND',
  'FORBIDDEN',
  'UNAUTHENTICATED',
  'RATE_LIMITED',
  'MAINTENANCE_MODE',
]);
export const taskResultUnknown = (code: string | undefined, wasUnknown: boolean) =>
  wasUnknown || !code || !definitiveErrors.has(code);
/** 组件离开不代表POST取消；重新进入时sending只能解释为尚未核对。 */
export function restoreTaskDraft(draft: ExactTaskDraft | undefined): ExactTaskDraft | undefined {
  if (draft?.command?.outcome !== 'sending') return draft;
  return {
    ...draft,
    command: { ...draft.command, outcome: 'unknown' },
    message: '结果尚未确认，先前未结算的原请求已保留；请先只读核对，系统不会自动提交',
  };
}
export function taskDraftAfterFailure(
  draft: ExactTaskDraft,
  command: ExactTaskCommand,
  code: string | undefined,
): ExactTaskDraft {
  // 明确的受理事实不能被较早请求的迟到应答撤回。
  if (draft.command?.outcome === 'accepted' || draft.receipt?.recorded === true) return draft;
  const unknown = taskResultUnknown(
    code,
    command.outcome === 'unknown' || draft.command?.outcome === 'unknown',
  );
  return {
    ...draft,
    command: { ...command, outcome: unknown ? 'unknown' : 'rejected' },
    receipt: undefined,
    message: unknown
      ? '结果尚未确认，原对象、载荷和标识已保留，请先只读核对原请求；系统不会自动提交'
      : '本次操作未完成，输入与原请求已保留；重新核对后由你明确确认',
  };
}
export function canStartTaskCommand(version: string, draft: ExactTaskDraft | undefined) {
  const command = draft?.command;
  if (!command) return true;
  if (command.outcome === 'rejected') return true;
  return (
    command.input.expectedVersion !== version &&
    (command.outcome === 'accepted' || draft?.receipt?.recorded === true)
  );
}
export function taskHref(pathname: string, search: string, target: ExactTaskTarget | undefined) {
  const next = new URLSearchParams(search);
  if (target) next.set('task', target.kind + ':' + target.id);
  else next.delete('task');
  return pathname + (next.size ? '?' + next : '');
}

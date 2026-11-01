import { createHash, randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { canonicalJson } from '@personamarket/contracts';
import {
  canStartTaskCommand,
  parseExactTaskTarget,
  taskCommandHash,
  taskHref,
  taskResultUnknown,
  restoreTaskDraft,
  taskDraftAfterFailure,
  type ExactTaskDraft,
} from '../../apps/web/src/components/admin-tasks/task-command-state.js';

function unfinishedDraft(): ExactTaskDraft {
  return {
    reason: '本地未提交输入也应保留',
    command: {
      accountId: randomUUID(),
      target: { kind: 'ranking', id: randomUUID() },
      input: { expectedVersion: 'a'.repeat(64), reason: '原命令冻结的处理原因', confirmed: true },
      key: randomUUID(),
      hash: 'c'.repeat(64),
      outcome: 'sending',
    },
  };
}
it('未结算POST跨导航恢复为未知，第二次明确429不能撤回第一次的未知或解锁新标识', () => {
  const original = unfinishedDraft(),
    restored = restoreTaskDraft(original);
  expect(restored?.command?.outcome).toBe('unknown');
  expect(restored?.command).toMatchObject({
    key: original.command?.key,
    hash: original.command?.hash,
    target: original.command?.target,
    input: original.command?.input,
  });
  expect(restored?.reason).toBe(original.reason);
  if (!restored || !original.command) throw Error('缺少测试原命令');
  // 旧组件回调仍持有sending，新的缓存已经把跨导航未结算标为unknown。
  const rejectedAgain = taskDraftAfterFailure(restored, original.command, 'RATE_LIMITED');
  expect(rejectedAgain.command?.outcome).toBe('unknown');
  expect(
    canStartTaskCommand('b'.repeat(64), {
      ...rejectedAgain,
      receipt: { recorded: false, recordedAt: null },
    }),
  ).toBe(false);
  expect(restoreTaskDraft(undefined)).toBeUndefined();
  expect(original.command.outcome).toBe('sending');
});
it('真实已记录受理是单调事实，迟到503/429不能覆盖回执；首次明确拒绝仍可重新确认', () => {
  const original = unfinishedDraft();
  if (!original.command) throw Error('缺少测试原命令');
  expect(
    taskDraftAfterFailure(original, original.command, 'REVISION_CONFLICT').command?.outcome,
  ).toBe('rejected');
  const recorded: ExactTaskDraft = {
    ...original,
    command: { ...original.command, outcome: 'accepted' },
    receipt: { recorded: true, recordedAt: new Date().toISOString() },
    message: '受理已核实',
  };
  for (const code of [undefined, 'SERVICE_UNAVAILABLE', 'RATE_LIMITED']) {
    expect(taskDraftAfterFailure(recorded, original.command, code)).toBe(recorded);
    expect(restoreTaskDraft(recorded)).toBe(recorded);
  }
});

it('原操作指纹与服务端规范JSON一致，storage原事件不可换成响应根标识', async () => {
  const target = { kind: 'storage' as const, id: randomUUID() },
    input = {
      action: 'retry' as const,
      expectedVersion: 'a'.repeat(64),
      reason: '  正常核对自有文件  ',
      confirmed: true as const,
    };
  const expected = createHash('sha256')
    .update(canonicalJson({ ...target, ...input, reason: input.reason.trim() }))
    .digest('hex');
  expect(await taskCommandHash(target, input)).toBe(expected);
  expect(await taskCommandHash({ ...target, id: randomUUID() }, input)).not.toBe(expected);
  const ranking = { kind: 'ranking' as const, id: randomUUID() };
  const rankingInput = {
    expectedVersion: input.expectedVersion,
    reason: input.reason,
    confirmed: input.confirmed,
  };
  expect(await taskCommandHash(ranking, rankingInput)).toBe(
    createHash('sha256')
      .update(canonicalJson({ id: ranking.id, ...rankingInput, reason: input.reason.trim() }))
      .digest('hex'),
  );
});
it('未知请求在同版本只能核对或重试原请求，新版本也须先显式核对', () => {
  const draft: ExactTaskDraft = {
    reason: '保留输入',
    command: {
      accountId: randomUUID(),
      target: { kind: 'ranking', id: randomUUID() },
      input: { expectedVersion: 'a'.repeat(64), reason: '原请求原因', confirmed: true },
      key: randomUUID(),
      hash: 'c'.repeat(64),
      outcome: 'unknown',
    },
  };
  expect(canStartTaskCommand('a'.repeat(64), draft)).toBe(false);
  expect(canStartTaskCommand('b'.repeat(64), draft)).toBe(false);
  expect(
    canStartTaskCommand('b'.repeat(64), {
      ...draft,
      receipt: { recorded: false, recordedAt: null },
    }),
  ).toBe(false);
  expect(
    canStartTaskCommand('b'.repeat(64), {
      ...draft,
      receipt: { recorded: true, recordedAt: new Date().toISOString() },
    }),
  ).toBe(true);
  expect(
    canStartTaskCommand('a'.repeat(64), {
      ...draft,
      receipt: { recorded: false, recordedAt: null },
    }),
  ).toBe(false);
  expect(taskResultUnknown('CONFLICT', true)).toBe(true);
  expect(taskResultUnknown('CONFLICT', false)).toBe(false);
});
it('精确任务定位仅接受批准种类UUID，开关Sheet保留列表和无关条件', () => {
  const id = randomUUID();
  expect(parseExactTaskTarget('ranking:' + id.toUpperCase())).toEqual({ kind: 'ranking', id });
  for (const value of ['queue:' + id, 'mail:invalid', 'storage:' + id + ':extra', '', null])
    expect(parseExactTaskTarget(value)).toBeUndefined();
  expect(
    taskHref('/admin/tasks', 'category=rankings&page=2&custom=kept', { kind: 'ranking', id }),
  ).toBe('/admin/tasks?category=rankings&page=2&custom=kept&task=ranking%3A' + id);
  expect(
    taskHref('/admin/tasks', 'category=rankings&task=ranking%3A' + id + '&custom=kept', undefined),
  ).toBe('/admin/tasks?category=rankings&custom=kept');
});

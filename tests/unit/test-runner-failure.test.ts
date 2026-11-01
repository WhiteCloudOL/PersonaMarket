import { expect, it } from 'vitest';
import { describeRunnerFailure } from '../../scripts/test-runner-failure.js';

it('测试运行器仅输出阶段和白名单元信息，不输出连接地址、错误正文或私有详情', () => {
  const secret = 'fixture-private-credential';
  const cause = Object.assign(new Error('postgresql://owner:' + secret + '@localhost/private'), {
    code: '55006',
    detail: secret,
    query: 'SELECT ' + secret,
  });
  const event = describeRunnerFailure(
    'drop_database',
    {
      project: 'mobile',
      suite: 'persona-releases',
      database: 'pm_e2e_1234567890_test',
    },
    cause,
  );
  expect(event).toEqual({
    event: 'test.runner.failed',
    stage: 'drop_database',
    project: 'mobile',
    suite: 'persona-releases',
    database: 'pm_e2e_1234567890_test',
    code: '55006',
  });
  expect(JSON.stringify(event)).not.toContain(secret);
  expect(JSON.stringify(event)).not.toMatch(/postgresql:|localhost|SELECT/);
});
it('非规范错误码及上下文被脱敏，未知异常也不会透传正文', () => {
  const event = describeRunnerFailure(
    'execute_browser',
    { project: 'private@example.test' },
    {
      code: 'https://private.invalid/token',
      message: 'fixture-private-credential',
    },
  );
  expect(event).toEqual({
    event: 'test.runner.failed',
    stage: 'execute_browser',
    project: 'redacted',
    code: 'UNKNOWN',
  });
  expect(
    describeRunnerFailure(
      'reserve_origin',
      {},
      Object.assign(new Error('hidden'), { code: 'EADDRINUSE' }),
    ).code,
  ).toBe('EADDRINUSE');
});

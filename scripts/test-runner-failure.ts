type RunnerStage =
  | 'create_database'
  | 'reserve_origin'
  | 'execute_browser'
  | 'drop_database'
  | 'merge_reports'
  | 'close_owner';
type RunnerContext = { project?: string; suite?: string; database?: string };

/** 错误正文可能含数据库URL、SQL或参数，日志仅保留结构化阶段与受限错误码 */
export function describeRunnerFailure(stage: RunnerStage, context: RunnerContext, cause: unknown) {
  const identifier = (value: string) => (/^[a-z0-9_-]{1,100}$/i.test(value) ? value : 'redacted');
  const code =
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    typeof cause.code === 'string' &&
    /^(?:[A-Z0-9]{5}|E[A-Z_]{1,31})$/.test(cause.code)
      ? cause.code
      : 'UNKNOWN';
  return {
    event: 'test.runner.failed',
    stage,
    ...(context.project === undefined ? {} : { project: identifier(context.project) }),
    ...(context.suite === undefined ? {} : { suite: identifier(context.suite) }),
    ...(context.database === undefined ? {} : { database: identifier(context.database) }),
    code,
  };
}
export async function runBrowserStage<T>(
  stage: RunnerStage,
  context: RunnerContext,
  execute: () => Promise<T>,
): Promise<T> {
  try {
    return await execute();
  } catch (cause) {
    console.error(JSON.stringify(describeRunnerFailure(stage, context, cause)));
    throw cause;
  }
}

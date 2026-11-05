export function redactInfrastructureLog(
  output: string,
  environment: Record<string, string | undefined>,
) {
  const secrets = Object.entries(environment)
    .filter(([name, value]) => /password|secret|token|encryption_key|hmac_key/i.test(name) && value)
    .flatMap(([, value]) => (value ? [value, encodeURIComponent(value)] : []))
    .sort((left, right) => right.length - left.length);
  for (const secret of new Set(secrets)) output = output.split(secret).join('[redacted]');
  return output;
}

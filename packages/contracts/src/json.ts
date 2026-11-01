/** 稳定序列化只消除对象键顺序/undefined差异，不重排数组或改写作者文本。 */
export function canonicalJson(value: unknown): string {
  const normalize = (current: unknown): unknown =>
    Array.isArray(current)
      ? current.map(normalize)
      : current !== null && typeof current === 'object'
        ? Object.fromEntries(
            Object.entries(current)
              .filter(([, value]) => value !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, value]) => [key, normalize(value)]),
          )
        : current;
  return JSON.stringify(normalize(value));
}

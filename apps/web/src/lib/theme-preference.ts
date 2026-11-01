export type ThemePreference = 'system' | 'light' | 'dark';

/** Cookie 缺失或非法时沿用设备偏好，服务端和菜单使用同一默认值。 */
export function readThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

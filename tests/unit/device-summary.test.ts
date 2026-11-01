import { describe, expect, it } from 'vitest';
import { deviceSummary } from '../../apps/web/src/lib/device-summary.js';

describe('会话设备展示摘要', () => {
  it('优先识别 Chromium 衍生浏览器，不把 Edge 错标为 Chrome', () => {
    expect(
      deviceSummary(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36 Edg/130.0',
      ),
    ).toEqual({ label: 'Edge · Windows', mobile: false });
  });
  it('识别手机和桌面系统，并支持截断的浏览器标识', () => {
    expect(
      deviceSummary('Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36'),
    ).toEqual({ label: 'Chrome · Android', mobile: true });
    expect(
      deviceSummary(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) FxiOS/130.0 Safari/605',
      ),
    ).toEqual({ label: 'Firefox · iPhone', mobile: true });
    expect(deviceSummary('Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605')).toEqual({
      label: 'Safari · macOS',
      mobile: false,
    });
  });
  it('不把无法识别的原始 UA 当作设备名称展示', () => {
    expect(deviceSummary('')).toEqual({ label: '未知设备', mobile: false });
    expect(deviceSummary('<script>long untrusted device</script>').label).toBe('浏览器 · 未知系统');
  });
});

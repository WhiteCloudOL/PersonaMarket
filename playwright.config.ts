import { defineConfig } from '@playwright/test';
// Playwright 1.64 的失败页面文本快照会包含 MFA 密钥/恢复码，因此关闭自动采集。
process.env['PLAYWRIGHT_NO_COPY_PROMPT'] = '1';
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: process.env['PLAYWRIGHT_RESULTS_DIR'] ?? './data/tests/playwright/results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'data/tests/playwright/report' }]],
  use: {
    baseURL: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    reducedMotion: 'reduce',
    ...(process.env['PLAYWRIGHT_CHANNEL'] ? { channel: process.env['PLAYWRIGHT_CHANNEL'] } : {}),
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: 'tablet', use: { browserName: 'chromium', viewport: { width: 768, height: 1024 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'node scripts/serve-e2e.mjs',
    url: process.env['PLAYWRIGHT_ORIGIN'] ?? 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});

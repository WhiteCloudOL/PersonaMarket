import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig(base, {
  testDir: './tests/visual',
  outputDir: './data/tests/ui-redesign/runner',
  reporter: [['list']],
  workers: 1,
  fullyParallel: false,
  projects: [
    [360, 800],
    [390, 844],
    [430, 932],
    [768, 1024],
    [1024, 768],
    [1366, 768],
    [1440, 900],
    [1920, 1080],
  ].map(([width, height]) => {
    if (width === undefined || height === undefined) throw new Error('视觉视口配置不完整');
    return {
      name: 'v' + width,
      use: {
        browserName: 'chromium' as const,
        viewport: { width, height },
        isMobile: width < 640,
        hasTouch: width < 1024,
      },
    };
  }),
  use: { trace: 'off', screenshot: 'off', reducedMotion: 'reduce' },
});

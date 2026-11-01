import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  HomeSettingsResponseSchema,
  ModelSuggestionsResponseSchema,
  homeSettingsEtag,
  modelSuggestionsEtag,
} from '@personamarket/contracts';
import { loginBrowserAdmin } from '../fixtures/browser-admin.js';
import { browserWrite } from '../fixtures/browser-account.js';

test.use({ trace: 'off', screenshot: 'off' });
for (const kind of ['home', 'models'] as const) {
  test(
    (kind === 'home' ? '首页' : '模型建议') +
      '保存响应丢失后，幂等重试读到另一页修订仍保留本地输入',
    async ({ page }, info) => {
      if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
      const directory = join(
        'data/tests/settings-idempotency-race',
        info.project.name,
        kind,
        randomUUID(),
      );
      await mkdir(directory, { recursive: true });
      await loginBrowserAdmin(page);
      const path = '/api/v1/admin/settings/' + (kind === 'home' ? 'home' : 'model-suggestions');
      const route = '/admin/settings/' + (kind === 'home' ? 'home' : 'model-suggestions');
      const button = kind === 'home' ? '保存首页设置' : '保存模型建议';
      const label = kind === 'home' ? '首页短提示' : '建议 1 · 备注';
      const group = kind === 'home' ? '首页展示设置表单' : '模型建议表单';
      const local = '响应丢失时仍要保留的本地文字';
      const remote = '另一页面随后保存的文字';
      if (kind === 'models') {
        const initial = ModelSuggestionsResponseSchema.parse(
          await (await page.request.get(path)).json(),
        );
        expect(
          (
            await browserWrite(
              page,
              path,
              {
                data: {
                  entries: [
                    {
                      id: randomUUID(),
                      modelId: 'fixture/race-model',
                      note: '初始备注',
                      enabled: true,
                    },
                  ],
                },
                reason: '准备隔离的模型建议',
              },
              'PATCH',
              {
                'If-Match': modelSuggestionsEtag(initial.meta.revision),
                'Idempotency-Key': randomUUID(),
              },
            )
          ).status(),
        ).toBe(200);
      }
      const started =
        kind === 'home'
          ? HomeSettingsResponseSchema.parse(await (await page.request.get(path)).json())
          : ModelSuggestionsResponseSchema.parse(await (await page.request.get(path)).json());
      await page.goto(route);
      await page.getByLabel(label, { exact: true }).fill(local);
      await page.getByLabel('处理理由', { exact: true }).fill('保留丢失响应后的本地编辑');
      const keys: string[] = [];
      let lost = false;
      await page.route('**' + path, async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue();
        keys.push(route.request().headers()['idempotency-key'] ?? '');
        if (!lost) {
          lost = true;
          const committed = await route.fetch();
          expect(committed.status()).toBe(200);
          await committed.dispose();
          return route.abort('failed');
        }
        return route.continue();
      });
      await page.getByRole('button', { name: button, exact: true }).click();
      await expect(
        page.getByRole('group', { name: group, exact: true }).getByRole('alert'),
      ).toBeVisible();
      if (kind === 'home') {
        const current = HomeSettingsResponseSchema.parse(
          await (await page.request.get(path)).json(),
        );
        expect(current.data.heroNote).toBe(local);
        expect(
          (
            await browserWrite(
              page,
              path,
              { data: { ...current.data, heroNote: remote }, reason: '另一页面真实提交' },
              'PATCH',
              {
                'If-Match': homeSettingsEtag(current.meta.revision),
                'Idempotency-Key': randomUUID(),
              },
            )
          ).status(),
        ).toBe(200);
      } else {
        const current = ModelSuggestionsResponseSchema.parse(
          await (await page.request.get(path)).json(),
        );
        expect(current.data.entries[0]?.note).toBe(local);
        expect(
          (
            await browserWrite(
              page,
              path,
              {
                data: {
                  entries: current.data.entries.map((entry) => ({ ...entry, note: remote })),
                },
                reason: '另一页面真实提交',
              },
              'PATCH',
              {
                'If-Match': modelSuggestionsEtag(current.meta.revision),
                'Idempotency-Key': randomUUID(),
              },
            )
          ).status(),
        ).toBe(200);
      }
      const retried = page.waitForResponse(
        (response) => response.url().endsWith(path) && response.request().method() === 'PATCH',
      );
      await page.getByRole('button', { name: button, exact: true }).click();
      expect((await retried).status()).toBe(200);
      expect(keys).toHaveLength(2);
      expect(keys[0]).toBeTruthy();
      expect(keys[1]).toBe(keys[0]);
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(local);
      await expect(page.getByText(remote, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.evaluate(() => document.fonts.ready);
      await page.getByLabel(label, { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(directory, 'local-input.png') });
      await page
        .getByRole('status')
        .filter({ has: page.getByRole('button', { name: '采用最新修订继续核对', exact: true }) })
        .scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(directory, 'candidate.png') });
      await page.getByRole('button', { name: '采用最新修订继续核对', exact: true }).click();
      await expect(page.getByLabel(label, { exact: true })).toHaveValue(local);
      const saved = page.waitForResponse(
        (response) => response.url().endsWith(path) && response.request().method() === 'PATCH',
      );
      await page.getByRole('button', { name: button, exact: true }).click();
      expect((await saved).status()).toBe(200);
      expect(keys).toHaveLength(3);
      expect(keys[2]).not.toBe(keys[0]);
      await page.unroute('**' + path);
      if (kind === 'home') {
        const current = HomeSettingsResponseSchema.parse(
          await (await page.request.get(path)).json(),
        );
        expect(current.data.heroNote).toBe(local);
        expect(current.meta.revision).toBe(started.meta.revision + 3);
      } else {
        const current = ModelSuggestionsResponseSchema.parse(
          await (await page.request.get(path)).json(),
        );
        expect(current.data.entries[0]?.note).toBe(local);
        expect(current.meta.revision).toBe(started.meta.revision + 3);
      }
      await writeFile(
        join(directory, 'checks.json'),
        JSON.stringify(
          {
            local,
            remote,
            inputPreserved: true,
            freshConfirmationKey: true,
            revisionSteps: 3,
            overflow: false,
            viewport: page.viewportSize(),
          },
          null,
          2,
        ),
      );
    },
  );
}

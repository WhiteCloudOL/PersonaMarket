import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import {
  parseAstrBot,
  parseMaiBot,
  serializeAstrBot,
  serializeMaiBot,
} from '@personamarket/persona-adapters';
import { astrBotPersona, maiBotPersona, specialText } from '../tests/fixtures/native-personas.js';
import { docker, lock, root, source, toolsImage } from './native-runtime.js';
import { startAstrBot } from './start-native-astrbot.js';

const directory = join(root, 'data/tests/native', randomUUID());
mkdirSync(directory, { recursive: true, mode: 0o700 });
const fixtureUser = `${process.getuid?.() || 1000}:${process.getgid?.() || 1000}`;
const maiSource = await source('maibot');
const astrSource = await source('astrbot');
writeFileSync(join(directory, 'maibot.toml'), serializeMaiBot(maiBotPersona));
writeFileSync(
  join(directory, 'maibot-expected.json'),
  JSON.stringify({
    personality: maiBotPersona.content.personality,
    reply_style: maiBotPersona.content.replyStyle,
    behavior_style: maiBotPersona.content.behaviorStyle,
  }),
);
docker([
  'build',
  '-f',
  'tests/native/Dockerfile.maibot',
  '-t',
  'personamarket-maibot-check:1.3.15',
  '.',
]);
docker([
  'run',
  '--rm',
  '--network',
  'none',
  '--mount',
  `type=bind,src=${directory},dst=/work`,
  toolsImage,
  'sh',
  '-c',
  `chown -R ${fixtureUser} /work && chmod 0700 /work`,
]);
console.log('MaiBot：官方 PersonalityConfig 消费与 TOML 往返');
docker([
  'run',
  '--rm',
  '--network',
  'none',
  '--user',
  fixtureUser,
  '--read-only',
  '--tmpfs',
  '/tmp',
  '--cap-drop',
  'ALL',
  '--security-opt',
  'no-new-privileges:true',
  '--mount',
  `type=bind,src=${maiSource},dst=/upstream,readonly`,
  '--mount',
  `type=bind,src=${join(root, 'tests/native')},dst=/checks,readonly`,
  '--mount',
  `type=bind,src=${directory},dst=/work`,
  'personamarket-maibot-check:1.3.15',
]);
const maiResult: unknown = JSON.parse(readFileSync(join(directory, 'maibot-result.json'), 'utf8'));
assert.equal(typeof maiResult, 'object');
assert.deepEqual(parseMaiBot(Buffer.from(serializeMaiBot(maiBotPersona))).persona, maiBotPersona);

const session = startAstrBot(directory);
let browser;
try {
  // The running official image must contain the same native API as the pinned source archive.
  const path = 'astrbot/dashboard/api/personas.py';
  assert.equal(
    docker([
      'exec',
      session.name,
      'python',
      '-c',
      `import hashlib; print(hashlib.sha256(open('/AstrBot/${path}','rb').read()).hexdigest())`,
    ]),
    createHash('sha256')
      .update(readFileSync(join(astrSource, path)))
      .digest('hex'),
  );
  await expect
    .poll(
      async () => {
        try {
          const response = await fetch(session.origin + '/api/v1/auth/setup-status', {
            signal: AbortSignal.timeout(3000),
          });
          return response.ok && response.headers.get('content-type')?.includes('application/json');
        } catch {
          return false;
        }
      },
      { timeout: 120_000, intervals: [1000] },
    )
    .toBeTruthy();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30_000);
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === session.origin ? route.continue() : route.abort(),
  );
  await page.goto(session.origin);
  await page.locator('input[name="username"]').fill('astrbot');
  await page.locator('input[name="password"]').fill(session.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL('**/#/auth/setup');
  await page.locator('input[type="text"]').fill('nativecheck');
  await page
    .locator('input[type="password"]')
    .nth(0)
    .fill(session.password + 'B2');
  await page
    .locator('input[type="password"]')
    .nth(1)
    .fill(session.password + 'B2');
  await page.getByRole('button', { name: '完成设置', exact: true }).click();
  await page.waitForURL((url) => !url.hash.includes('/auth/'));
  await page
    .getByRole('dialog')
    .filter({ hasText: '首次提示' })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page.goto(session.origin + '/#/persona');
  await page.locator('.persona-manager').waitFor();
  for (const count of [0, 1, 20, 100, -1]) {
    console.log(
      count === -1
        ? 'AstrBot：确认原生导入器的首尾空白规范化行为'
        : `AstrBot：真实 WebUI 导入、数据库重载、导出 ${count} 对对话`,
    );
    const id = `pm-native-${count}`;
    const file = join(directory, `astrbot-${count}.json`);
    const persona = astrBotPersona(Math.max(0, count));
    if (count === -1) persona.content.systemPrompt = specialText;
    writeFileSync(file, serializeAstrBot(persona, id));
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/personas'),
    );
    await page.locator('input[type="file"]').setInputFiles(file);
    const response = await created;
    assert.equal(response.ok(), true);
    const result: unknown = await response.json();
    assert.equal(typeof result, 'object');
    await page.reload();
    const card = page
      .locator('.persona-card')
      .filter({ has: page.locator('.persona-name', { hasText: id }) });
    await expect(card).toHaveCount(1);
    // Native importer defaults capabilities to null; no tool/provider is connected in this sandbox.
    await expect(card).toContainText('使用所有可用工具');
    await expect(card).toContainText('使用所有可用技能');
    await card.getByRole('button').click();
    await page.getByText('导出', { exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '确定', exact: true }).click(),
    ]);
    const exported = join(directory, `astrbot-exported-${count}.json`);
    await download.saveAs(exported);
    const expected: unknown = JSON.parse(
      serializeAstrBot(
        {
          ...persona,
          content: { ...persona.content, systemPrompt: persona.content.systemPrompt.trim() },
        },
        id,
      ),
    );
    assert.deepEqual(JSON.parse(readFileSync(exported, 'utf8')), expected);
    const imported = parseAstrBot(readFileSync(exported), randomUUID).persona;
    assert.equal(imported.platform, 'astrbot');
    if (imported.platform !== 'astrbot') throw new Error('Unexpected platform');
    assert.deepEqual(
      imported.content.dialoguePairs.map(({ user, assistant }) => [user, assistant]),
      persona.content.dialoguePairs.map(({ user, assistant }) => [user, assistant]),
    );
    assert.equal(imported.content.systemPrompt, persona.content.systemPrompt.trim());
  }
  await page.screenshot({ path: join(directory, 'astrbot-native.png'), fullPage: true });
  mkdirSync(join(root, '.development/evidence'), { recursive: true });
  writeFileSync(
    join(root, '.development/evidence/native-formats.json'),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        upstream: lock,
        maibot: 'official PersonalityConfig consumption and tomlkit round trip passed',
        astrbot: 'official WebUI file import, database reload and native export passed',
        dialoguePairs: [0, 1, 20, 100],
        text: 'Unicode, multiline, quotes, inner whitespace, backslash, controls preserved; AstrBot trims system_prompt outer whitespace',
        capabilities:
          'native importer tools/skills defaults confirmed; no providers or tools connected',
        externalNetwork: 'native container isolated; incoming proxy only',
        directory,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('两平台原生消费核验通过');
} catch (error) {
  const pages = browser?.contexts().flatMap((context) => context.pages()) ?? [];
  for (const page of pages) {
    writeFileSync(
      join(directory, 'failure.txt'),
      (await page.locator('body').innerText()).replaceAll(session.password, '[REDACTED]'),
      { mode: 0o600 },
    );
    await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true });
  }
  throw error;
} finally {
  await browser?.close();
  writeFileSync(
    join(directory, 'astrbot-startup.log'),
    docker(['logs', session.name]).replaceAll(session.password, '[REDACTED]'),
    { mode: 0o600 },
  );
  docker(['rm', '-f', session.proxy, session.name]);
  docker(['network', 'rm', session.name + '-ingress', session.name]);
}

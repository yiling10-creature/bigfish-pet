const { createRequire } = require('node:module');
const { _electron } = createRequire(require.resolve('@playwright/test'))('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const executablePath = process.env.BIGFISH_SMOKE_EXE || path.resolve(root, '../dist/win-unpacked/BigFishPet.exe');
const profile = process.env.BIGFISH_SMOKE_PROFILE || path.resolve(root, 'artifacts/packaged-profile');
fs.mkdirSync(profile, { recursive: true });
const env = { ...process.env, BIGFISH_USER_DATA: profile }; delete env.ELECTRON_RUN_AS_NODE;
let app;
(async () => {
  app = await _electron.launch({ executablePath, args: ['--no-sandbox'], env, timeout: 45000 });
  const page = await app.firstWindow();
  await page.locator('.bf-chat, .bf-chat-toggle').first().waitFor();
  const keepHidden = process.env.BIGFISH_SMOKE_KEEP_HIDDEN === '1';
  if (keepHidden) { assert.equal(await page.locator('.bf-chat').count(), 0); }
  else {
    if (await page.locator('.bf-chat-toggle').count()) await page.getByRole('button', { name: '打开问答', exact: true }).click();
    await page.locator('.bf-chat-form textarea').waitFor();
  }
  const version = await app.evaluate(({ app }) => app.getVersion()); assert.equal(version, '1.1.0');
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const status = await page.evaluate(() => window.desktopPet.deepseek.status());
  assert.equal(status.ok, true);
  let connection = { tested: false, reason: status.hasKey ? '此前实际连接测试已通过，本次仅检查启动' : '当前资料目录未配置 API Key' };
  if (status.hasKey && process.env.BIGFISH_SMOKE_SKIP_CONNECTION !== '1') {
    const result = await page.evaluate(() => window.desktopPet.deepseek.test());
    connection = { tested: true, ok: result.ok, message: result.message };
    assert.equal(result.ok, true, result.message);
  }
  await page.evaluate(() => window.desktopPet.openSettings());
  let settings;
  for (let i = 0; i < 50; i++) { settings = app.windows().find(w => w.url().endsWith('#settings')); if (settings) break; await new Promise(r => setTimeout(r, 100)); }
  assert.ok(settings); await settings.getByRole('heading', { name: '肥肥鱼的小窝' }).waitFor();
  assert.equal(await settings.getByRole('tab').count(), 4);
  assert.deepEqual(errors, []);
  const result = { executablePath, version, renderer: 'ready', settings: 'ready', connection, errors };
  console.log(JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(root, 'artifacts/packaged-smoke.json'), JSON.stringify(result, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { if (app) await app.close(); });

import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Isolated browser harness: real React and simulation, in-memory storage and a
// scene fixture. This checks the bridge, not the production Three.js scene.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.KX_PLAYWRIGHT_PATH || 'playwright');
const root = fileURLToPath(new URL('../../', import.meta.url));
const server = await createServer({ configFile: false, root, server: { host: '127.0.0.1', port: 5196, strictPort: true, watch: { ignored: ['**/release/**', '**/.test-data/**'] } } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.KX_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/homepage.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><h1>Home fixture</h1><script>window.received=[];addEventListener("message",e=>received.push(e.data));parent.postMessage({source:"kongxiaozhu-home",type:"ready"},"*")</script></body></html>' }));
  await page.addInitScript(() => {
    const disk = new Map(); window.testDisk = disk; window.failSave = false;
    window.kongxiaozhu = {
      async getBootstrap() { return { appVersion: '1.0.0', dataPath: 'isolated-mock-storage', experiments: [], settings: { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'unconfigured', hasKey: false, timeoutMs: 90000 } }; },
      async saveExperiment(exp) { if (window.failSave) throw Error('test save rejection'); disk.set(exp.id, structuredClone(exp)); return structuredClone(exp); },
      async listExperiments() { return [...disk.values()]; },
      async simulate(config, options) { return (await import('/src/core/index.mjs')).simulate(config, options); },
    };
  });
  await page.goto('http://127.0.0.1:5196/index.html');
  await page.getByTestId('homepage-frame').waitFor();
  const frame = page.frames().find(item => item.url().endsWith('homepage.html'));
  await frame.waitForFunction(() => window.received?.some(message => message.type === 'visibility' && message.active));
  const send = async (type, caseId) => frame.evaluate(data => parent.postMessage({ source: 'kongxiaozhu-home', ...data }, '*'), { type, caseId });
  assert.equal(await page.locator('.app-chrome').isVisible(), false);
  console.log('PASS homepage is initial full-window route');
  await page.evaluate(() => window.postMessage({ source: 'kongxiaozhu-home', type: 'open-library' }, '*'));
  await send('start-experiment', 'bad-case');
  assert.equal(await page.getByTestId('homepage-frame').isVisible(), true);
  console.log('PASS unrelated window and invalid case messages rejected');
  await send('open-settings');
  await page.getByRole('dialog', { name: '模型与本机设置' }).waitFor();
  await page.getByRole('button', { name: '关闭对话框' }).click();
  console.log('PASS homepage model settings route');
  await send('start-experiment', 'motor');
  await page.getByTestId('run-simulation').waitFor();
  await page.getByTestId('ai-assistant-launcher').click();
  await page.getByLabel('描述你观察到的问题').fill('shell draft retained');
  await page.getByTestId('feature-home').click();
  await page.getByTestId('homepage-frame').waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('ai-assistant-drawer').isVisible(), false);
  assert.equal(await page.getByTestId('ai-assistant-launcher').isVisible(), false);
  assert.equal(await page.evaluate(() => testDisk.size), 1);
  console.log('PASS return saves and hides AI portal');
  await send('continue-experiment');
  await page.getByTestId('run-simulation').waitFor();
  assert.equal(await page.getByLabel('描述你观察到的问题').inputValue(), 'shell draft retained');
  console.log('PASS continue retains experiment and unsent AI draft');
  await page.getByRole('button', { name: '关闭 AI 实验助手' }).click();
  await page.evaluate(() => window.failSave = true);
  await page.getByTestId('feature-home').click();
  await page.locator('.shell-navigation-error').waitFor();
  assert.equal(await page.getByTestId('homepage-frame').isVisible(), false);
  console.log('PASS failed save prevents leaving workspace');
  await page.evaluate(() => window.failSave = false);
  await page.getByTestId('feature-home').click();
  await page.getByTestId('homepage-frame').waitFor({ state: 'visible' });
  await send('open-records');
  await page.getByRole('heading', { name: '我的实验', exact: true }).waitFor();
  assert.equal(await page.getByTestId('ai-assistant-launcher').isVisible(), false);
  assert.equal(await page.locator('.record-card').count(), 1);
  console.log('PASS records refresh with background workbench retained');
  await page.getByTestId('feature-home').click();
  await page.getByTestId('homepage-frame').waitFor({ state: 'visible' });
  for (const id of ['position', 'temperature', 'challenge']) {
    await send('start-experiment', id);
    await page.getByTestId('run-simulation').waitFor();
    await page.getByTestId('feature-home').click();
    await page.getByTestId('homepage-frame').waitFor({ state: 'visible' });
  }
  assert.equal(await page.evaluate(() => testDisk.size), 4);
  console.log('PASS all four real experiment routes');
  await frame.waitForFunction(() => received.some(message => message.type === 'context' && message.experimentCount === 4));
  console.log('PASS homepage context reflects saved records');
  assert.deepEqual(errors, []);
  console.log('PASS no renderer exceptions');
} finally {
  await browser?.close();
  await server.close();
}

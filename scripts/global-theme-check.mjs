import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { captureElectron } from './capture-electron.mjs';

const require = createRequire(import.meta.url);
const { _electron } = require(process.env.KX_PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packaged = process.argv.includes('--packaged');
const variant = packaged ? 'packaged' : 'source';
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
const executablePath = path.join(root, packaged ? `release/控小助-${version}-win32-x64/控小助.exe` : 'node_modules/electron/dist/electron.exe');
const dataDir = path.join(root, '.test-data', `global-theme-${variant}-${Date.now()}`);
const screenshotDir = path.join(root, 'evidence', 'screenshots');
await fs.mkdir(screenshotDir, { recursive: true });
const env = { ...process.env, KX_TEST_MODE: '1', KX_TEST_SHOW: '1', KX_TEST_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
if (packaged) env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
const report = {
  version, packaged, executablePath, dataDir, startedAt: new Date().toISOString(), checks: [], screenshots: [], errors: [],
  scope: '真实 Electron、隔离用户目录和实际页面操作；验证全软件主题、计算曲线对比与关闭重启持久化。仅查看未配置的 AI 界面，不调用在线模型；阻止并记录 renderer 的 HTTP(S) 请求。颜色检查基于计算样式，截图另供人工复核。',
};
const record = (name, details = true) => { report.checks.push({ name, details }); console.log('PASS', name); };
const rendererErrors = [], networkAttempts = [];
let app, page, home;

async function launch() {
  app = await _electron.launch({ executablePath, args: packaged ? [] : [root], env, timeout: 40000 });
  await app.context().route(/^https?:\/\//, route => { networkAttempts.push(route.request().url()); return route.abort(); });
  page = await app.firstWindow();
  page.on('pageerror', error => rendererErrors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await connectHome();
}
async function connectHome() {
  await page.getByTestId('homepage-frame').waitFor({ state: 'visible', timeout: 40000 });
  home = await (await page.getByTestId('homepage-frame').elementHandle()).contentFrame();
  await home.waitForFunction(() => window.__kxHome?.getState().ready, null, { timeout: 60000 });
  await home.waitForFunction(() => window.__kxHome?.getState().intro?.completed, null, { timeout: 30000 });
}
async function themeIs(theme) {
  await page.waitForFunction(expected => document.documentElement.dataset.colorTheme === expected, theme);
  assert.equal(await page.evaluate(() => localStorage.getItem('kx-color-theme-v1')), theme);
}
async function homeThemeIs(theme) {
  await home.waitForFunction(expected => window.__kxHome.getState().prefs.dark === (expected === 'dark') &&
    document.documentElement.dataset.darkSurface === String(expected === 'dark'), theme, { timeout: 45000 });
}
async function shot(name) {
  const file = path.join(screenshotDir, `global-theme-${variant}-${name}.png`);
  await captureElectron(app, file); report.screenshots.push(file);
}
async function styles(selectors) {
  return page.evaluate(selectors => {
    const rgba = value => {
      const values = value.match(/[\d.]+/g)?.map(Number);
      if (!values || values.length < 3) throw new Error(`Unsupported computed color: ${value}`);
      return [...values.slice(0, 3), values[3] ?? 1];
    };
    const background = element => {
      const chain = []; for (let node = element; node; node = node.parentElement) chain.unshift(node);
      return chain.reduce((under, node) => {
        const over = rgba(getComputedStyle(node).backgroundColor);
        return under.map((value, i) => value * (1 - over[3]) + over[i] * over[3]);
      }, [255, 255, 255]);
    };
    return selectors.map(selector => {
      const element = document.querySelector(selector);
      if (!element || !element.getClientRects().length) throw new Error(`Missing visible element: ${selector}`);
      const css = getComputedStyle(element);
      const svgText = element instanceof SVGElement && element.tagName.toLowerCase() === 'text';
      const foreground = rgba(svgText ? css.fill : css.color);
      const bg = background(element);
      return { selector, foreground: foreground.slice(0, 3).map((v, i) => v * foreground[3] + bg[i] * (1 - foreground[3])), background: bg,
        backgroundImage: css.backgroundImage, stroke: css.stroke, fill: css.fill };
    });
  }, selectors);
}
const luminance = rgb => rgb.map(v => { const n = v / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; })
  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
async function checkSurface(name, selectors, theme = 'light') {
  await themeIs(theme);
  const samples = await styles(selectors);
  for (const sample of samples) {
    const lightness = luminance(sample.background);
    assert.ok(theme === 'light' ? lightness > 0.6 : lightness < 0.15, `${sample.selector}: ${theme} background expected, got ${sample.background}`);
    sample.contrast = contrast(sample.foreground, sample.background);
    assert.ok(sample.contrast >= 4.5, `${sample.selector}: text contrast ${sample.contrast.toFixed(2)} < 4.5`);
  }
  record(name, samples);
}
async function checkChart(theme) {
  const samples = await styles(['.response-chart svg', '.response-chart .axis-label', '.chart-readout strong']);
  const traces = await page.locator('.response-chart path[data-run-id]').evaluateAll(nodes => nodes.map(node => ({
    runId: node.dataset.runId, stroke: getComputedStyle(node).stroke, dash: getComputedStyle(node).strokeDasharray, d: node.getAttribute('d'),
  })));
  assert.ok(traces.length >= 2, 'current and comparison curves must both be present');
  const bg = samples[0].background;
  for (const trace of traces) {
    assert.ok(trace.d?.startsWith('M') && !/NaN|Infinity/.test(trace.d));
    const rgb = trace.stroke.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    assert.ok(rgb?.length === 3, `invalid stroke: ${trace.stroke}`);
    trace.contrast = contrast(rgb, bg);
    assert.ok(trace.contrast >= 3, `${theme} curve contrast ${trace.contrast.toFixed(2)} < 3`);
    delete trace.d;
  }
  assert.notEqual(traces[0].stroke, traces[1].stroke);
  assert.notEqual(traces[0].dash, traces[1].dash);
  for (const sample of samples.slice(1)) assert.ok(contrast(sample.foreground, sample.background) >= 4.5);
  record(`${theme}：实际响应与固定对照曲线、坐标和读数清晰可辨`, { samples, traces });
  return traces;
}
async function openSettings() {
  await page.getByTestId('open-settings').click();
  const dialog = page.getByRole('dialog', { name: '模型与本机设置', exact: true });
  await dialog.waitFor(); return dialog;
}
async function run(kp) {
  await page.getByLabel('比例 Kp', { exact: true }).fill(String(kp));
  await page.getByLabel('比例 Kp', { exact: true }).press('Tab');
  const old = await page.locator('.response-chart path[data-run-id]').first().getAttribute('data-run-id').catch(() => null);
  await page.getByTestId('run-simulation').click();
  await page.waitForFunction(oldId => {
    const button = document.querySelector('[data-testid="run-simulation"]');
    const trace = document.querySelector('.response-chart path[data-run-id]');
    return button?.textContent === '运行仿真' && trace && trace.dataset.runId !== oldId;
  }, old);
}

try {
  await launch();
  const bootstrap = await page.evaluate(() => window.kongxiaozhu.getBootstrap());
  assert.equal(path.resolve(bootstrap.dataPath), dataDir);
  assert.equal(bootstrap.settings.hasKey, false);
  await themeIs('light'); await homeThemeIs('light');
  record('没有已保存偏好时，首次启动的主页与外层默认浅色');
  await home.locator('[data-action="settings"]').click();
  await home.locator('[data-color-theme="dark"]').click();
  await themeIs('dark'); await homeThemeIs('dark');
  await app.close(); app = undefined;
  await launch();
  await themeIs('dark'); await homeThemeIs('dark');
  record('从原设置入口选择深色后，重启仍保留手动选择');
  await home.evaluate(() => {
    localStorage.setItem('kx-home-settings-v1', JSON.stringify({ dark: false }));
    localStorage.removeItem('kx-color-theme-v1');
  });
  assert.equal(await home.evaluate(() => localStorage.getItem('kx-color-theme-v1')), null);
  await app.close(); app = undefined;
  await launch();
  await themeIs('light'); await homeThemeIs('light');
  await shot('legacy-migration-light');
  record('仅有旧主页 dark=false 偏好的用户重启后，主页与外层均迁移为亮色');
  await home.locator('[data-action="settings"]').click();
  await home.locator('[data-color-theme="dark"]').click();
  await themeIs('dark'); await homeThemeIs('dark');
  await home.locator('[data-color-theme="light"]').click();
  await themeIs('light'); await homeThemeIs('light');
  const homePaper = await home.locator('#stage').evaluate(node => getComputedStyle(node).backgroundColor);
  const workspacePaper = await page.locator('html').evaluate(node => getComputedStyle(node).backgroundColor);
  assert.equal(homePaper, 'rgb(232, 229, 225)', 'home reference uses the existing warm ivory surface');
  assert.equal(workspacePaper, homePaper, 'workspace paper must match the visible home background, not the unused blue-grey token');
  record('工作区底色与主页实际浅米白背景完全一致', { homePaper, workspacePaper });
  assert.equal(await home.locator('[data-color-theme="light"]').getAttribute('aria-pressed'), 'true');
  await shot('home-light');
  await home.locator('[data-action="close-modal"]').click();
  await home.locator('[data-action="search"]').click();
  await home.locator('.modal-backdrop[data-transition="open"]').waitFor();
  assert.equal(await home.locator('.modal-bottom [data-action="library"]').evaluate(node => getComputedStyle(node).fontSize), '12px');
  await shot('index-light');
  record('实验索引底部实验库入口字体放大且按钮可操作');
  await home.locator('[data-action="library"]').click();
  await page.getByTestId('start-motor').waitFor();
  await checkSurface('主页亮色同步至实验库、导航与案例卡', ['html', '.app-chrome', '.module-navigation', '.case-card', '.case-card h2', '.case-card p', '.case-card li']);
  await shot('library-light');

  await page.getByTestId('start-motor').click();
  await page.getByLabel('自动运行', { exact: true }).uncheck();
  await page.getByTestId('run-simulation').waitFor();
  await run(2); await run(3);
  await checkSurface('工作台参数、指标、图表与字段使用亮色', ['.workbench', '.controller-panel', '.controller-panel input:not(:disabled)', '.metric', '.metric strong', '.chart-readout']);
  const lightTraces = await checkChart('light');
  await shot('workbench-light');
  await page.getByTestId('ai-assistant-launcher').click();
  await page.getByTestId('ai-assistant-drawer').waitFor();
  assert.equal(await page.getByRole('button', { name: '提出并验证建议', exact: true }).isDisabled(), true);
  await checkSurface('AI 抽屉及输入框使用亮色，未配置模型不能发起请求', ['.ai-drawer', '.ai-drawer textarea', '.ai-drawer .callout']);
  await shot('ai-light');
  let settings = await openSettings();
  const themes = () => settings.getByRole('group', { name: '界面配色', exact: true });
  assert.equal(await themes().getByRole('button', { name: '亮色', exact: true }).getAttribute('aria-pressed'), 'true');
  await checkSurface('模型设置同步配色与可读字段', ['.modal', '.modal input:not([type="checkbox"])', '.modal select', '.modal p.muted']);
  await shot('settings-light');
  await settings.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await page.getByRole('button', { name: '关闭 AI 实验助手', exact: true }).click();
  await page.getByTestId('nav-records').click();
  await page.locator('.record-card').first().waitFor();
  await checkSurface('我的实验与已保存记录使用亮色', ['.record-card', '.record-card h2', '.record-note']);
  await shot('records-light');
  await page.getByTestId('nav-verification').click();
  await checkSurface('开放与验证内容使用亮色', ['.verification-page', '.verification-grid .panel', '.verification-grid .panel p', '.verification-grid li']);
  await shot('verification-light');

  await page.getByTestId('nav-workbench').click();
  settings = await openSettings();
  await themes().getByRole('button', { name: '暗色', exact: true }).click();
  await themeIs('dark');
  await settings.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await checkSurface('外层设置切换暗色后工作台与字段同步恢复', ['.workbench', '.controller-panel', '.controller-panel input:not(:disabled)'], 'dark');
  const darkTraces = await checkChart('dark');
  assert.notEqual(lightTraces[0].stroke, darkTraces[0].stroke, 'curve palette must adapt to the background');
  await shot('workbench-dark');
  await page.getByTestId('feature-home').click();
  await page.getByTestId('homepage-frame').waitFor({ state: 'visible' });
  await homeThemeIs('dark');
  await home.locator('[data-action="settings"]').click();
  assert.equal(await home.locator('[data-color-theme="dark"]').getAttribute('aria-pressed'), 'true');
  await home.locator('[data-action="close-modal"]').click();
  record('外层模型设置反向同步主页暗色按钮与三维主题');

  await home.locator('[data-action="continue"]').click();
  settings = await openSettings();
  await themes().getByRole('button', { name: '亮色', exact: true }).click();
  await themeIs('light');
  await settings.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await page.getByTestId('feature-home').click();
  await page.getByTestId('homepage-frame').waitFor({ state: 'visible' });
  await homeThemeIs('light');
  await app.close(); app = undefined;
  await launch();
  await themeIs('light'); await homeThemeIs('light');
  await shot('restart-light');
  record('退出并以同一隔离目录重启后，外层与主页均记住亮色');

  assert.deepEqual(networkAttempts, []);
  assert.deepEqual(rendererErrors, []);
  record('全部检查未触发 HTTP(S) 请求或 renderer 异常');
  report.passed = true;
} catch (error) {
  report.passed = false; report.errors.push(error.stack || String(error)); console.error(error);
  await shot('failure').catch(() => {}); process.exitCode = 1;
} finally {
  report.rendererErrors = rendererErrors; report.networkAttempts = networkAttempts;
  report.finishedAt = new Date().toISOString();
  if (app) await app.close().catch(() => {});
  await fs.writeFile(path.join(root, 'evidence', `global-theme-${variant}.json`), JSON.stringify(report, null, 2));
}

import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const playwrightPath = process.env.KX_PLAYWRIGHT_PATH || 'playwright';
const { _electron } = require(playwrightPath);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packaged = process.argv.includes('--packaged');
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
const executablePath = packaged ? path.join(root, 'release', `控小助-${version}-win32-x64`, '控小助.exe') : path.join(root, 'node_modules/electron/dist/electron.exe');
const dataDir = path.join(root, '.test-data', `workbench-layout-${Date.now()}`);
const evidenceDir = path.join(root, 'evidence');
const screenshotDir = path.join(evidenceDir, 'screenshots');
const suffix = packaged ? '-packaged' : '';
const evidence = path.join(evidenceDir, `workbench-layout-check${suffix}.json`);
await fs.mkdir(dataDir, { recursive: true });
await fs.mkdir(screenshotDir, { recursive: true });
const report = {
  startedAt: new Date().toISOString(), version, packaged, executablePath, dataDir,
  checks: [], errors: [], screenshots: [],
  scope: '真实 Electron 与正式桌面桥在独立测试目录中验证布局、参数计算、候选比较、记录与导出。AI 仅检查未配置状态和侧窗交互，不调用在线模型，也不读取正式用户数据。',
};
const record = (name, details = true) => { report.checks.push({ name, details }); console.log(`PASS ${name}`); };
const env = { ...process.env, KX_TEST_MODE: '1', KX_TEST_SHOW: '1', KX_TEST_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const rendererErrors = [];
const tabs = { response: '响应与指标', comparison: '方案对比', learning: '预测与复盘', history: '运行记录' };
async function openLibraryFromHome() {
  await page.getByTestId('homepage-frame').waitFor({ state: 'visible', timeout: 30000 });
  const home = page.frameLocator('[data-testid="homepage-frame"]');
  await home.locator('[data-action="search"]').click();
  await home.getByRole('dialog', { name: '实验索引', exact: true }).waitFor();
  await home.locator('[data-action="library"]').click();
  await page.getByTestId('start-motor').waitFor();
}

try {
  app = await _electron.launch({ executablePath, args: packaged ? [] : [root], env, timeout: 30000 });
  page = await app.firstWindow();
  page.on('pageerror', error => rendererErrors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await openLibraryFromHome();
  const boot = await page.evaluate(() => window.kongxiaozhu.getBootstrap());
  assert.equal(path.resolve(boot.dataPath), dataDir);
  assert.equal(boot.experiments.length, 0);
  assert.equal(boot.settings.hasKey, false);
  report.runtime = await app.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome }));

  const selectTab = async id => {
    const tab = page.getByTestId(`workspace-tab-${id}`);
    await tab.click();
    assert.equal(await tab.getAttribute('aria-selected'), 'true');
    await page.locator(`#workspace-panel-${id}`).waitFor({ state: 'visible' });
  };
  const closeNotice = async () => {
    const buttons = page.getByRole('button', { name: '关闭提示', exact: true });
    if (await buttons.count()) await buttons.first().click();
  };
  const fillNumber = async (label, value) => {
    const field = page.getByLabel(label, { exact: true });
    await field.fill(String(value)); await field.press('Tab');
  };
  const run = async () => {
    const currentPath = page.locator('.response-chart path[data-series-index="0"]');
    const currentId = await currentPath.count() ? await currentPath.getAttribute('data-run-id') : null;
    await page.getByTestId('run-simulation').click();
    await page.waitForFunction(oldId => {
      const path = document.querySelector('.response-chart path[data-series-index="0"]');
      return path && path.getAttribute('data-run-id') !== oldId;
    }, currentId);
  };
  const screenshot = async name => {
    const file = path.join(screenshotDir, `workbench-layout${suffix}-${name}.png`);
    await page.screenshot({ path: file }); report.screenshots.push(file);
  };
  const resize = async (width, height) => {
    await app.evaluate(({ BrowserWindow }, { width, height }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setMinimumSize(600, 480); window.setContentSize(width, height);
    }, { width, height });
    await page.waitForFunction(size => window.innerWidth === size.width && window.innerHeight === size.height, { width, height });
  };
  const geometry = async () => page.evaluate(() => {
    const rect = selector => {
      const el = document.querySelector(selector); if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflowY: getComputedStyle(el).overflowY };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, scrollY },
      parameters: rect('.parameter-pane'), main: rect('.workbench-main'), active: rect('.workspace-view:not([hidden])'),
      lastMetric: rect('#workspace-panel-response .metric:last-child'), controller: rect('.controller-panel'),
      toolbar: rect('.workbench-toolbar'), aiLauncher: rect('.ai-launcher'),
    };
  });

  await page.getByTestId('start-motor').click();
  await page.getByLabel('自动运行', { exact: true }).uncheck();
  for (const [id, name] of Object.entries(tabs)) assert.equal(await page.getByTestId(`workspace-tab-${id}`).getAttribute('role'), 'tab', name);
  await selectTab('response');
  await fillNumber('比例 Kp', 2); await fillNumber('积分 Ki', 4); await run();
  await page.getByText('全部必需条件在声明的计算和观察条件下通过', { exact: true }).first().waitFor();
  assert.equal(await page.locator('#workspace-panel-response .metric').count(), 5);
  record('真实参数仿真与五项指标正常，四个工作区均具备标签语义');
  await closeNotice();

  for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080], [1040, 720]]) {
    await resize(width, height);
    await selectTab('response');
    const g = await geometry();
    assert.ok(g.document.width <= width + 1, `横向溢出：${JSON.stringify(g)}`);
    assert.ok(g.document.height <= height + 2, `页面出现长滚动：${JSON.stringify(g)}`);
    assert.ok(g.parameters.height > 200 && g.active.height > 200, '参数区和内容区有可用高度');
    assert.ok(g.parameters.bottom <= height + 1 && g.main.bottom <= height + 1, '工作区完整留在视口内');
    assert.ok(['auto', 'scroll'].includes(g.parameters.overflowY), '左侧参数使用独立滚动');
    assert.ok(['auto', 'scroll'].includes(g.active.overflowY), '当前标签内容使用独立滚动');
    assert.ok(g.lastMetric.bottom <= g.active.bottom + 1, '默认响应区完整显示五项指标');
    assert.ok(!g.aiLauncher || g.aiLauncher.bottom <= g.lastMetric.y || g.aiLauncher.y >= g.lastMetric.bottom || g.aiLauncher.right <= g.lastMetric.x || g.aiLauncher.x >= g.lastMetric.right, 'AI 入口不遮挡控制峰值指标');
    assert.ok(g.controller.y >= g.parameters.y - 1 && g.controller.y < g.parameters.y + 2, '常用控制器位于参数区顶部');
    const independentScroll = await page.evaluate(() => {
      const left = document.querySelector('.parameter-pane');
      const right = document.querySelector('.workspace-view:not([hidden])');
      const before = { document: scrollY, right: right.scrollTop };
      left.scrollTop = Math.min(100, left.scrollHeight - left.clientHeight);
      const after = { document: scrollY, right: right.scrollTop, left: left.scrollTop };
      left.scrollTop = 0;
      return { before, after };
    });
    assert.equal(independentScroll.after.document, independentScroll.before.document);
    assert.equal(independentScroll.after.right, independentScroll.before.right);
    await screenshot(`${width}x${height}`);
    record(`${width}×${height} 无页面长滚动或横向溢出，左右区域分别滚动`, g);
  }
  await resize(1440, 900);

  await selectTab('learning');
  const draft = '切换标签后仍然保留的预测草稿。';
  const prediction = page.getByLabel('操作前，我预计会发生什么', { exact: true });
  await prediction.fill(draft);
  await selectTab('response'); await selectTab('learning');
  assert.equal(await prediction.inputValue(), draft);
  await page.getByRole('button', { name: '保存预测', exact: true }).click();
  await page.getByLabel('实验后的观察', { exact: true }).fill('PI 参考方案实际计算达标。');
  await page.getByLabel('实验笔记', { exact: true }).fill('布局专项验证：记录内容保留。');
  await page.getByLabel('个人结论与取舍', { exact: true }).fill('本次保留 PI 方案，控制峰值为 2。');
  await selectTab('response'); await selectTab('learning');
  assert.equal(await page.getByLabel('实验后的观察', { exact: true }).inputValue(), 'PI 参考方案实际计算达标。');
  await screenshot('learning');
  record('预测草稿跨标签保留，预测、观察、笔记和结论可以编辑');

  await selectTab('comparison');
  await page.getByRole('button', { name: '生成自动整定对照', exact: true }).click();
  await page.locator('.candidate').first().waitFor();
  await page.getByLabel('加入比较', { exact: true }).first().check();
  await page.locator('.comparison-table').waitFor();
  const comparisonRows = await page.locator('.comparison-table tbody tr').count();
  assert.ok(comparisonRows >= 2);
  await screenshot('comparison');
  await selectTab('response');
  assert.ok(await page.locator('.response-chart path[data-run-id]').count() >= 2);
  record('自动整定和候选比较可用，切回响应保留所选叠加曲线', { comparisonRows });

  const aiTrigger = page.getByRole('button', { name: 'AI 助手', exact: true });
  const aiDialog = page.getByRole('dialog', { name: 'AI 实验助手', exact: true });
  await aiTrigger.click(); await aiDialog.waitFor();
  const aiQuestion = aiDialog.getByLabel('描述你观察到的问题', { exact: true });
  await aiQuestion.fill('请保留这段 AI 问题草稿。');
  assert.equal(await aiDialog.getByRole('button', { name: '提出并验证建议', exact: true }).isDisabled(), true);
  await fillNumber('比例 Kp', 2.5);
  assert.equal(await page.getByLabel('比例 Kp', { exact: true }).inputValue(), '2.5');
  await aiQuestion.click(); await page.keyboard.press('Escape');
  await aiDialog.waitFor({ state: 'hidden' });
  assert.equal(await aiTrigger.evaluate(el => el === document.activeElement), true);
  await aiTrigger.click(); await aiDialog.waitFor();
  assert.equal(await aiQuestion.inputValue(), '请保留这段 AI 问题草稿。');
  record('AI 侧窗为非模态，主区可调参，关闭重开保留草稿，Escape 恢复入口焦点');

  await aiDialog.getByRole('button', { name: '配置 DeepSeek 或其他模型', exact: true }).click();
  await page.getByRole('dialog', { name: '模型与本机设置', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: '模型与本机设置', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await aiDialog.isVisible(), true);
  assert.equal(await aiQuestion.inputValue(), '请保留这段 AI 问题草稿。');
  await screenshot('ai-drawer');
  await aiDialog.getByRole('button', { name: '前往方案对比', exact: true }).click();
  await aiDialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByTestId('workspace-tab-comparison').getAttribute('aria-selected'), 'true');
  record('模型设置置于侧窗上层，Escape 只关闭设置而不丢失侧窗草稿');
  record('AI 侧窗可直接进入方案对比并收起窗口');

  await page.getByTestId('workspace-tab-response').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.getByTestId('workspace-tab-response').evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByTestId('workspace-tab-comparison').evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('End');
  assert.equal(await page.getByTestId('workspace-tab-history').evaluate(el => el === document.activeElement), true);
  record('工作区标签支持 Enter 激活并保留焦点、方向键与 End 键导航');

  await selectTab('response'); await fillNumber('比例 Kp', 2); await run(); await closeNotice();
  await selectTab('history');
  await page.getByRole('button', { name: '复算核对', exact: true }).first().click();
  await page.getByText('复算一致', { exact: true }).waitFor();
  await page.getByRole('button', { name: '立即保存', exact: true }).click();
  const exportFile = path.join(dataDir, 'layout-export.json');
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, exportFile);
  await page.getByRole('button', { name: '导出实验包', exact: true }).click();
  await page.getByText(/已导出：/).waitFor();
  assert.ok((await fs.stat(exportFile)).size > 100);
  const experimentList = await page.evaluate(() => window.kongxiaozhu.listExperiments());
  const saved = experimentList[0];
  assert.equal(saved.predictions[0].text, draft);
  assert.equal(saved.notes, '布局专项验证：记录内容保留。');
  assert.equal(saved.reflection, '本次保留 PI 方案，控制峰值为 2。');
  await closeNotice(); await screenshot('history');
  record('运行记录支持复算、保存和导出，标签切换后的笔记完整保存');

  await resize(760, 900); await selectTab('response');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await aiTrigger.click(); await aiDialog.waitFor();
  const drawerRect = await aiDialog.boundingBox();
  assert.ok(drawerRect.x >= 0 && drawerRect.x + drawerRect.width <= 761);
  await screenshot('narrow-ai-drawer');
  record('760 像素窄窗口无横向溢出，AI 侧窗保持可读和可关闭');

  assert.deepEqual(rendererErrors, []);
  report.passed = true;
} catch (error) {
  report.passed = false; report.errors.push(error.stack || error.message); process.exitCode = 1;
  if (page) {
    const failureScreenshot = path.join(screenshotDir, `workbench-layout${suffix}-failure.png`);
    await page.screenshot({ path: failureScreenshot }).then(() => report.screenshots.push(failureScreenshot)).catch(() => {});
  }
} finally {
  report.rendererErrors = rendererErrors;
  if (app) await app.close().catch(error => report.errors.push(`测试窗口清理失败：${error.message}`));
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(evidence, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Evidence: ${evidence}`);
  if (!report.passed) console.error(report.errors.join('\n'));
}

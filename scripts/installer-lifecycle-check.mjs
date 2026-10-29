import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { CASES } from '../src/core/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const version = option('--version') || pkg.version;
const previousVersion = option('--from-version') || version;
const fresh = process.argv.includes('--fresh');
assert.match(version, /^\d+\.\d+\.\d+$/);
assert.match(previousVersion, /^\d+\.\d+\.\d+$/);
assert.ok(!fresh || previousVersion === version, '--fresh 必须直接全新安装目标版本');
const installer = v => path.join(root, 'release', `控小助-${v}-安装包.exe`);
const testRoot = path.join(root, '.test-data', `installer-${version}-${Date.now()}`);
const installDir = path.join(testRoot, '程序');
const dataDir = path.join(testRoot, '用户数据');
const executablePath = path.join(installDir, '控小助.exe');
const require = createRequire(import.meta.url);
const { _electron } = require(process.env.KX_PLAYWRIGHT_PATH || 'playwright');
const report = { version, previousVersion, reportType: fresh ? 'fresh-install-and-reinstall' : 'upgrade-lifecycle', installer: installer(version), startedAt: new Date().toISOString(), testRoot, checks: [], errors: [], scope: '同一个完整安装包的本机隔离安装、覆盖升级、运行锁拦截与卸载验证；KXISOLATED=1 仅跳过真实桌面/开始菜单快捷方式与系统卸载注册。应用使用独立测试数据目录，未访问真实 API。' };
let app;
await fs.mkdir(dataDir, { recursive: true });
const record = (name, detail = true) => { report.checks.push({ name, detail }); console.log(`PASS ${name}`); };
const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');

async function runInstaller(targetVersion, suffix, expectedExit = 0, destination = installDir) {
  const args = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/KXISOLATED=1', '/NOICONS', `/DIR=${destination}`, `/LOG=${path.join(testRoot, `${suffix}.log`)}`];
  const code = await new Promise((resolve, reject) => {
    const child = spawn(installer(targetVersion), args, { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => reject(new Error('安装器超过 120 秒，未主动终止安装进程，请检查日志。')), 120_000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', exitCode => { clearTimeout(timer); resolve(exitCode); });
  });
  assert.equal(code, expectedExit, `安装器退出码应为 ${expectedExit}，实为 ${code}，详见 ${suffix}.log`);
}

async function verifyPayload(expectedVersion) {
  const manifest = JSON.parse(await fs.readFile(path.join(installDir, '发布清单.json'), 'utf8'));
  assert.equal(manifest.app, pkg.name);
  assert.equal(manifest.version, expectedVersion);
  for (const file of manifest.files) {
    const target = path.resolve(installDir, file.path);
    assert.ok(target.startsWith(installDir + path.sep));
    assert.equal((await fs.stat(target)).size, file.bytes, file.path);
    assert.equal(await hash(target), file.sha256, file.path);
  }
  return manifest.files.length;
}

async function runUninstaller(suffix, expectedExit) {
  const uninstaller = (await fs.readdir(installDir)).find(name => /^unins\d+\.exe$/.test(name));
  assert.ok(uninstaller, '安装目录缺少卸载程序');
  const code = await new Promise((resolve, reject) => {
    const child = spawn(path.join(installDir, uninstaller), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/LOG=${path.join(testRoot, `${suffix}.log`)}`], { windowsHide: true, stdio: 'ignore' });
    child.on('error', reject); child.on('exit', resolve);
  });
  assert.equal(code, expectedExit, `${suffix} 退出码`);
}

async function launch() {
  const env = { ...process.env, KX_TEST_MODE: '1', KX_TEST_DATA_DIR: dataDir, KX_TEST_SHOW: '1', PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}` };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath, args: [], env, timeout: 30000 });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.kongxiaozhu, { timeout: 20_000 });
  const bootstrap = await page.evaluate(() => window.kongxiaozhu.getBootstrap());
  assert.equal(path.resolve(bootstrap.dataPath), dataDir);
  if (Number(bootstrap.appVersion.split('.')[0]) >= 1) {
    await page.getByTestId('homepage-frame').waitFor({ state: 'visible', timeout: 30000 });
    const home = page.frameLocator('[data-testid="homepage-frame"]');
    await home.getByTestId('home-open-detail').waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(await page.getByTestId('start-motor').isVisible(), false, '新版默认主页不能直接显示实验库');
  } else {
    await page.getByTestId('start-motor').waitFor({ state: 'visible' });
  }
  return { page, bootstrap };
}

// 全部导航、配置、仿真、保存与复算通过实际界面操作，桥接只用于只读核对持久化结果。
async function openSettings(page, bootstrap) {
  if (Number(bootstrap.appVersion.split('.')[0]) >= 1) {
    const home = page.frameLocator('[data-testid="homepage-frame"]');
    await home.locator('[data-action="settings"]').click();
    await home.getByRole('dialog', { name: '主页设置', exact: true }).waitFor();
    await home.locator('[data-action="api-settings"]').click();
  } else {
    await page.getByTestId('open-settings').click();
  }
  await page.getByRole('dialog', { name: '模型与本机设置', exact: true }).waitFor();
}

async function startMotor(page, bootstrap) {
  if (Number(bootstrap.appVersion.split('.')[0]) >= 1) {
    const home = page.frameLocator('[data-testid="homepage-frame"]');
    await home.getByTestId('home-open-detail').click();
    await home.getByTestId('home-start-motor').click();
  } else {
    await page.getByTestId('start-motor').click();
  }
  await page.getByTestId('run-simulation').waitFor({ state: 'visible' });
  if (Number(bootstrap.appVersion.split('.')[0]) >= 1) {
    assert.equal(await page.getByTestId('homepage-frame').isVisible(), false);
  }
}

async function openRecords(page, bootstrap) {
  if (Number(bootstrap.appVersion.split('.')[0]) >= 1) {
    const home = page.frameLocator('[data-testid="homepage-frame"]');
    await home.locator('[data-action="records"]').click();
  } else {
    await page.getByTestId('nav-records').click();
  }
  await page.getByRole('heading', { name: '我的实验', exact: true }).waitFor();
}

async function closeNormally() {
  const process = app.process();
  const closed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('测试应用正常退出超时。')), 20000);
    process.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
  app = undefined;
}

try {
  await fs.access(installer(version));
  await fs.access(installer(previousVersion));
  report.installerSha256 = await hash(installer(version));
  const unrelatedDir = path.join(testRoot, '其他软件');
  await fs.mkdir(unrelatedDir);
  const unrelatedFile = path.join(unrelatedDir, 'keep.txt');
  await fs.writeFile(unrelatedFile, 'unrelated-data');
  await runInstaller(version, 'reject-unrelated-folder', 7, unrelatedDir);
  assert.equal(await fs.readFile(unrelatedFile, 'utf8'), 'unrelated-data');
  assert.deepEqual(await fs.readdir(unrelatedDir), ['keep.txt']);
  record('非空无关目录拒绝覆盖');

  const linkedDir = path.join(testRoot, '含目录联接的程序');
  const linkedTarget = path.join(testRoot, '目录联接目标');
  await fs.mkdir(linkedDir);
  await fs.mkdir(linkedTarget);
  await fs.writeFile(path.join(linkedDir, '发布清单.json'), JSON.stringify({ app: pkg.name }));
  await fs.writeFile(path.join(linkedTarget, 'keep.txt'), 'linked-data');
  await fs.symlink(linkedTarget, path.join(linkedDir, 'resources'), 'junction');
  await runInstaller(version, 'reject-directory-junction', 7, linkedDir);
  assert.equal(await fs.readFile(path.join(linkedTarget, 'keep.txt'), 'utf8'), 'linked-data');
  assert.deepEqual(await fs.readdir(linkedTarget), ['keep.txt']);
  record('程序子目录存在目录联接时拒绝覆盖');

  await runInstaller(previousVersion, 'fresh-install');
  record('全新安装后逐文件 SHA-256 一致', await verifyPayload(previousVersion));
  assert.ok((await fs.readdir(installDir)).some(name => /^unins\d+\.exe$/.test(name)));
  let { page, bootstrap } = await launch();
  assert.equal(bootstrap.experiments.length, 0);
  await openSettings(page, bootstrap);
  await page.getByLabel('模型名称', { exact: true }).fill('installer-lifecycle-test');
  await page.getByLabel('请求超时', { exact: true }).fill('45');
  await page.getByLabel('请求超时', { exact: true }).press('Tab');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.getByText('设置已保存。密钥不会进入实验包或运行报告。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
  record('从实际设置入口保存模型名称与超时，不调用在线 API');
  await startMotor(page, bootstrap);
  await page.getByLabel('自动运行', { exact: true }).uncheck();
  const definition = CASES.find(item => item.id === 'motor');
  await page.getByLabel('比例 Kp', { exact: true }).fill(String(definition.referenceController.kp));
  await page.getByLabel('比例 Kp', { exact: true }).press('Tab');
  await page.getByLabel('积分 Ki', { exact: true }).fill(String(definition.referenceController.ki));
  await page.getByLabel('积分 Ki', { exact: true }).press('Tab');
  await page.getByLabel('实验名称', { exact: true }).fill('安装升级保留实验');
  await page.getByTestId('run-simulation').click();
  await page.getByText('全部必需条件在声明的计算和观察条件下通过', { exact: true }).first().waitFor();
  await page.getByTestId('workspace-tab-learning').click();
  await page.getByLabel('实验笔记', { exact: true }).fill('升级后必须保留');
  await page.getByLabel('个人结论与取舍', { exact: true }).fill('正常保存退出后升级');
  await page.getByTestId('workspace-tab-history').click();
  await page.getByRole('button', { name: '立即保存', exact: true }).click();
  await page.waitForFunction(async () => (await window.kongxiaozhu.listExperiments()).some(item => item.title === '安装升级保留实验' && item.notes === '升级后必须保留' && item.reflection === '正常保存退出后升级' && item.runs.some(run => run.verdict === 'pass')));
  const experiment = (await page.evaluate(() => window.kongxiaozhu.listExperiments())).find(item => item.title === '安装升级保留实验');
  const run = experiment.runs.find(item => item.id === experiment.activeRunId) || experiment.runs.at(-1);
  assert.equal(run.status, 'completed');
  assert.equal(run.verdict, 'pass');
  record('安装后通过真实实验入口调参、仿真、保存笔记，无需 Node.js PATH', run.metrics);
  await runInstaller(version, 'reject-running-app', 7);
  assert.equal(app.process().exitCode, null);
  record('运行中的程序拒绝覆盖，未强制退出');
  await closeNormally();
  const experimentFile = path.join(dataDir, 'experiments', `${experiment.id}.json`);
  const settingsFile = path.join(dataDir, 'settings.json');
  const preservedHashes = [await hash(experimentFile), await hash(settingsFile)];
  await runInstaller(version, 'upgrade-install');
  record('覆盖升级后逐文件 SHA-256 一致', await verifyPayload(version));
  assert.deepEqual([await hash(experimentFile), await hash(settingsFile)], preservedHashes);
  ({ page, bootstrap } = await launch());
  const restored = bootstrap.experiments.find(item => item.id === experiment.id);
  assert.equal(restored?.notes, experiment.notes);
  assert.deepEqual(restored.runs, experiment.runs);
  assert.equal(bootstrap.settings.model, 'installer-lifecycle-test');
  await openSettings(page, bootstrap);
  assert.equal(await page.getByLabel('模型名称', { exact: true }).inputValue(), 'installer-lifecycle-test');
  assert.equal(await page.getByLabel('请求超时', { exact: true }).inputValue(), '45');
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
  await openRecords(page, bootstrap);
  const card = page.locator('.record-card').filter({ has: page.getByRole('heading', { name: experiment.title, exact: true }) });
  await card.getByRole('button', { name: '恢复实验', exact: true }).click();
  await page.getByTestId('run-simulation').waitFor({ state: 'visible' });
  assert.equal(await page.getByLabel('实验名称', { exact: true }).inputValue(), experiment.title);
  await page.getByTestId('workspace-tab-learning').click();
  assert.equal(await page.getByLabel('实验笔记', { exact: true }).inputValue(), experiment.notes);
  assert.equal(await page.getByLabel('个人结论与取舍', { exact: true }).inputValue(), experiment.reflection);
  await page.getByTestId('workspace-tab-history').click();
  await page.getByRole('button', { name: '复算核对', exact: true }).first().click();
  await page.getByText('复算一致', { exact: true }).waitFor();
  record('升级后经实际设置与我的实验入口恢复数据，界面复算一致');
  await runUninstaller('reject-running-uninstall', 1);
  assert.equal(app.process().exitCode, null);
  await fs.access(executablePath);
  record('运行中的程序拒绝卸载，未强制退出');
  await closeNormally();
  // 恢复到工作台会正常更新保存时间；卸载前重新取哈希，区分 UI 保存与卸载行为。
  const beforeUninstallHashes = [await hash(experimentFile), await hash(settingsFile)];
  await runUninstaller('uninstall', 0);
  assert.deepEqual([await hash(experimentFile), await hash(settingsFile)], beforeUninstallHashes);
  await assert.rejects(fs.access(executablePath));
  record('卸载移除程序并保留独立实验与设置数据');
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.errors.push(error.stack || String(error));
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => {});
  report.finishedAt = new Date().toISOString();
  const evidencePath = path.join(root, 'evidence', `installer-lifecycle-${version}${fresh ? '-fresh' : ''}.json`);
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });
  await fs.writeFile(evidencePath, JSON.stringify(report, null, 2));
  const buildRecordPath = path.join(root, 'release', `控小助-${version}-安装包.build.json`);
  const buildRecord = JSON.parse((await fs.readFile(buildRecordPath, 'utf8')).replace(/^\uFEFF/, ''));
  if (buildRecord.sha256 === report.installerSha256) {
    if (fresh) {
      buildRecord.installerFreshTested = report.passed === true;
      buildRecord.installerFreshEvidence = path.relative(root, evidencePath).replaceAll('\\', '/');
      buildRecord.installerFreshEvidenceSha256 = await hash(evidencePath);
    } else {
      buildRecord.installerLifecycleTested = report.passed === true;
      buildRecord.installerLifecycleEvidence = path.relative(root, evidencePath).replaceAll('\\', '/');
      buildRecord.installerLifecycleEvidenceSha256 = await hash(evidencePath);
      buildRecord.installerLifecycleUpgradeFrom = previousVersion;
    }
    await fs.writeFile(buildRecordPath, JSON.stringify(buildRecord, null, 2));
  }
  console.log(JSON.stringify({ passed: report.passed, evidencePath, errors: report.errors }, null, 2));
}

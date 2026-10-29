import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// Mount the actual Hook AND Workbench. Only I/O timing is mocked; the simulator,
// comparison selection, React updates, SVG and legend come from product source.
const require = createRequire(import.meta.url);
const playwrightPath = process.env.KX_PLAYWRIGHT_PATH || 'playwright';
const { _electron } = require(playwrightPath);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, '.test-data', `comparison-${Date.now()}`);
const evidence = path.join(root, 'evidence', 'comparison-check.json');
await fs.mkdir(fixture, { recursive: true });
await fs.mkdir(path.dirname(evidence), { recursive: true });
await fs.writeFile(path.join(fixture, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>控小助固定对照回归</title><div id="root"></div><script type="module" src="./harness.jsx"></script></html>');
await fs.writeFile(path.join(fixture, 'harness.jsx'), `
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import useExperiment from '../../src/ui/control-lab/useExperiment.js';
import Workbench from '../../src/ui/control-lab/Workbench.jsx';
import { createExperiment } from '../../src/ui/control-lab/model.js';
import { simulate } from '../../src/core/index.mjs';
import '../../src/ui/theme.css';
const copy = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const h = window.harness = {
  ready: false, lab: null, holdSimulation: false, simulations: [], disk: new Map(),
  ids: {}, simulate, createExperiment, copy,
};
const api = {
  simulate(config, options) {
    const gate = { ...deferred(), config: copy(config), options };
    h.simulations.push(gate);
    if (!h.holdSimulation) queueMicrotask(() => gate.resolve(simulate(gate.config, options)));
    return gate.promise;
  },
  async saveExperiment(input) { const value = copy(input); h.disk.set(value.id, value); return copy(value); },
};
h.complete = async (name, automatic = false) => {
  const run = await h.lab.run({ automatic }); h.ids[name] = run.id; return run;
};
h.snapshot = () => {
  const exp = h.lab.experimentRef.current;
  return { version: exp.version, activeRunId: exp.activeRunId, comparisonRunId: exp.comparisonRunId,
    lastManualRunId: exp.lastManualRunId, runCount: exp.runs.length,
    activeVersion: exp.runs.find(run => run.id === exp.activeRunId)?.configVersion,
    comparisonVersion: exp.runs.find(run => run.id === exp.comparisonRunId)?.configVersion };
};
function Harness() {
  const lab = useExperiment(api); h.lab = lab;
  useEffect(() => { lab.setAutoRun(false); h.ready = true; }, []);
  return lab.experiment
    ? React.createElement(Workbench, { lab, api, settings: { model: 'isolated-test', hasKey: false }, onSettings() {} })
    : React.createElement('main', null, '正在准备固定对照回归。');
}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
`);
await fs.writeFile(path.join(fixture, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.setName('控小助固定对照回归');
app.setPath('userData', path.join(__dirname, 'electron-data'));
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1280, height: 900, show: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.loadFile(path.join(__dirname, 'dist/index.html'));
});
app.on('window-all-closed', () => app.quit());
`);

const report = {
  startedAt: new Date().toISOString(), fixture, checks: [], errors: [],
  scope: '独立 Electron 中真实挂载 React Hook 与 Workbench，仿真使用产品计算引擎；保存为内存 Map，延迟 API 仅控制回包顺序。不读取正式数据、不调用在线模型、不启动正式主进程。',
};
const rendererErrors = [];
let app;
const record = (name, details) => { report.checks.push({ name, details }); console.log(`PASS ${name}`); };
try {
  await build({ configFile: false, root: fixture, base: './', logLevel: 'warn', build: { outDir: 'dist', emptyOutDir: true } });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [path.join(fixture, 'main.cjs')], env, timeout: 30000 });
  const page = await app.firstWindow();
  page.on('pageerror', error => rendererErrors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const ready = () => page.waitForFunction(() => window.harness?.ready && window.harness.lab.autoRun === false);
  const snapshot = () => page.evaluate(() => window.harness.snapshot());
  const purple = page.locator('svg[role="img"] path[data-series-index="1"]');
  const assertPurple = async (count, version) => {
    await page.waitForFunction(expected => {
      const matches = document.querySelectorAll('svg[role="img"] path[data-series-index="1"]').length === expected.count;
      const legend = document.querySelector('.chart-readout')?.textContent || '';
      return matches && (!expected.count || new RegExp('固定对照 · v' + expected.version + '(?:\\D|$)').test(legend));
    }, { count, version });
    assert.equal(await purple.count(), count);
    if (count) {
      assert.match(await page.locator('.chart-readout').innerText(), new RegExp('固定对照 · v' + version + '(?:\\D|$)'));
      assert.ok((await purple.first().getAttribute('d')).startsWith('M'));
      assert.equal(await purple.first().getAttribute('data-run-id'), await page.evaluate(() => window.harness.lab.experimentRef.current.comparisonRunId));
    }
  };
  await ready();
  report.runtime = await app.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome }));

  await page.evaluate(async () => { const h = window.harness; await h.lab.startCase('motor'); await h.complete('initialAuto', true); });
  let state = await snapshot();
  assert.equal(state.comparisonRunId, state.activeRunId); assert.equal(state.lastManualRunId, null);
  await assertPurple(0);
  await page.evaluate(async () => { const h = window.harness; h.lab.editConfig({ controller: { kp: 1.2 } }); await h.complete('previewOne', true); });
  state = await snapshot();
  assert.equal(state.comparisonRunId, await page.evaluate(() => window.harness.ids.initialAuto));
  assert.equal(state.lastManualRunId, null); await assertPurple(1, 1);
  record('首次完成初始化对照，后续自动预览不推进', state);

  await page.evaluate(async () => {
    const h = window.harness; await h.complete('manualOne'); await h.complete('manualRepeat');
    // The version changes but the actual simulation configuration stays equal.
    h.lab.editConfig({ controller: { kp: 1.2 } }); await h.complete('sameConfigNewVersion');
  });
  state = await snapshot();
  assert.equal(state.comparisonRunId, await page.evaluate(() => window.harness.ids.initialAuto));
  assert.equal(state.lastManualRunId, await page.evaluate(() => window.harness.ids.sameConfigNewVersion));
  await assertPurple(1, 1);
  record('同实际配置手动重跑及仅版本变化均保留紫线', state);

  await page.evaluate(async () => {
    const h = window.harness; h.lab.editConfig({ controller: { kp: 2 } }); await h.complete('previewTwo', true);
  });
  const previewState = await snapshot();
  assert.equal(previewState.comparisonRunId, state.comparisonRunId);
  assert.equal(previewState.lastManualRunId, state.lastManualRunId);
  await assertPurple(1, 1);
  await page.evaluate(async () => { await window.harness.complete('manualChanged'); });
  const changed = await snapshot();
  assert.equal(changed.comparisonRunId, state.lastManualRunId);
  assert.equal(changed.lastManualRunId, await page.evaluate(() => window.harness.ids.manualChanged));
  await assertPurple(1, state.version);
  record('自动预览保持已有紫线，改参手动确认才推进', { previewState, confirmedState: changed });

  await page.evaluate(async () => {
    const h = window.harness; h.lab.editConfig({ signal: { target: 2 } }); await h.complete('changedConditionAuto', true);
  });
  await assertPurple(0);
  await page.evaluate(async () => { await window.harness.complete('changedConditionManual'); });
  state = await snapshot();
  assert.equal(state.comparisonRunId, changed.lastManualRunId); await assertPurple(0);
  record('不同评价条件保留历史指针但不混画紫线', state);

  await page.evaluate(async () => {
    const h = window.harness; h.lab.editConfig({ controller: { kp: 3 } }); await h.complete('sameConditionManual');
  });
  const beforeRace = await snapshot();
  await assertPurple(1, state.version);
  await page.evaluate(() => {
    const h = window.harness; h.holdSimulation = true; h.raceOffset = h.simulations.length;
    h.lab.editConfig({ controller: { kp: 4 } }); h.oldRequest = h.lab.run();
    h.lab.editConfig({ controller: { kp: 5 } }); h.newRequest = h.lab.run();
  });
  await page.waitForFunction(() => window.harness.simulations.length === window.harness.raceOffset + 2);
  await page.evaluate(async () => {
    const h = window.harness, newer = h.simulations[h.raceOffset + 1];
    newer.resolve(h.simulate(newer.config, newer.options)); const result = await h.newRequest; h.ids.latestRace = result.id;
  });
  const newerState = await snapshot();
  assert.equal(newerState.comparisonRunId, beforeRace.lastManualRunId);
  await page.evaluate(async () => {
    const h = window.harness, older = h.simulations[h.raceOffset];
    older.resolve(h.simulate(older.config, older.options)); await h.oldRequest;
  });
  const afterOld = await snapshot();
  assert.equal(afterOld.activeRunId, newerState.activeRunId);
  assert.equal(afterOld.comparisonRunId, newerState.comparisonRunId);
  assert.equal(afterOld.lastManualRunId, newerState.lastManualRunId);
  assert.equal(afterOld.runCount, newerState.runCount + 1);
  await assertPurple(1, beforeRace.version);
  record('乱序旧请求不覆盖当前结果或对照指针', { newerState, afterOld });

  await page.evaluate(async () => {
    const h = window.harness; await h.lab.flushSave(); h.persisted = h.copy(h.disk.get(h.lab.experimentRef.current.id));
    await h.lab.startCase('position'); await h.lab.changeExperiment(h.persisted);
  });
  state = await snapshot();
  assert.equal(state.comparisonRunId, afterOld.comparisonRunId);
  assert.equal(state.lastManualRunId, afterOld.lastManualRunId);
  await assertPurple(1, beforeRace.version);
  record('保存并恢复实验保留固定对照状态', state);

  await page.reload(); await ready();
  await page.evaluate(async () => {
    const h = window.harness, legacy = h.createExperiment('motor');
    const old = h.simulate(legacy.config, { configVersion: 1 });
    legacy.config.controller.kp = 2; legacy.version = 2;
    const changed = h.simulate(legacy.config, { configVersion: 2 });
    const duplicate = h.simulate(legacy.config, { configVersion: 2 });
    legacy.runs = [old, changed, duplicate]; legacy.activeRunId = duplicate.id;
    delete legacy.comparisonRunId; delete legacy.lastManualRunId;
    h.legacyBaselineId = old.id; await h.lab.changeExperiment(legacy);
  });
  state = await snapshot();
  assert.equal(state.comparisonRunId, await page.evaluate(() => window.harness.legacyBaselineId));
  assert.equal(state.lastManualRunId, null); await assertPurple(1, 1);
  record('旧实验一次迁移跳过同参数重复结果', state);

  assert.deepEqual(rendererErrors, []); report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.errors.push(error.stack || error.message); process.exitCode = 1;
} finally {
  report.rendererErrors = rendererErrors;
  if (app) await app.close().catch(error => report.errors.push(`测试窗口清理失败：${error.message}`));
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(evidence, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Evidence: ${evidence}`);
  if (report.status !== 'passed') console.error(report.errors.join('\n'));
}

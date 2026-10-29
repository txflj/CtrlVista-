import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// A real React mount with controlled asynchronous API boundaries. This does not
// rewrite/evaluate hook source text and never starts the production main process.
const require = createRequire(import.meta.url);
const playwrightPath = process.env.KX_PLAYWRIGHT_PATH || 'playwright';
const { _electron } = require(playwrightPath);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, '.test-data', `ui-race-${Date.now()}`);
const evidence = path.join(root, 'evidence', 'ui-race-check.json');
await fs.mkdir(fixture, { recursive: true });
await fs.mkdir(path.dirname(evidence), { recursive: true });
await fs.writeFile(path.join(fixture, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>控小助 React 并发回归</title><div id="root"></div><script type="module" src="./harness.jsx"></script></html>');
await fs.writeFile(path.join(fixture, 'harness.jsx'), `
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import useExperiment from '../../src/ui/control-lab/useExperiment.js';
import { createExperiment } from '../../src/ui/control-lab/model.js';
import { simulate } from '../../src/core/index.mjs';
const copy = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const h = window.harness = {
  createExperiment, simulate, ready: false, lab: null, delaySaves: false,
  events: [], disk: new Map(), saves: [], simulations: [],
};
let saveSequence = 0;
const api = {
  simulate(config, options) {
    const gate = { ...deferred(), config: copy(config), options };
    h.simulations.push(gate); h.events.push({ action: 'simulate', version: options.configVersion });
    return gate.promise;
  },
  async saveExperiment(input) {
    const snapshot = copy(input), sequence = ++saveSequence;
    h.events.push({ action: 'save-start', sequence, id: snapshot.id, runs: snapshot.runs.length });
    if (h.delaySaves) { const gate = { ...deferred(), sequence }; h.saves.push(gate); await gate.promise; }
    h.disk.set(snapshot.id, snapshot);
    h.events.push({ action: 'save-end', sequence, id: snapshot.id, runs: snapshot.runs.length });
    return copy(snapshot);
  },
  async deleteExperiment(id) {
    h.events.push({ action: 'delete', id }); h.disk.delete(id); return { ok: true };
  },
};
function Harness() {
  const lab = useExperiment(api);
  h.lab = lab;
  useEffect(() => { lab.setAutoRun(false); h.ready = true; }, []);
  return React.createElement('main', { style: { fontFamily: 'sans-serif', padding: 24 } },
    React.createElement('h1', null, '控小助 React 并发回归'),
    React.createElement('p', null, '独立测试页面；模拟存储接口；不访问正式实验目录或在线模型。'),
    React.createElement('pre', { id: 'state' }, JSON.stringify({
      id: lab.experiment?.id, version: lab.experiment?.version, runs: lab.experiment?.runs.length,
      busy: lab.busy, saveState: lab.saveState,
    }, null, 2)));
}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
`);
await fs.writeFile(path.join(fixture, 'main.cjs'), `
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.setName('控小助 React 并发回归');
app.setPath('userData', path.join(__dirname, 'electron-data'));
app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 900, height: 650, show: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.loadFile(path.join(__dirname, 'dist/index.html'));
});
app.on('window-all-closed', () => app.quit());
`);

const report = {
  startedAt: new Date().toISOString(), fixture, checks: [], errors: [],
  scope: '真实 React Hook 在独立 Electron 页面中挂载；延迟 API 使用内存 Map，不启动正式 main.cjs，不访问正式数据或真实在线模型。关闭项验证 prepareClose，不替代原生窗口关闭集成测试。',
};
let app;
const rendererErrors = [];
const record = (name, details) => { report.checks.push({ name, details }); console.log(`PASS ${name}`); };
try {
  await build({ configFile: false, root: fixture, base: './', logLevel: 'warn', build: { outDir: 'dist', emptyOutDir: true } });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [path.join(fixture, 'main.cjs')], env, timeout: 30000 });
  const page = await app.firstWindow();
  page.on('pageerror', error => rendererErrors.push(error.message));
  const ready = () => page.waitForFunction(() => window.harness?.ready && window.harness.lab.autoRun === false);
  await ready();
  report.runtime = await app.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome }));

  // Run result returns after switching has taken its first save snapshot.
  await page.evaluate(() => {
    const h = window.harness; h.a = h.createExperiment('motor'); h.lab.commit(h.a);
    h.pendingRun = h.lab.run(); h.delaySaves = true;
    h.pendingSwitch = h.lab.changeExperiment(h.createExperiment('position'));
  });
  await page.waitForFunction(() => window.harness.saves.length === 1 && window.harness.simulations.length === 1);
  await page.evaluate(async () => {
    const h = window.harness, simulation = h.simulations[0];
    simulation.resolve(h.simulate(simulation.config, simulation.options)); await h.pendingRun;
    h.delaySaves = false; h.saves[0].resolve(); await h.pendingSwitch;
  });
  const switchResult = await page.evaluate(() => {
    const h = window.harness;
    return { savedRuns: h.disk.get(h.a.id)?.runs.length, currentCase: h.lab.experimentRef.current.caseId, events: h.events };
  });
  assert.equal(switchResult.savedRuns, 1); assert.equal(switchResult.currentCase, 'position');
  record('切换等待保存期间返回的运行被补存', switchResult);

  // An extra save is enqueued while deletion's first save is pending. A late
  // computation then resolves after delete; the intentionally weak mock store
  // has no tombstone protection, so this checks the UI queue guard itself.
  await page.reload(); await ready();
  await page.evaluate(() => {
    const h = window.harness; h.a = h.createExperiment('motor'); h.lab.commit(h.a);
    h.pendingRun = h.lab.run(); h.delaySaves = true; h.pendingDelete = h.lab.removeExperiment(h.a.id);
  });
  await page.waitForFunction(() => window.harness.saves.length === 1);
  await page.evaluate(async () => {
    const h = window.harness; h.extraSave = h.lab.flushSave();
    h.delaySaves = false; h.saves[0].resolve(); await Promise.all([h.pendingDelete, h.extraSave]);
    const simulation = h.simulations[0]; simulation.resolve(h.simulate(simulation.config, simulation.options)); await h.pendingRun;
  });
  // Exceed both automatic timer delays to expose a stale pending timer.
  await page.waitForTimeout(750);
  const deleteResult = await page.evaluate(() => {
    const h = window.harness, deletion = h.events.findIndex(event => event.action === 'delete');
    return { exists: h.disk.has(h.a.id), current: h.lab.experimentRef.current,
      savesAfterDelete: h.events.slice(deletion + 1).filter(event => event.action === 'save-start' || event.action === 'save-end'), events: h.events };
  });
  assert.equal(deleteResult.exists, false); assert.equal(deleteResult.current, null); assert.deepEqual(deleteResult.savesAfterDelete, []);
  record('删除排空保存队列且晚回计算不复活实验', deleteResult);

  // Closing drains completed work, then seals the snapshot against late results.
  await page.reload(); await ready();
  await page.evaluate(() => {
    const h = window.harness; h.a = h.createExperiment('motor'); h.lab.commit(h.a);
    h.runOne = h.lab.run(); h.runTwo = h.lab.run();
    h.delaySaves = true; h.pendingClose = h.lab.prepareClose();
  });
  await page.waitForFunction(() => window.harness.saves.length === 1 && window.harness.simulations.length === 2);
  await page.evaluate(async () => {
    const h = window.harness, first = h.simulations[0];
    first.resolve(h.simulate(first.config, first.options)); await h.runOne;
    h.delaySaves = false; h.saves[0].resolve(); await h.pendingClose;
    const late = h.simulations[1]; late.resolve(h.simulate(late.config, late.options)); await h.runTwo;
    h.lab.editConfig({ controller: { kp: 3 } });
  });
  const closeResult = await page.evaluate(() => {
    const h = window.harness;
    return { savedRuns: h.disk.get(h.a.id)?.runs.length, currentRuns: h.lab.experimentRef.current.runs.length,
      version: h.lab.experimentRef.current.version, events: h.events };
  });
  assert.equal(closeResult.savedRuns, 1); assert.equal(closeResult.currentRuns, 1); assert.equal(closeResult.version, 1);
  record('prepareClose 补存后封存且拒绝晚回写', closeResult);

  // Out-of-order replies can be retained as history, but must not replace v2.
  await page.reload(); await ready();
  await page.evaluate(() => {
    const h = window.harness; h.a = h.createExperiment('motor'); h.lab.commit(h.a);
    h.runOne = h.lab.run(); h.lab.editConfig({ controller: { kp: 2 } }); h.runTwo = h.lab.run();
  });
  await page.waitForFunction(() => window.harness.simulations.length === 2);
  await page.evaluate(async () => {
    const h = window.harness, newer = h.simulations[1], older = h.simulations[0];
    newer.resolve(h.simulate(newer.config, newer.options)); await h.runTwo;
    older.resolve(h.simulate(older.config, older.options)); await h.runOne; await h.lab.flushSave();
  });
  const versionResult = await page.evaluate(() => {
    const h = window.harness, experiment = h.lab.experimentRef.current;
    return { version: experiment.version, runs: experiment.runs.map(run => run.configVersion),
      activeVersion: experiment.runs.find(run => run.id === experiment.activeRunId)?.configVersion, savedRuns: h.disk.get(h.a.id)?.runs.length };
  });
  assert.equal(versionResult.version, 2); assert.deepEqual(versionResult.runs, [2, 1]);
  assert.equal(versionResult.activeVersion, 2); assert.equal(versionResult.savedRuns, 2);
  record('旧配置结果保留历史但不覆盖当前方案', versionResult);
  assert.deepEqual(rendererErrors, []);
  report.status = 'passed';
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

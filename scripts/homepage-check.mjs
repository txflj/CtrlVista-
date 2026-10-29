import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { _electron } = require(
  process.env.KX_PLAYWRIGHT_PATH ||
    "playwright",
);
const root = process.cwd(),
  packaged = process.argv.includes("--packaged");
const version = JSON.parse(await fs.readFile("package.json", "utf8")).version;
const executablePath = path.join(
  root,
  packaged
    ? `release/控小助-${version}-win32-x64/控小助.exe`
    : "node_modules/electron/dist/electron.exe",
);
const dataDir = path.join(
  root,
  ".test-data",
  `homepage-${packaged ? "packaged" : "source"}-${Date.now()}`,
);
const env = {
  ...process.env,
  KX_TEST_MODE: "1",
  KX_TEST_SHOW: "1",
  KX_TEST_DATA_DIR: dataDir,
};
delete env.ELECTRON_RUN_AS_NODE;
if (packaged)
  env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
const report = {
  version,
  packaged,
  executablePath,
  startedAt: new Date().toISOString(),
  dataDir,
  checks: [],
  errors: [],
  scope:
    "真实 Electron 本地文件、实际 3D 和本机仿真；独立数据目录，不请求在线模型。",
};
const record = (name, detail = true) => {
  report.checks.push({ name, detail });
  console.log("PASS", name);
};
let app, page, home;
const navigationCases = [
  ["motor", "电机调速"],
  ["temperature", "温度调节"],
  ["position", "机械定位"],
  ["challenge", "综合挑战"],
];
async function assertArchiveSelection(index = null, { settled = false } = {}) {
  // Return the successful polling snapshot itself: inertia can advance selection
  // between separate state and locator reads, even when their texts briefly match.
  const handle = await home.waitForFunction(
    ({ index, settled, cases }) => {
      const current = window.__kxHome.getState();
      const stats = current.stats;
      // scene clears momentum only after both tracks reach the motion class's
      // position/velocity stop thresholds, not merely when a cell is selected.
      if (stats.archiveMomentum !== null || stats.holdingArchive || stats.dragTrack !== null) return false;
      const expectedIndex = index ?? current.selected;
      const expected = cases[expectedIndex];
      if (!expected || current.caseId !== expected[0]) return false;
      const cell = stats.selectedCell;
      // The normal camera springs can have a tail after pointer release. These
      // are the target tracks from scene.trackPosition, including rail rounding.
      const tracksSettled =
        Math.abs(stats.columnCamera - (cell.lane - 2) * 5.2) < 0.001 &&
        Math.abs(stats.rail - (-2.17 - (cell.row - 15.5) * 0.62)) < 0.001 &&
        Math.abs(stats.laneFocus - cell.lane) < 0.001;
      if (settled && !tracksSettled) return false;
      const snapshot = {
        current,
        tracksSettled,
        total: document.querySelector(".count-total")?.textContent,
        tickCount: document.querySelectorAll("#file-ticks button").length,
        number: document.querySelector("#selected-number .rn-value")?.textContent,
        title: document.querySelector("#selected-title .rn-value")?.textContent,
        code: document.querySelector("#selected-code .rn-value")?.textContent,
        selectedTicks: Array.from(document.querySelectorAll('#file-ticks [aria-pressed="true"]'),
          (tick) => tick.getAttribute("data-select")),
      };
      if (
        snapshot.number !== String(expectedIndex + 1).padStart(2, "0") ||
        snapshot.title !== expected[1] ||
        snapshot.code !== String(expectedIndex + 1).padStart(3, "0")
      ) return false;
      return snapshot;
    },
    { index, settled, cases: navigationCases },
    { timeout: 45000 },
  );
  let snapshot;
  try {
    snapshot = await handle.jsonValue();
  } finally {
    await handle.dispose();
  }
  const { current } = snapshot;
  index ??= current.selected;
  const [caseId, title] = navigationCases[index];
  assert.equal(current.selected, index);
  assert.equal(current.caseId, caseId);
  assert.equal(current.stats.archiveMomentum, null);
  assert.equal(current.stats.holdingArchive, false);
  assert.equal(current.stats.dragTrack, null);
  if (settled) assert.equal(snapshot.tracksSettled, true);
  assert.equal(snapshot.total, "04");
  assert.equal(snapshot.tickCount, 4);
  assert.equal(snapshot.number, String(index + 1).padStart(2, "0"));
  assert.equal(snapshot.title, title);
  assert.equal(snapshot.code, String(index + 1).padStart(3, "0"));
  assert.deepEqual(snapshot.selectedTicks, [String(index)]);
  // The visible title and the selected physical cell must identify one file,
  // including after stepping across a category and around the infinite array.
  const cell = current.stats.selectedCell;
  const wrap = (value, count) => ((value % count) + count) % count;
  assert.equal(wrap(cell.lane, 2), Math.floor(index / 2));
  assert.equal(wrap(cell.row - 12, 2), index % 2);
  return current;
}
async function assertSignalDetail(caseId, { covered = false } = {}) {
  const handle = await home.waitForFunction(
    ({ caseId, covered }) => {
      const state = window.__kxHome.getState();
      if (state.modal !== null || state.mode !== "detail" || state.caseId !== caseId) return false;
      const signal = state.stats.signal;
      if (!signal || signal.caseId !== caseId) return false;
      const content = document.querySelector("#detail-content");
      const covers = content.querySelectorAll(".document-redaction-window").length;
      if (covered) {
        if (!["joining", "connected", "retracting"].includes(signal.phase)) return false;
      } else if (signal.phase !== "clear" || covers !== 0 || Number(content.style.opacity) < 0.99) return false;
      return {
        state,
        signal,
        document: {
          covers,
          title: content.querySelector("h2")?.textContent,
          inert: content.inert,
          opacity: Number(content.style.opacity),
        },
      };
    },
    { caseId, covered },
    { timeout: 45000 },
  );
  let snapshot;
  try {
    snapshot = await handle.jsonValue();
  } finally {
    await handle.dispose();
  }
  const { signal, state, document } = snapshot;
  assert.equal(signal.caseId, caseId);
  assert.equal(signal.kind, "fourier-demonstration");
  assert.equal(signal.geometrySource, "procedural-signal-cartridge");
  assert.equal(signal.finite, true);
  assert.equal(signal.visible, true);
  assert.equal(signal.phase, state.stats.decryption.phase);
  for (const key of ["progress", "clarity", "sampleCount", "reconstructionMaxError", "screenWidth", "screenHeight", "screenAreaRatio", "componentsCount"])
    assert.ok(Number.isFinite(signal[key]), `signal.${key} must be finite`);
  assert.ok(Number.isInteger(signal.sampleCount) && signal.sampleCount >= 32);
  assert.ok(Number.isInteger(signal.componentsCount) && signal.componentsCount >= 2 && signal.componentsCount <= signal.sampleCount);
  assert.ok(signal.reconstructionMaxError >= 0 && signal.reconstructionMaxError < 1e-8);
  assert.ok(signal.progress >= 0 && signal.progress <= 1);
  assert.ok(signal.clarity >= 0 && signal.clarity <= 1);
  const expectedProgress = Math.max(0, Math.min(1, (state.stats.decryption.time - 34.12) / (39.56 - 34.12)));
  assert.ok(Math.abs(signal.progress - expectedProgress) < 1e-6);
  assert.ok(Math.abs(signal.clarity - state.stats.decryption.clarity) < 1e-6);
  assert.ok(signal.screenWidth > 0 && signal.screenHeight > 0);
  assert.ok(signal.screenAreaRatio >= 0.5 && signal.screenAreaRatio <= 1, "signal screen must occupy at least half the cartridge face");
  assert.ok(Math.abs(signal.screenAreaRatio - signal.screenWidth * signal.screenHeight / (5.0104 * 3.7)) < 1e-5);
  assert.equal(document.title, navigationCases.find(([id]) => id === caseId)[1]);
  if (covered) {
    assert.equal(signal.clarity, 0);
    assert.ok(document.covers > 0, "experiment text must remain covered before the signal reveal cue");
  } else {
    assert.equal(signal.phase, "clear");
    assert.ok(Math.abs(signal.clarity - 1) < 1e-6);
    assert.ok(Math.abs(signal.progress - 1) < 1e-6);
    assert.equal(document.covers, 0);
    assert.equal(document.inert, false);
  }
  return snapshot;
}
async function assertReducedDetailFirstFrame(caseId, open) {
  await home.evaluate(() => {
    window.__kxReducedDetailProbe = null;
    // Capture the first actual scene render after the real open-button event.
    // Do not wait for phase=clear: a delayed timeline must fail this assertion.
    document.addEventListener("click", () => {
      const first = window.__kxHome.getState();
      const capture = () => {
        const current = window.__kxHome.getState();
        if (current.stats.renderedFrames <= first.stats.renderedFrames) {
          requestAnimationFrame(capture);
          return;
        }
        window.__kxReducedDetailProbe = {
          framesElapsed: current.stats.renderedFrames - first.stats.renderedFrames,
          mode: current.mode,
          caseId: current.caseId,
          reduced: current.prefs.reduced,
          signal: current.stats.signal,
          documentCovers: document.querySelectorAll("#detail-content .document-redaction-window").length,
        };
      };
      requestAnimationFrame(capture);
    }, { capture: true, once: true });
  });
  await open();
  const handle = await home.waitForFunction(() => window.__kxReducedDetailProbe, null, { timeout: 15000 });
  let snapshot;
  try { snapshot = await handle.jsonValue(); }
  finally { await handle.dispose(); }
  assert.equal(snapshot.framesElapsed, 1);
  assert.equal(snapshot.mode, "detail");
  assert.equal(snapshot.caseId, caseId);
  assert.equal(snapshot.reduced, true);
  assert.equal(snapshot.signal.caseId, caseId);
  assert.equal(snapshot.signal.phase, "clear");
  assert.equal(snapshot.signal.progress, 1);
  assert.equal(snapshot.signal.clarity, 1);
  assert.equal(snapshot.documentCovers, 0);
  return snapshot;
}
const rendererErrors = [],
  externalRequests = [],
  glbRequests = [];
try {
  app = await _electron.launch({
    executablePath,
    args: packaged ? [] : [root],
    env,
    timeout: 40000,
  });
  page = await app.firstWindow();
  page.on("pageerror", (e) => rendererErrors.push(e.message));
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) externalRequests.push(r.url());
    if (/\.glb(?:$|[?#])/i.test(r.url())) glbRequests.push(r.url());
  });
  page.on("dialog", (d) => d.accept());
  await page.getByTestId("homepage-frame").waitFor();
  home = await (
    await page.getByTestId("homepage-frame").elementHandle()
  ).contentFrame();
  await home.waitForFunction(() => window.__kxHome?.getState().ready, null, {
    timeout: 60000,
  });
  await home.waitForFunction(() => window.__kxHome.getState().intro?.completed, null, { timeout: 30000 });
  const state = await home.evaluate(() => window.__kxHome.getState());
  assert.equal(state.mode, "archive");
  assert.equal(state.stats.loaded, true);
  assert.equal(state.stats.cameraDetail, 0);
  assert.ok(Math.abs(state.stats.extraction - 0.4) < 0.005);
  assert.equal(await home.locator("#boot").count(), 0);
  assert.equal(await home.locator("audio,video").count(), 0);
  assert.equal(await home.locator('[data-action="model-viewer"], .model-viewer, #inspection-marks, #inspection-text').count(), 0);
  assert.equal(await home.locator(".brand-version").textContent(), version);
  const glbResources = await home.evaluate(() => performance.getEntriesByType("resource")
    .filter(entry => /\.glb(?:$|[?#])/i.test(entry.name)).map(entry => entry.name));
  assert.deepEqual(glbResources, []);
  assert.equal(
    await home.evaluate(() => typeof window.kongxiaozhu),
    "undefined",
  );
  assert.equal(state.stats.sharedCartridgeGeometry, true);
  record("离线阵列入场后显示自研信号匣，无原品牌 Logo 或旧 GLB", {
    renderer: state.stats.loaded,
    quality: state.prefs.quality,
  });
  await page.mouse.move(10, 10);
  await fs.mkdir("evidence/screenshots", { recursive: true });
  await page.screenshot({
    path: `evidence/screenshots/home-${packaged ? "packaged" : "source"}-archive.png`,
  });
  // Exercise the real reveal sequence even on hosts preferring reduced motion.
  if (state.prefs.reduced) {
    await home.locator('[data-action="settings"]').click();
    await home.locator('[data-action="motion"]').click();
    await home.locator('[data-action="close-modal"]').click();
    await home.waitForFunction(() => window.__kxHome.getState().modal === null);
  }
  await assertArchiveSelection(0);
  for (const index of [1, 2, 3, 0]) {
    await home.locator('[data-action="next"]').click();
    await assertArchiveSelection(index);
  }
  for (const index of [3, 2, 1, 0]) {
    await home.locator('[data-action="prev"]').click();
    await assertArchiveSelection(index);
  }
  for (const index of [1, 2, 3, 0]) {
    await home.locator('[data-action="next"]').press("ArrowDown");
    await assertArchiveSelection(index);
  }
  for (const index of [3, 2, 1, 0]) {
    await home.locator('[data-action="prev"]').press("ArrowUp");
    await assertArchiveSelection(index);
  }
  const canvas = home.locator("#three-scene canvas");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.58);
  for (const index of [1, 2, 3, 0]) {
    await page.mouse.wheel(0, 100);
    await assertArchiveSelection(index);
  }
  // The secondary category arrows retain each category's last selection.
  await home.locator('#file-ticks [data-select="2"]').click();
  await assertArchiveSelection(2);
  await home.locator('#file-ticks [data-select="0"]').click();
  await home.locator('[data-action="next"]').click();
  await home.waitForFunction(
    () => window.__kxHome.getState().caseId === "temperature",
  );
  await home.locator('[data-action="column-next"]').click();
  await home.waitForFunction(
    () => window.__kxHome.getState().caseId === "position",
  );
  await home.locator('[data-action="column-prev"]').click();
  await home.waitForFunction(
    () => window.__kxHome.getState().caseId === "temperature",
  );
  await home.locator('[data-action="prev"]').click();
  await assertArchiveSelection(0);
  record("四实验按钮、上下键与滚轮全局循环，计数标题和空间档案一致，保留分组记忆");
  const before = await home.evaluate(
    () => window.__kxHome.getState().stats.selectedCell,
  );
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.58);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.4, {
    steps: 14,
  });
  await page.mouse.up();
  const afterState = await assertArchiveSelection(null, { settled: true });
  const after = afterState.stats.selectedCell;
  assert.notDeepEqual(after, before);
  record("鼠标拖动与惯性浏览改变真实阵列位置", {
    before,
    after,
    selected: afterState.selected,
    momentum: afterState.stats.archiveMomentum,
    tracks: { columnCamera: afterState.stats.columnCamera, rail: afterState.stats.rail, laneFocus: afterState.stats.laneFocus },
  });
  await home.locator('[data-action="search"]').click();
  await home.getByTestId("home-select-motor").click();
  const protectedSignal = await assertSignalDetail("motor", { covered: true });
  await page.screenshot({
    path: `evidence/screenshots/home-${packaged ? "packaged" : "source"}-signal-analysis.png`,
  });
  const revealedSignal = await assertSignalDetail("motor");
  record("傅里叶教学信号使用真实数值分解，大屏显示与右侧说明沿同一时轴揭示", {
    protected: { signal: protectedSignal.signal, document: protectedSignal.document },
    revealed: { signal: revealedSignal.signal, document: revealedSignal.document },
  });
  assert.equal(
    await home.locator("#detail-content h2").textContent(),
    "电机调速",
  );
  await home.locator('[data-tab="boundary"]').click();
  assert.match(await home.locator("#tab-panel").textContent(), /0.5s/);
  await home.locator('[data-tab="overview"]').click();
  await page.screenshot({
    path: `evidence/screenshots/home-${packaged ? "packaged" : "source"}-detail.png`,
  });
  record("信号匣抽取、说明揭示和详情页签，移除独立 360° 查看入口");
  await home.locator('[data-action="bookmark"]').click();
  assert.equal(
    await home.locator('[data-action="bookmark"]').getAttribute("aria-pressed"),
    "true",
  );
  await home.locator('[data-action="back"]').click();
  await home.waitForFunction(
    () => window.__kxHome.getState().stats.cameraDetail < 0.01,
    null,
    { timeout: 20000 },
  );
  await home.locator('[data-action="saved"]').click();
  assert.equal(await home.locator("[data-result]").count(), 1);
  await home.getByTestId("home-select-motor").click();
  record("归位返回与本地收藏");
  await home.locator('[data-action="settings"]').click();
  await home.locator('[data-color-theme="light"]').click();
  await home.waitForFunction(() => document.documentElement.dataset.darkSurface === "false", null, { timeout: 45000 });
  assert.equal(
    (await home.evaluate(() => window.__kxHome.getState())).prefs.dark,
    false,
  );
  await home.locator('[data-action="close-modal"]').click();
  await home.locator(".modal-backdrop").waitFor({ state: "hidden" });
  const lightSignal = await assertSignalDetail("motor");
  await page.screenshot({
    path: `evidence/screenshots/home-${packaged ? "packaged" : "source"}-detail-light.png`,
  });
  await home.locator('[data-action="settings"]').click();
  await home.locator('[data-color-theme="dark"]').click();
  await home.locator('[data-action="motion"]').click();
  await home.locator('[data-action="close-modal"]').click();
  record("浅色信号匣实际渲染，配色与减少动态效果可切换", lightSignal.signal);
  for (const id of ["motor", "temperature", "position", "challenge"]) {
    let reducedFirstFrame;
    if (id !== "motor") {
      await home.locator('[data-action="back"]').click();
      await home.locator('[data-action="next"]').click();
      await assertArchiveSelection(navigationCases.findIndex(([caseId]) => caseId === id));
      reducedFirstFrame = await assertReducedDetailFirstFrame(id,
        () => home.locator('[data-action="open"]').first().click());
    }
    const experimentSignal = await assertSignalDetail(id);
    await page.screenshot({
      path: `evidence/screenshots/home-${packaged ? "packaged" : "source"}-signal-${id}.png`,
    });
    assert.equal(
      await home.locator("#detail-content h2").textContent(),
      navigationCases.find(([caseId]) => caseId === id)[1],
    );
    await home.getByTestId(`home-start-${id}`).click();
    await page.getByTestId("run-simulation").waitFor();
    await page.getByTestId("run-simulation").click();
    await page.getByTestId("run-simulation").waitFor({ state: "visible" });
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="run-simulation"]')
          ?.textContent === "运行仿真",
    );
    assert.equal(
      await home.evaluate(() => window.__kxHome.getState().active),
      false,
    );
    if (id === "motor") {
      await page.getByTestId("ai-assistant-launcher").click();
      await page
        .locator(".ai-drawer textarea")
        .first()
        .fill("主页返回后保留这条实验问题");
      await page.getByTestId("feature-home").click();
      await page.getByTestId("homepage-frame").waitFor({ state: "visible" });
      assert.equal(
        await page.getByTestId("ai-assistant-drawer").isVisible(),
        false,
      );
      await home.locator('[data-action="continue"]').click();
      await page.getByTestId("run-simulation").waitFor();
      assert.equal(
        await page.locator(".ai-drawer textarea").first().inputValue(),
        "主页返回后保留这条实验问题",
      );
      await page
        .getByRole("button", { name: "关闭 AI 实验助手", exact: true })
        .click();
    }
    if (id === "challenge")
      await page.screenshot({
        path: `evidence/screenshots/home-${packaged ? "packaged" : "source"}-workbench.png`,
      });
    await page.getByTestId("feature-home").click();
    await page.getByTestId("homepage-frame").waitFor({ state: "visible" });
    await home.waitForFunction(() => window.__kxHome.getState().active);
    const resumed = await home.evaluate(() => window.__kxHome.getState().stats);
    assert.ok(Number.isFinite(resumed.cameraDetail));
    assert.ok(Number.isFinite(resumed.extraction));
    assert.ok(Object.values(resumed.cameraPosition).every(Number.isFinite));
    record(`${id}：信号分解展示、真实入口、仿真、保存并返回主页`, {
      signal: experimentSignal.signal,
      ...(reducedFirstFrame ? { reducedFirstFrame } : {}),
    });
  }
  const experiments = await page.evaluate(() =>
    window.kongxiaozhu.listExperiments(),
  );
  assert.equal(experiments.length, 4);
  assert.ok(experiments.every((e) => e.runs.length > 0));
  record("四个实验实际落盘，AI 草稿跨主页保留");
  await home.locator('[data-action="records"]').click();
  await page.locator(".records-list .record-card").first().waitFor();
  assert.equal(await page.locator(".records-list .record-card").count(), 4);
  await page.getByTestId("feature-home").click();
  await home.locator('[data-action="settings"]').click();
  await home.locator('[data-action="api-settings"]').click();
  await page.getByRole("button", { name: "关闭对话框" }).waitFor();
  await page.getByRole("button", { name: "关闭对话框" }).click();
  record("我的实验与模型设置入口可用");
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1040, 720),
  );
  await page.waitForTimeout(350);
  await page.screenshot({
    path: `evidence/screenshots/home-${packaged ? "packaged" : "source"}-1040.png`,
  });
  const overflow = await home.evaluate(
    () => document.documentElement.scrollWidth > innerWidth + 1,
  );
  assert.equal(overflow, false);
  record("1040 × 720 主页无横向溢出");
  await page.reload();
  await page.getByTestId("homepage-frame").waitFor();
  home = await (
    await page.getByTestId("homepage-frame").elementHandle()
  ).contentFrame();
  await home.waitForFunction(() => window.__kxHome?.getState().ready, null, {
    timeout: 60000,
  });
  await home.locator('[data-action="saved"]').click();
  assert.equal(await home.locator("[data-result]").count(), 1);
  record("重载后默认主页、收藏与实验数量保留");
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(glbRequests, []);
  assert.deepEqual(rendererErrors, []);
  record("全部资源离线，无旧 GLB 加载、renderer 异常或外部网络请求");
  report.passed = true;
} catch (error) {
  report.errors.push(error.stack || String(error));
  report.passed = false;
  console.error(error);
  report.failureState = await home?.evaluate(() => ({
    state: window.__kxHome?.getState(),
    number: document.querySelector("#selected-number .rn-value")?.textContent,
    title: document.querySelector("#selected-title .rn-value")?.textContent,
  })).catch(() => null);
  console.error(JSON.stringify(report.failureState));
  await page
    ?.screenshot({
      path: `evidence/screenshots/home-failure-${packaged ? "packaged" : "source"}.png`,
    })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  await app?.close();
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(
    `evidence/homepage-check${packaged ? "-packaged" : ""}.json`,
    JSON.stringify(report, null, 2),
  );
}

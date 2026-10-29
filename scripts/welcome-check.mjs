import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { captureElectron } from './capture-electron.mjs';

// Real renderer time and real native screenshots; no synthetic scene/audio state.
// This suite creates its own Electron profile and never reads the user's profile.
const require = createRequire(import.meta.url);
const { _electron } = require(process.env.KX_PLAYWRIGHT_PATH || 'playwright');
const run = promisify(execFile);
const root = process.cwd();
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
const packaged = process.argv.includes('--packaged');
const label = packaged ? 'packaged' : 'source';
const executablePath = path.join(root, packaged ? `release/控小助-${version}-win32-x64/控小助.exe` : 'node_modules/electron/dist/electron.exe');
const dataDir = path.join(root, '.test-data', `welcome-${label}-${Date.now()}`);
const resourceRoot = packaged ? path.join(path.dirname(executablePath), 'resources/app/dist') : path.join(root, 'dist');
const env = { ...process.env, KX_TEST_MODE: '1', KX_TEST_SHOW: '1', KX_TEST_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
const report = {
  version, executablePath, packaged, dataDir, startedAt: new Date().toISOString(),
  passed: false, checks: [], errors: [], screenshots: [], launches: [],
  scope: '独立用户数据中的实际 Electron 欢迎、阵列入场、声音门控、偏好恢复、跨页面连续播放与 Windows 窗口图标；无在线 AI。',
};
const coverage = {
  version, executablePath, status: 'failed', checks: [], errors: [],
  scope: '16:10 与 16:9 的真实早期、中期、后期及静止帧；共享模型与动态实例容量断言。',
  visualInspection: { performed: false, note: '脚本记录真实截图和覆盖统计；底部连续性的视觉结论需要随后检查这 8 张图片，不能仅由统计推断。' },
};
let app, page, home;
const rendererErrors = [], externalRequests = [], oldModels = [];
const record = (name, detail = true) => { report.checks.push({ name, detail }); console.log('PASS', name); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const homeState = () => home.evaluate(() => window.__kxHome?.getState() ?? null);
const appState = () => page.evaluate(() => ({
  welcome: window.__kxWelcome?.getState() ?? null,
  audio: window.__kxAudio?.getState() ?? null,
  theme: document.documentElement.dataset.colorTheme,
  shellInert: document.querySelector('.app-shell')?.inert,
  welcomeTheme: document.querySelector('[data-testid="welcome-screen"]')?.dataset.theme ?? null,
}));
const audio = () => page.evaluate(() => window.__kxAudio.getState());

async function launch(width = 1600, height = 1000) {
  app = await _electron.launch({ executablePath, args: [...(packaged ? [] : [root]), '--force-device-scale-factor=1'], env, timeout: 40000 });
  const runtime = await app.evaluate(({ app }) => ({ version: app.getVersion(), dataPath: app.getPath('userData') }));
  assert.equal(runtime.version, version, '实际启动的软件版本与验收版本不一致');
  assert.equal(path.resolve(runtime.dataPath).toLowerCase(), path.resolve(dataDir).toLowerCase(), '验收不能使用正式用户数据');
  page = await app.firstWindow();
  page.on('pageerror', error => rendererErrors.push(error.message));
  page.on('request', request => {
    if (/^https?:/.test(request.url())) externalRequests.push(request.url());
    if (/\.glb(?:$|[?#])/i.test(request.url())) oldModels.push(request.url());
  });
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const window = BrowserWindow.getAllWindows().find(candidate => !candidate.isDestroyed());
    window.setContentSize(w, h);
    window.show();
    window.focus();
  }, [width, height]);
  await page.getByTestId('homepage-frame').waitFor();
  await page.waitForFunction(() => window.__kxAudio, null, { timeout: 15000 });
  const attachedHome = await (await page.getByTestId('homepage-frame').elementHandle()).contentFrame();
  await attachedHome.waitForFunction(() => window.__kxHome, null, { timeout: 30000 });
  const attached = await appState();
  const preferencesBeforeReload = await page.evaluate(() => Object.fromEntries(
    ['kx-color-theme-v1', 'kx-home-settings-v1', 'kx-audio-preferences-v1'].map(key => [key, localStorage.getItem(key)]),
  ));
  // Native process/window attachment can consume most of the 8-second welcome.
  // Once sized and observed, reload the real document for a full normal run.
  // This resets only this test window; no timeline, model or diagnostic is set.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('homepage-frame').waitFor();
  home = await (await page.getByTestId('homepage-frame').elementHandle()).contentFrame();
  await page.waitForFunction(() => window.__kxAudio, null, { timeout: 15000 });
  const reloaded = await appState();
  const preferencesAfterReload = await page.evaluate(() => Object.fromEntries(
    ['kx-color-theme-v1', 'kx-home-settings-v1', 'kx-audio-preferences-v1'].map(key => [key, localStorage.getItem(key)]),
  ));
  for (const [key, value] of Object.entries(preferencesBeforeReload)) {
    if (value !== null) assert.equal(preferencesAfterReload[key], value, '重新载入不得改写已保存的主题、静音及减少动态偏好');
  }
  report.launches.push({ viewport: { width, height }, runtime, attached, reloaded, preferencesBeforeReload, preferencesAfterReload });
}
async function close() { if (app) { await app.close(); app = null; } }
async function screenshot(name, extra = {}) {
  const file = `evidence/screenshots/welcome-${label}-${name}.png`;
  const size = await captureElectron(app, file);
  const result = { file, size, ...extra };
  report.screenshots.push(result);
  return result;
}
function silentMusic(state, message) {
  assert.ok(state, `${message}: audio diagnostics missing`);
  assert.equal(state.sourceCount, 0, `${message}: music sources created early`);
  assert.equal(state.musicStartCount, 0, `${message}: music started early`);
  assert.equal(state.musicReady, false, `${message}: music gate opened early`);
}

async function naturalWelcome() {
  const first = await appState();
  assert.ok(first.welcome && first.welcome.elapsed < 1.4, '必须从欢迎早期开始采集，不能漏掉开头后宣称完整验证');
  assert.equal(first.welcomeTheme, 'light');
  assert.equal(first.shellInert, true);
  const targets = [0.8, 2.6, 4.9, 7.4];
  const trace = [];
  let cursor = 0;
  const start = Date.now();
  while (Date.now() - start < 20000) {
    const [state, scene] = await Promise.all([appState(), homeState()]);
    if (!state.welcome) break;
    const t = state.welcome.elapsed;
    silentMusic(state.audio, '欢迎期间');
    assert.equal(state.shellInert, true, '欢迎覆盖期间底层必须 inert');
    assert.ok(state.audio.effectCount <= 3, '欢迎主题音效不得超过 3 次');
    // Ignore only the final handoff sampling race between the two renderer calls.
    if (scene && t < 7.9) {
      assert.equal(scene.active, false);
      assert.equal(scene.intro.active, false);
      assert.equal(scene.intro.completed, false);
      assert.equal(scene.intro.elapsed, 0, '欢迎期间阵列时间不应偷跑');
    }
    trace.push({ welcome: state.welcome, audio: { sourceCount: state.audio.sourceCount, musicStartCount: state.audio.musicStartCount, effectCount: state.audio.effectCount }, intro: scene?.intro, active: scene?.active });
    if (cursor < targets.length && t >= targets[cursor]) {
      assert.ok(t < targets[cursor] + 0.85, `欢迎第 ${cursor + 1} 帧错过目标时间`);
      await screenshot(`light-${cursor + 1}`, { welcome: state.welcome, targetSeconds: targets[cursor] });
      cursor++;
    }
    await wait(60);
  }
  assert.equal((await appState()).welcome, null, '欢迎应自然结束');
  assert.equal(cursor, 4);
  assert.ok(trace.at(-1)?.welcome.elapsed >= 8, '必须观察完整 8 秒欢迎及淡出');
  record('完整浅色欢迎 8 秒、四个代表帧、最多三个主题提示音；底层阵列和配乐均未提前开始', { trace });
}

async function arrayCoverage(ratio) {
  const dimensions = ratio === '16x10' ? [1600, 1000] : [1600, 900];
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.equal(viewport.width, dimensions[0]);
  assert.equal(viewport.height, dimensions[1]);
  const phases = [{ name: 'early', progress: 0.15 }, { name: 'middle', progress: 0.49 }, { name: 'late', progress: 0.86 }];
  let cursor = 0;
  const trace = [];
  const start = Date.now();
  while (Date.now() - start < 60000) {
    const scene = await homeState();
    const sound = await audio();
    if (!scene?.ready) { silentMusic(sound, '阵列载入期间'); await wait(60); continue; }
    if (scene.intro.completed) break;
    if (scene.intro.progress < 0.97) silentMusic(sound, '阵列入场期间');
    trace.push({ intro: scene.intro, musicReady: sound.musicReady, musicStartCount: sound.musicStartCount, sourceCount: sound.sourceCount });
    if (cursor < phases.length && scene.intro.progress >= phases[cursor].progress) {
      assert.ok(scene.intro.progress < phases[cursor].progress + 0.15, `${ratio} ${phases[cursor].name} 抓图时间已错过`);
      await captureCoverage(ratio, phases[cursor].name, scene, viewport);
      cursor++;
    }
    await wait(50);
  }
  assert.equal(cursor, 3, `${ratio} 必须完整采集早中晚三个阶段`);
  const settled = await homeState();
  assert.equal(settled.intro.completed, true);
  await captureCoverage(ratio, 'settled', settled, viewport);
  record(`${ratio} 阵列入场延后启动且四阶段使用当前信号匣，完成前无背景配乐`, { trace });
}
async function captureCoverage(ratio, phase, state, viewport) {
  const stats = state.stats;
  assert.equal(stats.sharedCartridgeGeometry, true);
  assert.equal(stats.archivePartCount, 7);
  assert.ok(stats.archiveCandidates > 160, '仍落入旧版有限 160 模型池');
  assert.ok(stats.archiveCount > 0 && stats.archiveCount <= stats.archiveCapacity);
  assert.ok(stats.archiveCapacity > 160);
  assert.ok(stats.poolBounds && stats.poolBounds.maxRow > stats.poolBounds.minRow);
  const shot = await screenshot(`array-${ratio}-${phase}`, { intro: state.intro, viewport });
  coverage.checks.push({ label: ratio, phase, viewport, screenshot: shot.file, screenshotSize: shot.size, intro: state.intro, stats,
    assertions: { sharedCurrentCartridgeGeometry: true, sharedPartCountSeven: true, adaptiveCandidatesBeyondOldLimit: true, instanceCountWithinCapacity: true } });
}

async function musicPlaying() {
  await page.waitForFunction(() => {
    const state = window.__kxAudio?.getState();
    return state?.sourceCount === 3 && state.musicStartCount === 1 && state.outputRms > 0.00001;
  }, null, { timeout: 30000 });
  const sound = await audio();
  assert.equal(sound.musicReady, true);
  assert.equal(sound.contextState, 'running');
  assert.equal((await homeState()).intro.completed, true);
  return sound;
}

async function nativeWindowIcon() {
  // Electron exposes setIcon, but no BrowserWindow.getIcon. WM_GETICON reads the
  // actual window's borrowed HICON; it does not change the window or its class.
  const handle = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().toString('hex'));
  const bytes = Buffer.from(handle, 'hex');
  const numericHandle = bytes.length === 8 ? bytes.readBigUInt64LE().toString() : String(bytes.readUInt32LE());
  const file = path.join(root, `evidence/screenshots/welcome-${label}-native-icon.png`);
  const ps = `$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class KxWindowIconRead {
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", EntryPoint="GetClassLongPtrW")] public static extern IntPtr GetClassLongPtr(IntPtr window, int index);
}
'@
$window=[IntPtr]::new([long]${numericHandle})
$handle=[KxWindowIconRead]::SendMessage($window,0x007f,[IntPtr]1,[IntPtr]::Zero)
if($handle -eq [IntPtr]::Zero){$handle=[KxWindowIconRead]::SendMessage($window,0x007f,[IntPtr]0,[IntPtr]::Zero)}
if($handle -eq [IntPtr]::Zero){$handle=[KxWindowIconRead]::GetClassLongPtr($window,-14)}
if($handle -eq [IntPtr]::Zero){throw 'Window has no native icon'}
$icon=[System.Drawing.Icon]::FromHandle($handle)
$bitmap=$icon.ToBitmap()
try{$bitmap.Save('${file.replaceAll("'", "''")}',[System.Drawing.Imaging.ImageFormat]::Png)}finally{$bitmap.Dispose();$icon.Dispose()}
`;
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { cwd: root, timeout: 20000, windowsHide: true });
  const compared = await app.evaluate(({ nativeImage }, [actualPath, approvedPath]) => {
    const actual = nativeImage.createFromPath(actualPath);
    if (actual.isEmpty()) throw new Error('Native icon capture is empty');
    const size = actual.getSize();
    const expected = nativeImage.createFromPath(approvedPath).resize({ ...size, quality: 'best' });
    const a = actual.toBitmap(), b = expected.toBitmap();
    let squared = 0, union = 0, intersection = 0;
    for (let i = 0; i < a.length; i += 4) {
      const aa = a[i + 3] / 255, ba = b[i + 3] / 255;
      if (aa > 0.2 || ba > 0.2) union++;
      if (aa > 0.2 && ba > 0.2) intersection++;
      for (let channel = 0; channel < 3; channel++) {
        const av = a[i + channel] / 255 * aa + 1 - aa;
        const bv = b[i + channel] / 255 * ba + 1 - ba;
        squared += (av - bv) ** 2;
      }
    }
    return { size, rmseOnWhite: Math.sqrt(squared / (a.length / 4 * 3)), alphaIntersectionOverUnion: intersection / Math.max(1, union) };
  }, [file, path.join(resourceRoot, 'brand/icon-512.png')]);
  assert.ok(compared.size.width >= 16 && compared.size.height >= 16);
  assert.ok(compared.rmseOnWhite < 0.1, '窗口图标与批准图标的颜色及形状不一致');
  assert.ok(compared.alphaIntersectionOverUnion > 0.72, '窗口图标轮廓与批准图标不一致');
  report.screenshots.push({ file: path.relative(root, file).replaceAll('\\', '/'), ...compared });
  const resources = await page.evaluate(async () => Promise.all(['mark.svg', 'icon-512.png', 'app.ico'].map(name => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ name, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error(`Cannot load brand/${name}`));
    image.src = new URL(`./brand/${name}`, location.href).href;
  }))));
  assert.ok(resources.every(item => item.width > 0 && item.height > 0));
  let embedded = null;
  if (packaged) {
    const verified = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/windows-icon.ps1'), '-Executable', executablePath, '-VerifyOnly'], { cwd: root, timeout: 30000, windowsHide: true });
    embedded = JSON.parse(verified.stdout.replace(/^\uFEFF/, '').trim());
    assert.equal(embedded.Passed, true);
    assert.deepEqual(embedded.Sizes, [16, 20, 24, 32, 40, 48, 64, 128, 256]);
  }
  record('真实窗口 HICON 与批准标志一致，品牌资源可载入；打包版另校验 EXE 九尺寸资源', { native: compared, resources, embedded });
}

async function setFixture({ dark, reduced, muted }) {
  // Represents existing saved user preferences, only in this suite's profile.
  // No test-only change to animation timing, models, runtime or computed results.
  await page.evaluate(({ dark, reduced, muted }) => {
    localStorage.removeItem('kx-color-theme-v1');
    const home = JSON.parse(localStorage.getItem('kx-home-settings-v1') || '{}');
    localStorage.setItem('kx-home-settings-v1', JSON.stringify({ ...home, dark, reduced }));
    localStorage.setItem('kx-audio-preferences-v1', JSON.stringify({ enabled: !muted, sound: true, music: true, typing: false, soundVolume: 0.31, musicVolume: 0.17 }));
  }, { dark, reduced, muted });
}

try {
  await fs.mkdir(path.join(root, 'evidence/screenshots'), { recursive: true });
  await launch();
  await naturalWelcome();
  await arrayCoverage('16x10');
  const playing = await musicPlaying();
  record('欢迎自然结束后先播放阵列入场，入场完成才启动三轨配乐', playing);
  await nativeWindowIcon();
  await home.locator('[data-action="open"]').first().click();
  await home.waitForFunction(() => window.__kxHome.getState().stats.signal.phase === 'clear', null, { timeout: 45000 });
  await home.getByTestId('home-start-motor').click();
  await page.getByTestId('run-simulation').waitFor();
  const inWorkbench = await audio();
  assert.equal(inWorkbench.musicStartedAt, playing.musicStartedAt);
  assert.equal(inWorkbench.musicStartCount, 1);
  assert.equal(inWorkbench.sourceCount, 3);
  assert.equal(await page.getByTestId('welcome-screen').count(), 0);
  await page.getByTestId('feature-home').click();
  await page.getByTestId('homepage-frame').waitFor({ state: 'visible' });
  assert.equal((await homeState()).intro.completed, true);
  assert.equal(await page.getByTestId('welcome-screen').count(), 0);
  assert.equal((await audio()).musicStartedAt, playing.musicStartedAt);
  // Cross a genuine loop boundary, rather than inferring looping from config.
  await page.waitForFunction(() => {
    const state = window.__kxAudio.getState();
    return state.completedLoops >= 1 && state.outputRms > 0.00001;
  }, null, { timeout: 60000 });
  const continued = await audio();
  assert.equal(continued.musicStartCount, 1);
  assert.equal(continued.musicStartedAt, playing.musicStartedAt);
  assert.equal(continued.sourceCount, 3);
  record('进入实验台再回主页不重播两段开场，不重启音乐，并实际跨过三轨配乐循环边界', { inWorkbench, continued });

  await setFixture({ dark: true, reduced: false, muted: true });
  await close();
  await launch(1600, 900);
  await page.getByTestId('welcome-screen').waitFor();
  assert.equal(await page.getByTestId('welcome-screen').getAttribute('data-theme'), 'dark');
  await page.waitForFunction(() => window.__kxWelcome?.getState().elapsed >= 1.7, null, { timeout: 10000 });
  await screenshot('dark-muted', { state: await appState() });
  const muted = await appState();
  silentMusic(muted.audio, '静音欢迎');
  assert.equal(muted.audio.preferences.enabled, false);
  assert.equal(muted.audio.preferences.typing, false);
  assert.equal(muted.audio.preferences.musicVolume, 0.17);
  assert.equal(muted.audio.preferences.soundVolume, 0.31);
  assert.equal(muted.audio.effectCount, 0);
  assert.equal(muted.audio.outputRms, 0);
  record('旧版保存的深色、静音、文字音和音量偏好在欢迎阶段恢复，静音未触发主题声音', muted);
  await page.keyboard.press('Escape');
  await page.getByTestId('welcome-screen').waitFor({ state: 'detached' });
  await home.waitForFunction(() => window.__kxHome?.getState().intro.active, null, { timeout: 30000 });
  const afterEscape = await homeState();
  assert.equal(afterEscape.intro.completed, false, 'Esc 不能穿透并跳过下一段阵列');
  assert.equal(afterEscape.mode, 'archive');
  assert.equal(afterEscape.modal, null);
  assert.equal(afterEscape.caseId, 'motor');
  record('Esc 仅跳过欢迎，不穿透到阵列或实验入口', afterEscape.intro);
  await arrayCoverage('16x9');
  assert.equal((await audio()).sourceCount, 0);
  assert.equal((await audio()).effectCount, 0);

  await setFixture({ dark: false, reduced: false, muted: true });
  await close();
  await launch();
  await page.getByTestId('skip-welcome').click();
  await page.getByTestId('welcome-screen').waitFor({ state: 'detached' });
  await home.waitForFunction(() => window.__kxHome?.getState().intro.active, null, { timeout: 30000 });
  const afterButton = await homeState();
  assert.equal(afterButton.intro.completed, false);
  assert.equal(afterButton.mode, 'archive');
  assert.equal(afterButton.modal, null);
  assert.equal(afterButton.caseId, 'motor');
  record('跳过欢迎按钮只完成当前欢迎，不触发底层按钮或直接跳过阵列', afterButton.intro);
  // Do not focus or click the iframe here: the welcome-to-home handoff itself
  // must restore keyboard access for the next, separate Escape press.
  await page.keyboard.press('Escape');
  await home.waitForFunction(() => window.__kxHome.getState().intro.completed, null, { timeout: 3000 });
  assert.equal((await homeState()).intro.completed, true);
  record('跳过欢迎后焦点交给主页，下一次独立 Esc 可直接跳过阵列');
  await setFixture({ dark: true, reduced: true, muted: true });
  await close();
  await launch();
  await home.waitForFunction(() => {
    const state = window.__kxHome?.getState();
    return state?.ready && state.intro.completed;
  }, null, { timeout: 60000 });
  const reduced = await homeState();
  assert.equal(await page.getByTestId('welcome-screen').count(), 0);
  assert.equal((await appState()).welcome, null);
  assert.equal(reduced.prefs.reduced, true);
  assert.equal(reduced.intro.completed, true);
  assert.equal(reduced.intro.active, false);
  const reducedAudio = await audio();
  assert.equal(reducedAudio.sourceCount, 0);
  assert.equal(reducedAudio.effectCount, 0);
  assert.equal(reducedAudio.contextState, 'not-created');
  await screenshot('reduced-motion', { intro: reduced.intro, audio: reducedAudio });
  await home.locator('[data-action="search"]').click();
  await home.getByRole('dialog', { name: '实验索引', exact: true }).waitFor();
  assert.equal(await page.getByTestId('welcome-screen').count(), 0);
  assert.equal((await homeState()).intro.completed, true);
  record('减少动态直接完成欢迎和阵列，保留静音，不阻塞实验索引且不重播', { intro: reduced.intro, audio: reducedAudio });

  assert.deepEqual(rendererErrors, []);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(oldModels, []);
  assert.equal(coverage.checks.length, 8);
  record('无 renderer 异常、外网资源或旧 GLB 请求；两种比例共八张真实入场覆盖帧');
  report.passed = true;
  coverage.status = 'passed';
} catch (error) {
  report.errors.push(error.stack || String(error));
  coverage.errors.push(error.message || String(error));
  console.error(error);
  process.exitCode = 1;
  if (app && page && !page.isClosed()) await screenshot('failure').catch(() => {});
} finally {
  await close().catch(error => { report.errors.push(`Close: ${error.message}`); report.passed = false; process.exitCode = 1; });
  report.rendererErrors = rendererErrors;
  report.externalRequests = externalRequests;
  report.oldModelRequests = oldModels;
  report.finishedAt = new Date().toISOString();
  coverage.verifiedAt = report.finishedAt;
  if (!report.passed) coverage.status = 'failed';
  await fs.mkdir(path.join(root, 'evidence'), { recursive: true });
  await fs.writeFile(path.join(root, `evidence/welcome-${label}.json`), JSON.stringify(report, null, 2) + '\n');
  // Keep source and packaged coverage, so neither run erases the other's frames.
  await fs.writeFile(path.join(root, `evidence/intro-coverage-${version}-${label}.json`), JSON.stringify(coverage, null, 2) + '\n');
  // The release gate consumes this canonical path. A failing packaged run must
  // invalidate an earlier passing source run, never leave stale green evidence.
  await fs.writeFile(path.join(root, `evidence/intro-coverage-${version}.json`), JSON.stringify(coverage, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, screenshots: report.screenshots.length, report: `evidence/welcome-${label}.json` }));
}

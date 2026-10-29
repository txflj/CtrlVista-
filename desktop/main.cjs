const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { Worker } = require('node:worker_threads');

const sourceRoot = path.resolve(__dirname, '..');
const testMode = process.env.KX_TEST_MODE === '1';
if (testMode && process.env.KX_TEST_DATA_DIR) app.setPath('userData', path.resolve(process.env.KX_TEST_DATA_DIR));
app.setName('控小助');
if (process.platform === 'win32') app.setAppUserModelId('cn.kongxiaozhu.desktop');
let mainWindow;
let store;
let ai;
let exportsModule;
let rendererReady = false;
let closeHandlerReady = false;
let closeRequested = false;
let closeAllowed = false;
const workers = new Set();
const lanes = new Set();

function compute(method, payload) {
  if (workers.size >= 4) return Promise.reject(new Error('已有多个计算任务正在进行，请稍后重试。'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'compute-worker.mjs'), {
      workerData: { method, ...payload },
      resourceLimits: { maxOldGenerationSizeMb: 256 }
    });
    workers.add(worker);
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      workers.delete(worker);
      void worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('计算超时；请缩短观察窗口或减少搜索预算。')), method === 'autotune' ? 120000 : 45000);
    worker.once('message', data => finish(data.ok ? null : new Error(data.error), data.result));
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!settled) finish(new Error(`计算进程异常结束（${code}）。`)); });
  });
}

async function encrypt(text) {
  if (typeof safeStorage.isAsyncEncryptionAvailable === 'function') {
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('系统加密存储暂不可用，未保存密钥。');
    return safeStorage.encryptStringAsync(text);
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密存储不可用，未保存密钥。');
  return safeStorage.encryptString(text);
}
async function decrypt(bytes) {
  if (typeof safeStorage.decryptStringAsync === 'function') return (await safeStorage.decryptStringAsync(Buffer.from(bytes))).result;
  return safeStorage.decryptString(Buffer.from(bytes));
}
function fileStem(text) { return String(text || '控小助实验').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80) || '控小助实验'; }
function register(method, handler) {
  ipcMain.handle(`kx:${method}`, async (event, ...args) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('请求来源无效。');
    try { return await handler(...args); }
    catch (error) { throw new Error(String(error?.message || '操作失败。').slice(0, 800)); }
  });
}
async function singleLane(name, fn) {
  if (lanes.has(name)) throw new Error('同类请求正在执行，请等待完成。');
  lanes.add(name);
  try { return await fn(); } finally { lanes.delete(name); }
}

async function initialize() {
  const [{ createStore }, { createAiService }, exportFns] = await Promise.all([
    import(pathToFileURL(path.join(__dirname, 'services/storage.mjs')).href),
    import(pathToFileURL(path.join(__dirname, 'services/ai.mjs')).href),
    import(pathToFileURL(path.join(__dirname, 'services/exports.mjs')).href)
  ]);
  exportsModule = exportFns;
  store = createStore({ dataDir: app.getPath('userData'), encrypt, decrypt });
  await store.init();
  ai = createAiService({ store, simulate: (config, options) => compute('simulate', { config, options }) });
  register('getBootstrap', async () => {
    const bootstrap = { appVersion: app.getVersion(), dataPath: app.getPath('userData'), settings: await store.getSettings(), experiments: await store.listExperiments() };
    rendererReady = true;
    return bootstrap;
  });
  register('finishClose', async result => {
    if (!closeRequested) return { ok: false };
    let exit = result?.saved === true;
    if (!exit) {
      const choice = await dialog.showMessageBox(mainWindow, { type: 'warning', title: '实验尚未保存', message: '最后的修改未能保存。', detail: String(result?.error || '请返回软件重试或导出实验包。').slice(0, 600), buttons: ['返回软件', '仍然退出'], defaultId: 0, cancelId: 0, noLink: true });
      exit = choice.response === 1;
    }
    closeRequested = false;
    if (exit) { closeAllowed = true; setImmediate(() => mainWindow?.close()); }
    return { ok: exit };
  });
  register('setCloseHandlerReady', ready => { closeHandlerReady = ready === true; return { ok: true }; });
  register('listExperiments', () => store.listExperiments());
  register('saveExperiment', experiment => store.saveExperiment(experiment));
  register('deleteExperiment', id => store.deleteExperiment(id));
  register('simulate', (config, options) => compute('simulate', { config, options }));
  register('autotune', (config, options) => singleLane('autotune', () => compute('autotune', { config, options })));
  register('requestAi', request => singleLane('ai', () => ai.requestAi(request)));
  register('interpretGoal', request => singleLane('ai', () => ai.interpretGoal(request)));
  register('getSettings', () => store.getSettings());
  register('saveSettings', settings => store.saveSettings(settings));
  register('testConnection', () => singleLane('ai', () => ai.testConnection()));
  register('reproduceRun', original => compute('reproduce', { original }));
  register('openDataDirectory', async () => {
    const message = await shell.openPath(app.getPath('userData'));
    if (message) throw new Error(message);
    return { ok: true };
  });
  register('exportExperiment', async (experiment, format) => {
    const choices = { json: { label: '控小助实验包', build: e => JSON.stringify(exportsModule.createExperimentPackage(e)) }, csv: { label: '曲线数据', build: exportsModule.exportCsv }, html: { label: '实验小结', build: exportsModule.exportHtml } };
    if (!Object.hasOwn(choices, format)) throw new Error('不支持的导出格式。');
    const validation = exportsModule.validateExperimentPackage(exportsModule.createExperimentPackage(experiment));
    if (!validation.valid) throw new Error(`实验内容不完整：${validation.errors.join('；')}`);
    const result = await dialog.showSaveDialog(mainWindow, { title: `导出${choices[format].label}`, defaultPath: `${fileStem(experiment.title)}.${format}`, filters: [{ name: choices[format].label, extensions: [format] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.writeFile(result.filePath, choices[format].build(experiment), 'utf8');
    return { canceled: false, path: result.filePath };
  });
  register('importExperiment', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: '导入控小助实验包', properties: ['openFile'], filters: [{ name: '控小助实验包', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const selected = result.filePaths[0];
    if ((await fs.stat(selected)).size > 32 * 1024 * 1024) throw new Error('实验包超过 32 MB，请使用较小的实验包。');
    let data;
    try { data = JSON.parse(await fs.readFile(selected, 'utf8')); } catch { throw new Error('文件不是有效的 JSON 实验包。'); }
    return { canceled: false, experiment: await store.importExperimentObject(data) };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 960, minWidth: 1040, minHeight: 720,
    title: '控小助 · AI 控制实验工作台', backgroundColor: '#17202b', show: false,
    icon: path.join(sourceRoot, 'dist/brand/app.ico'),
    autoHideMenuBar: true,
    // The packaged local app owns one music bus; page navigation never replaces it.
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: !testMode }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  Menu.setApplicationMenu(null);
  mainWindow.once('ready-to-show', () => { if (!testMode || process.env.KX_TEST_SHOW === '1') mainWindow.show(); });
  mainWindow.on('close', event => {
    if (closeAllowed || !rendererReady || !closeHandlerReady || mainWindow.webContents.isDestroyed()) return;
    event.preventDefault();
    if (closeRequested) return;
    closeRequested = true;
    mainWindow.webContents.send('kx:before-close');
  });
  mainWindow.loadFile(path.join(sourceRoot, 'dist/index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
  app.whenReady().then(async () => { await initialize(); createWindow(); }).catch(error => {
    if (testMode) console.error('控小助启动失败', error);
    else dialog.showErrorBox('控小助启动失败', `${error.message}\n请保留软件完整目录，并查看使用说明。`);
    app.exit(1);
  });
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { for (const worker of workers) void worker.terminate(); workers.clear(); });

const { contextBridge, ipcRenderer } = require('electron');
const invoke = (method, ...args) => ipcRenderer.invoke(`kx:${method}`, ...args);
contextBridge.exposeInMainWorld('kongxiaozhu', Object.freeze({
  getBootstrap: () => invoke('getBootstrap'),
  onBeforeClose: callback => {
    if (typeof callback !== 'function') throw new Error('关闭处理器必须为函数。');
    const handler = () => callback();
    ipcRenderer.on('kx:before-close', handler);
    void invoke('setCloseHandlerReady', true);
    return () => { ipcRenderer.removeListener('kx:before-close', handler); void invoke('setCloseHandlerReady', false); };
  },
  finishClose: result => invoke('finishClose', result),
  listExperiments: () => invoke('listExperiments'),
  saveExperiment: experiment => invoke('saveExperiment', experiment),
  deleteExperiment: id => invoke('deleteExperiment', id),
  simulate: (config, options = {}) => invoke('simulate', config, options),
  autotune: (config, options = {}) => invoke('autotune', config, options),
  requestAi: request => invoke('requestAi', request),
  interpretGoal: request => invoke('interpretGoal', request),
  getSettings: () => invoke('getSettings'),
  saveSettings: settings => invoke('saveSettings', settings),
  testConnection: () => invoke('testConnection'),
  exportExperiment: (experiment, format) => invoke('exportExperiment', experiment, format),
  importExperiment: () => invoke('importExperiment'),
  reproduceRun: run => invoke('reproduceRun', run),
  openDataDirectory: () => invoke('openDataDirectory')
}));

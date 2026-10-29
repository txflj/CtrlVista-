import { createCaseConfig } from '../../core/index.mjs';

export const clone = value => JSON.parse(JSON.stringify(value));
export const makeId = () => globalThis.crypto?.randomUUID?.() || `exp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function createExperiment(caseId) {
  const config = createCaseConfig(caseId);
  const now = new Date().toISOString();
  return { id: makeId(), schemaVersion: 1, version: 1, caseId, title: config.title, mode: 'guided', config, runs: [], candidates: [], aiSessions: [], predictions: [], notes: '', reflection: '', createdAt: now, updatedAt: now, activeRunId: null, comparisonRunId: null, lastManualRunId: null };
}
export function mergeConfig(config, patch) {
  const next = clone(config);
  for (const name of ['plant', 'controller', 'simulation', 'signal', 'disturbance', 'goals', 'bounds']) {
    if (patch[name] && typeof patch[name] === 'object' && !Array.isArray(patch[name])) next[name] = { ...next[name], ...patch[name] };
  }
  if (typeof patch.title === 'string') next.title = patch.title;
  return next;
}
export const metricLabels = {
  overshoot: '目标超调', settlingTime: '目标调节时间', steadyError: '稳态误差', recoveryTime: '扰动恢复时间', controlPeak: '控制输出峰值', maxDisturbanceDeviation: '扰动最大偏差',
};
export const metricUnits = { overshoot: '%', settlingTime: 's', recoveryTime: 's' };
export function numberText(value, digits = 3) {
  if (value == null || !Number.isFinite(Number(value))) return '无法判定';
  const n = Number(value);
  if (n !== 0 && (Math.abs(n) < 0.0001 || Math.abs(n) >= 1e6)) return n.toExponential(3);
  return n.toLocaleString('zh-CN', { maximumFractionDigits: digits });
}
export function dateText(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '未知时间';
}
export const asList = value => Array.isArray(value) ? value : value ? [String(value)] : [];

// Cached structural accounting prevents adding records that the desktop store
// cannot persist. Records are immutable; unchanged subtrees reuse their totals.
const sizeCache = new WeakMap();
const encoder = new TextEncoder();
export function experimentSize(value) {
  if (value === null) return { nodes: 1, bytes: 4 };
  if (typeof value !== 'object') return { nodes: 1, bytes: encoder.encode(JSON.stringify(value)).length };
  if (sizeCache.has(value)) return sizeCache.get(value);
  let nodes = 1, bytes = 2;
  const entries = Array.isArray(value) ? value.map(item => [null, item]) : Object.entries(value);
  entries.forEach(([key, item], index) => {
    const nested = experimentSize(item); nodes += nested.nodes; bytes += nested.bytes;
    if (index) bytes++;
    if (key !== null) bytes += encoder.encode(JSON.stringify(key)).length + 1;
  });
  const result = { nodes, bytes }; sizeCache.set(value, result); return result;
}

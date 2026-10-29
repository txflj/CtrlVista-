export const MAX_PACKAGE_BYTES = 32 * 1024 * 1024;
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const secretKeys = /^(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|encryptedKey|secret|password)$/i;
const poisonKeys = new Set(['__proto__', 'prototype', 'constructor']);

export function assertSafeId(id) {
  if (typeof id !== 'string' || !ID.test(id) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id)) throw new Error('实验标识无效。');
  return id;
}

export function isPlain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function inspectJson(value) {
  let nodes = 0;
  function walk(v, depth) {
    if (++nodes > 1_500_000 || depth > 24) throw new Error('实验内容过大或嵌套层级过深。');
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('实验包含无效数值。'); return; }
    if (typeof v === 'string') { if (v.length > 100_000) throw new Error('实验文本过长。'); return; }
    if (Array.isArray(v)) {
      if (v.length > 200_001) throw new Error('实验数组超过允许长度。');
      v.forEach(item => walk(item, depth + 1)); return;
    }
    if (!isPlain(v)) throw new Error('实验必须由普通 JSON 数据组成。');
    for (const [key, item] of Object.entries(v)) {
      if (poisonKeys.has(key)) throw new Error('实验包含不支持的字段。');
      if (key.length > 100) throw new Error('实验字段名称过长。');
      walk(item, depth + 1);
    }
  }
  walk(value, 0);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_PACKAGE_BYTES) throw new Error('实验包超过 32 MB 限制。');
}

export function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (isPlain(value)) return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !secretKeys.test(key) && !poisonKeys.has(key))
    .map(([key, item]) => [key, stripSecrets(item)]));
  return value;
}

function finite(value, label, min = -1e9, max = 1e9) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label}超出允许范围。`);
}
function text(value, label, max = 20_000) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label}格式无效。`);
}
function date(value, label) {
  if (typeof value !== 'string' || value.length > 50 || !Number.isFinite(Date.parse(value))) throw new Error(`${label}无效。`);
}

export function assertConfigStructure(config) {
  if (!isPlain(config) || config.schemaVersion !== 1) throw new Error('不支持的实验配置版本。');
  for (const key of ['plant', 'controller', 'simulation', 'signal', 'disturbance', 'goals', 'bounds']) {
    if (!isPlain(config[key])) throw new Error(`实验配置缺少 ${key}。`);
  }
  const { plant, controller, simulation, signal, disturbance, goals, bounds } = config;
  for (const key of ['numerator', 'denominator']) {
    if (!Array.isArray(plant[key]) || plant[key].length < 1 || plant[key].length > 4) throw new Error('传递函数系数格式无效。');
    plant[key].forEach(v => finite(v, '传递函数系数'));
  }
  const numerator = [...plant.numerator];
  while (numerator.length > 1 && numerator[0] === 0) numerator.shift();
  if (plant.denominator.length < 2 || plant.denominator[0] === 0 || numerator.length >= plant.denominator.length) throw new Error('仅支持最高 3 阶严格真有理对象。');
  if (!['P', 'PI', 'PID'].includes(controller.type)) throw new Error('控制器类型无效。');
  ['kp', 'ki', 'kd'].forEach(k => finite(controller[k], '控制器参数', 0, 1e6));
  finite(controller.tf, '微分滤波时间', 1e-8, 1e6);
  finite(simulation.duration, '仿真时长', 1e-6, 100_000);
  finite(simulation.dt, '采样间隔', 1e-8, simulation.duration);
  if (simulation.duration / simulation.dt > 200_000) throw new Error('仿真采样点超过允许上限。');
  if (!Array.isArray(simulation.initialState) || simulation.initialState.length > 3) throw new Error('初始状态格式无效。');
  simulation.initialState.forEach(v => finite(v, '初始状态'));
  finite(simulation.integralInitial, '积分初值'); finite(simulation.filterInitial, '滤波初值');
  finite(signal.initial, '初始目标'); finite(signal.target, '目标值'); finite(signal.stepTime, '阶跃时刻', 0, simulation.duration);
  if (typeof disturbance.enabled !== 'boolean') throw new Error('扰动开关无效。');
  finite(disturbance.time, '扰动时刻', 0, 100_000); finite(disturbance.amplitude, '扰动幅值');
  if (disturbance.duration !== null) finite(disturbance.duration, '扰动持续时间', 1e-8, 100_000);
  for (const key of ['overshootMax','settlingTimeMax','steadyErrorMax','recoveryTimeMax','controlPeakMax','absoluteTolerance','relativeTolerance','referenceScale','holdTime']) {
    if (goals[key] !== null) finite(goals[key], '目标约束', 0, 1e9);
  }
  for (const key of ['kp','ki','kd']) {
    if (!Array.isArray(bounds[key]) || bounds[key].length !== 2) throw new Error('参数搜索范围无效。');
    bounds[key].forEach(v => finite(v, '参数搜索范围', 0, 1e6));
    if (bounds[key][0] > bounds[key][1]) throw new Error('参数搜索上下界顺序错误。');
  }
  return config;
}

export function assertRun(run) {
  if (!isPlain(run)) throw new Error('运行记录格式无效。');
  assertSafeId(run.id); assertConfigStructure(run.config);
  if (!['completed','invalid','unstable','numerical_error'].includes(run.status)) throw new Error('运行状态无效。');
  if (!['pass','fail','unknown'].includes(run.verdict)) throw new Error('运行判定无效。');
  if (!Number.isInteger(run.configVersion) || run.configVersion < 1) throw new Error('运行配置版本无效。');
  text(run.engineVersion, '计算版本', 100); text(run.conditionKey, '评价条件', 20000); date(run.createdAt, '运行时间'); text(run.reason, '运行说明');
  if (run.conditionKey !== conditionKey(run.config)) throw new Error('运行评价条件与配置不一致。');
  if (run.status !== 'completed' && run.verdict === 'pass') throw new Error('未完成的计算不能标记为达标。');
  if (!isPlain(run.metrics) || !isPlain(run.curves) || !Array.isArray(run.checks)) throw new Error('运行结果不完整。');
  const lengths = ['t','r','y','e','u','d'].map(key => {
    if (!Array.isArray(run.curves[key])) throw new Error('运行曲线不完整。');
    run.curves[key].forEach(value => finite(value, '曲线数值', -1e100, 1e100));
    return run.curves[key].length;
  });
  if (new Set(lengths).size !== 1) throw new Error('曲线采样长度不一致。');
  if (run.status === 'completed' && lengths[0] < 2) throw new Error('已完成计算缺少有效采样。');
  for (let i=1;i<run.curves.t.length;i++) if (run.curves.t[i] <= run.curves.t[i-1]) throw new Error('曲线时间轴必须严格递增。');
  for (const key of ['overshoot','settlingTime','steadyError','recoveryTime','controlPeak','maxDisturbanceDeviation']) if (run.metrics[key] !== null) finite(run.metrics[key], '性能指标', -1e100, 1e100);
  if (run.checks.length > 30 || !Array.isArray(run.warnings) || run.warnings.length > 100 || !Array.isArray(run.poles) || run.poles.length > 8) throw new Error('运行附加信息无效。');
  run.warnings.forEach(value => text(value, '计算警告', 2000));
  run.poles.forEach(pole => { if (!isPlain(pole)) throw new Error('闭环极点无效。'); finite(pole.real, '极点实部', -1e100, 1e100); finite(pole.imaginary, '极点虚部', -1e100, 1e100); });
  run.checks.forEach(check => {
    if (!isPlain(check) || !['pass','fail','unknown'].includes(check.state)) throw new Error('指标判定无效。');
    text(check.key, '指标标识', 100); text(check.label, '指标名称', 200); text(check.message, '指标说明', 4000);
    if (check.value !== null) finite(check.value, '指标值', -1e100, 1e100);
    if (check.limit !== null) finite(check.limit, '指标限制', -1e100, 1e100);
  });
}

export function assertExperiment(experiment) {
  inspectJson(experiment);
  if (!isPlain(experiment) || experiment.schemaVersion !== 1) throw new Error('不支持的实验记录版本。');
  assertSafeId(experiment.id);
  text(experiment.title, '实验名称', 200); text(experiment.caseId, '案例标识', 100);
  if (!Number.isInteger(experiment.version) || experiment.version < 1) throw new Error('实验配置版本无效。');
  if (!['guided','free'].includes(experiment.mode)) throw new Error('实验模式无效。');
  assertConfigStructure(experiment.config);
  const currentValidation = validateConfig(experiment.config);
  if (!currentValidation.valid) throw new Error(`当前实验配置无效：${currentValidation.errors.join('；')}`);
  date(experiment.createdAt, '创建时间'); date(experiment.updatedAt, '修改时间');
  for (const key of ['runs','candidates','aiSessions','predictions']) {
    if (!Array.isArray(experiment[key]) || experiment[key].length > 200) throw new Error(`${key}记录数量超出上限。`);
  }
  experiment.runs.forEach(assertRun);
  if (experiment.runs.some(run => run.configVersion > experiment.version)) throw new Error('运行记录引用了尚不存在的配置版本。');
  if (new Set(experiment.runs.map(run => run.id)).size !== experiment.runs.length) throw new Error('运行记录标识重复。');
  function candidateRecord(candidate) {
    if (!isPlain(candidate)) throw new Error('候选记录无效。');
    assertSafeId(candidate.id); assertRun(candidate.run);
    if (!Number.isInteger(candidate.basedOnVersion) || candidate.basedOnVersion < 1) throw new Error('候选配置版本无效。');
    if (candidate.basedOnVersion !== candidate.run.configVersion || candidate.basedOnVersion > experiment.version) throw new Error('候选版本与计算记录不一致。');
    if (!isPlain(candidate.controller) || ['type','kp','ki','kd','tf'].some(key => candidate.controller[key] !== candidate.run.config.controller[key])) throw new Error('候选控制器与计算记录不一致。');
  }
  experiment.candidates.forEach(candidateRecord);
  experiment.aiSessions.forEach(session => {
    if (!isPlain(session) || !Array.isArray(session.candidates) || session.candidates.length > 3) throw new Error('AI 会话记录无效。');
    assertSafeId(session.id); date(session.createdAt, 'AI 会话时间'); text(session.question, 'AI 问题'); text(session.summary, 'AI 说明', 100000);
    text(session.model, 'AI 模型名称', 200); text(session.conditionKey, 'AI 评价条件', 20000);
    if (!Number.isInteger(session.basedOnVersion) || session.basedOnVersion < 1 || session.status !== 'completed') throw new Error('AI 会话状态无效。');
    if (session.basedOnVersion > experiment.version) throw new Error('AI 会话引用了尚不存在的配置版本。');
    if (session.baseline !== undefined) {
      assertRun(session.baseline);
      if (session.baseline.configVersion !== session.basedOnVersion || session.baseline.conditionKey !== session.conditionKey) throw new Error('AI 基准与会话评价条件不一致。');
    }
    if (!Array.isArray(session.toolLog) || session.toolLog.length > 72) throw new Error('AI 工具记录无效。');
    session.candidates.forEach(candidateRecord);
    if (session.candidates.some(candidate => candidate.basedOnVersion !== session.basedOnVersion || candidate.run.conditionKey !== session.conditionKey)) throw new Error('AI 候选未使用统一版本和评价条件。');
  });
  experiment.predictions.forEach(prediction => {
    if (!isPlain(prediction)) throw new Error('预测记录无效。');
    assertSafeId(prediction.id); date(prediction.createdAt, '预测时间'); text(prediction.text, '预测内容'); text(prediction.observation, '观察内容');
    if (!Number.isInteger(prediction.configVersion) || prediction.configVersion < 1) throw new Error('预测配置版本无效。');
  });
  text(experiment.notes, '笔记'); text(experiment.reflection, '复盘');
  if (experiment.activeRunId !== null && !experiment.runs.some(run => run.id === experiment.activeRunId)) throw new Error('当前运行标识没有对应记录。');
  for (const key of ['comparisonRunId', 'lastManualRunId']) {
    if (Object.hasOwn(experiment, key) && experiment[key] !== null && !experiment.runs.some(run => run.id === experiment[key] && run.status === 'completed')) throw new Error('对照或手动运行标识必须指向本实验已完成的计算记录。');
  }
  return experiment;
}

export function normalizeEndpoint(baseUrl) {
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error('模型服务地址不是有效 URL。'); }
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('模型服务须使用 HTTPS；本机服务可使用 localhost HTTP。');
  if (url.username || url.password || url.search || url.hash) throw new Error('模型服务地址不能含凭据、查询参数或片段。');
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}
import { conditionKey, validateConfig } from '../../src/core/index.mjs';

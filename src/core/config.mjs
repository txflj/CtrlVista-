import { plantStateSpace, polesOf, isStrictlyStable } from './numerics.mjs';

export const ENGINE_VERSION = '1.0.0';
export const MAX_SAMPLES = 24001;
export const clone = value => JSON.parse(JSON.stringify(value));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function validateConfig(config) {
  const errors = [], warnings = [];
  if (!plain(config)) return { valid: false, errors: ['实验配置必须是对象'], warnings };
  for (const key of ['plant', 'controller', 'simulation', 'signal', 'disturbance', 'goals', 'bounds']) {
    if (!plain(config[key])) errors.push(`缺少或无效的配置：${key}`);
  }
  if (errors.length) return { valid: false, errors, warnings };
  if (config.schemaVersion !== 1) errors.push('不支持的实验配置版本');
  const { plant, controller, simulation, signal, disturbance, goals, bounds } = config;
  for (const key of ['numerator', 'denominator']) {
    const array = plant[key];
    if (!Array.isArray(array) || !array.length || array.length > 4 || !array.every(v => finite(v) && Math.abs(v) <= 1e8)) errors.push(`${key === 'numerator' ? '分子' : '分母'}系数必须是长度不超过 4 的有限数字数组`);
  }
  if (!errors.length) {
    const denominator = plant.denominator, numerator = [...plant.numerator];
    while (numerator.length > 1 && numerator[0] === 0) numerator.shift();
    if (denominator.length < 2 || denominator.length > 4) errors.push('被控对象必须为 1—3 阶');
    if (Math.abs(denominator[0]) < 1e-12) errors.push('分母最高次系数不能为零或过小');
    if (numerator.length >= denominator.length) errors.push('分子阶数必须低于分母阶数');
    const dc = numerator.at(-1) / denominator.at(-1);
    if (!finite(dc) || dc <= 0) errors.push('稳态增益必须为有限正数');
    if (!errors.length) {
      try {
        if (!isStrictlyStable(polesOf(plantStateSpace(plant).a))) errors.push('被控对象须严格稳定，当前包含非负实部或过于接近零的极点');
      } catch { errors.push('无法可靠计算被控对象极点，请检查系数尺度'); }
    }
  }
  if (!['P', 'PI', 'PID'].includes(controller.type)) errors.push('控制器类型只能为 P、PI 或 PID');
  for (const key of ['kp', 'ki', 'kd']) {
    if (!finite(controller[key]) || controller[key] < 0 || controller[key] > 1e5) errors.push(`${key} 必须是 0—100000 的有限数值`);
    const range = bounds[key];
    if (!Array.isArray(range) || range.length !== 2 || !range.every(finite) || range[0] < 0 || range[0] > range[1] || range[1] > 1e5) errors.push(`${key} 的搜索范围无效`);
    else if (finite(controller[key]) && (controller[key] < range[0] || controller[key] > range[1])) errors.push(`${key} 超出声明的参数范围`);
  }
  if (!finite(controller.tf) || controller.tf < 0.00001 || controller.tf > 100) errors.push('微分滤波时间常数须在 0.00001—100 s 内');
  if (!finite(simulation.duration) || simulation.duration <= 0 || simulation.duration > 3600) errors.push('仿真时长须大于 0 且不超过 3600 s');
  if (!finite(simulation.dt) || simulation.dt < 0.00001 || simulation.dt > simulation.duration) errors.push('采样步长须为正数、不小于 0.00001 s 且不超过仿真时长');
  if (finite(simulation.duration) && finite(simulation.dt) && Math.ceil(simulation.duration / simulation.dt) + 5 > MAX_SAMPLES) errors.push(`采样点数过多，请增加步长（最多 ${MAX_SAMPLES} 个采样点）`);
  const order = Array.isArray(plant.denominator) ? plant.denominator.length - 1 : 0;
  if (!Array.isArray(simulation.initialState) || ![0, order].includes(simulation.initialState.length) || !simulation.initialState.every(v => finite(v) && Math.abs(v) <= 1e6)) errors.push('初始状态应为空数组或与被控对象阶数相同的有限数组');
  for (const key of ['integralInitial', 'filterInitial']) if (!finite(simulation[key]) || Math.abs(simulation[key]) > 1e6) errors.push(`${key} 初值无效`);
  for (const key of ['initial', 'target']) if (!finite(signal[key]) || Math.abs(signal[key]) > 1e6) errors.push(`目标信号 ${key} 无效`);
  if (!finite(signal.stepTime) || signal.stepTime < 0 || signal.stepTime >= simulation.duration) errors.push('目标变化时刻必须位于仿真窗口内');
  if (typeof disturbance.enabled !== 'boolean') errors.push('扰动启用状态须为布尔值');
  if (!finite(disturbance.time) || disturbance.time < 0) errors.push('扰动时刻无效');
  if (!finite(disturbance.amplitude) || Math.abs(disturbance.amplitude) > 1e6) errors.push('扰动幅值无效');
  if (disturbance.duration !== null && (!finite(disturbance.duration) || disturbance.duration <= 0)) errors.push('扰动持续时间应为正数，或 null 表示持续扰动');
  if (disturbance.enabled && disturbance.time >= simulation.duration) errors.push('启用的扰动必须发生在仿真结束前');
  if (disturbance.enabled && disturbance.time <= signal.stepTime) warnings.push('扰动早于或同时发生于目标变化，目标跟踪阶段可能无法单独评价');
  for (const key of ['overshootMax', 'settlingTimeMax', 'steadyErrorMax', 'recoveryTimeMax']) {
    if (goals[key] !== null && (!finite(goals[key]) || goals[key] < 0)) errors.push(`${key} 必须为非负数或 null`);
  }
  if (!finite(goals.controlPeakMax) || goals.controlPeakMax <= 0) errors.push('控制输出峰值预算须为正数');
  for (const key of ['absoluteTolerance', 'relativeTolerance']) if (!finite(goals[key]) || goals[key] < 0) errors.push(`${key} 必须是非负数`);
  if (!finite(goals.referenceScale) || goals.referenceScale <= 0) errors.push('误差带参考幅值必须为正数');
  if (!finite(goals.holdTime) || goals.holdTime <= 0 || goals.holdTime > simulation.duration) errors.push('最短保持时间须为正数且不超过观察窗口');
  if (finite(goals.absoluteTolerance) && finite(goals.relativeTolerance) && goals.absoluteTolerance === 0 && goals.relativeTolerance === 0) errors.push('目标误差带不能为零');
  if (finite(goals.relativeTolerance) && finite(goals.referenceScale) && !Number.isFinite(goals.relativeTolerance * goals.referenceScale)) errors.push('相对误差带与参考幅值的乘积超出有限数值范围');
  if (signal.initial === signal.target && goals.overshootMax !== null) warnings.push('目标变化幅度为零，百分比超调无法定义；可关闭该项或设置非零阶跃');
  return { valid: errors.length === 0, errors, warnings };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
  return value;
}

export function conditionKey(config) {
  if (!config || typeof config !== 'object') return 'invalid';
  return JSON.stringify(canonical({ plant: config.plant, simulation: config.simulation, signal: config.signal,
    disturbance: config.disturbance, goals: config.goals, bounds: config.bounds }));
}

export function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

import { Matrix, solve } from './numerics.mjs';

const EPS = 1e-10;
const clean = value => Number.isFinite(value) ? (Math.abs(value) < 1e-13 ? 0 : value) : null;

function settling(curves, from, to, target, band, holdTime) {
  const indices = curves.t.map((t, i) => ({ t, i })).filter(p => p.t >= from - EPS && p.t <= to + EPS);
  if (indices.length < 2) return { value: null, observed: Math.max(0, to - from), indices };
  let lastOutside = -1;
  for (let j = 0; j < indices.length; j++) if (Math.abs(curves.y[indices[j].i] - target) > band) lastOutside = j;
  if (lastOutside === indices.length - 1) return { value: null, observed: to - from, indices };
  const firstInside = lastOutside < 0 ? 0 : lastOutside + 1;
  const enter = indices[firstInside].t;
  const enoughHold = to - enter >= holdTime - EPS;
  return { value: enoughHold ? Math.max(0, enter - from) : null, observed: to - from, indices };
}

function timeCheck(key, label, measurement, limit, curves, from, target, band, holdTime) {
  if (limit === null) return null;
  let state = 'unknown', message = '当前观察窗口不足以确认进入并保持在目标误差带内';
  if (measurement.value !== null) {
    state = measurement.value <= limit + EPS ? 'pass' : 'fail';
    message = state === 'pass' ? '在当前观察窗口内满足时间与保持要求' : '进入并保持目标误差带所需时间超过限制';
  } else {
    const deadlineSample = measurement.indices.find(p => p.t >= from + limit - EPS);
    if (measurement.observed >= limit + holdTime - EPS || (deadlineSample && Math.abs(curves.y[deadlineSample.i] - target) > band)) {
      state = 'fail'; message = '在任务规定期限内未满足目标误差带与保持要求';
    }
  }
  return { key, label, value: clean(measurement.value), limit, state, message };
}

export function calculateMetrics(config, system, curves, peakControl) {
  const { goals, signal, disturbance, simulation } = config;
  const band = Math.max(goals.absoluteTolerance, goals.relativeTolerance * goals.referenceScale);
  const target = signal.target;
  const trackEnd = disturbance.enabled ? Math.min(simulation.duration, disturbance.time) : simulation.duration;
  const track = settling(curves, signal.stepTime, trackEnd, target, band, goals.holdTime);
  const trackPoints = track.indices.map(p => curves.y[p.i]);
  const amplitude = target - signal.initial;
  const sign = Math.sign(amplitude) || 1;
  const absoluteOvershoot = trackPoints.length ? Math.max(0, ...trackPoints.map(y => sign * (y - target))) : null;
  const overshoot = amplitude !== 0 && absoluteOvershoot !== null ? absoluteOvershoot / Math.abs(amplitude) * 100 : null;
  let recovery = { value: null, observed: 0, indices: [] };
  let maximumDeviation = null;
  if (disturbance.enabled && disturbance.time >= signal.stepTime) {
    recovery = settling(curves, disturbance.time, simulation.duration, target, band, goals.holdTime);
    if (recovery.indices.length) maximumDeviation = Math.max(...recovery.indices.map(p => Math.abs(curves.y[p.i] - target)));
  }
  let finalValue = null, steadyError = null;
  try {
    const finalDisturbance = disturbance.enabled && disturbance.duration === null ? disturbance.amplitude : 0;
    const forcing = system.br.map((v, i) => -v * target - system.bd[i] * finalDisturbance);
    const equilibrium = solve(system.a, Matrix.columnVector(forcing)).to1DArray();
    finalValue = system.output(equilibrium);
    steadyError = Math.abs(target - finalValue);
  } catch { /* A numerically unreliable equilibrium remains unknown. */ }
  const metrics = {
    overshoot: clean(overshoot), overshootAbsolute: clean(absoluteOvershoot),
    settlingTime: clean(track.value), steadyError: clean(steadyError), recoveryTime: clean(recovery.value),
    controlPeak: clean(peakControl), maxDisturbanceDeviation: clean(maximumDeviation),
    finalValue: clean(finalValue), tailError: clean(Math.abs(target - curves.y.at(-1))),
    toleranceBand: band, trackingObservedFor: Math.max(0, trackEnd - signal.stepTime),
  };
  const checks = [{ key: 'stability', label: '闭环稳定性', value: null, limit: null, state: 'pass', message: '线性闭环极点实部严格小于零' }];
  const simple = (key, label, value, limit, message) => {
    if (limit !== null) checks.push({ key, label, value, limit,
      state: value === null ? 'unknown' : value <= limit ? 'pass' : 'fail',
      message: value === null ? '该指标当前无法定义或可靠计算' : message });
  };
  simple('overshoot', '目标超调量（%）', metrics.overshoot, goals.overshootMax, '相对目标阶跃幅度，评价扰动发生前的跟踪阶段');
  const st = timeCheck('settlingTime', '目标调节时间（s）', track, goals.settlingTimeMax, curves, signal.stepTime, target, band, goals.holdTime);
  if (st) checks.push(st);
  simple('steadyError', '理论稳态误差', metrics.steadyError, goals.steadyErrorMax, '由稳定线性系统最终恒定输入的平衡方程求得，并非末采样值');
  simple('controlPeak', '控制输出峰值', metrics.controlPeak, goals.controlPeakMax, '未裁剪的输出，在采样点及输入事件左右极限中检查');
  if (disturbance.enabled) {
    const rc = timeCheck('recoveryTime', '扰动恢复时间（s）', recovery, goals.recoveryTimeMax, curves, disturbance.time, target, band, goals.holdTime);
    if (rc) {
      if (metrics.recoveryTime === 0) rc.message = '在当前采样与观察窗口内未离开目标误差带，保持时长满足要求';
      checks.push(rc);
    }
  }
  const verdict = checks.some(c => c.state === 'fail') ? 'fail' : checks.every(c => c.state === 'pass') ? 'pass' : 'unknown';
  const failed = checks.filter(c => c.state !== 'pass').map(c => c.label);
  const reason = verdict === 'pass' ? '全部必需条件在声明的计算和观察条件下通过'
    : `${verdict === 'fail' ? '未达标' : '无法判定'}：${failed.join('、')}`;
  return { metrics, checks, verdict, reason };
}

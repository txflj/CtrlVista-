import { ENGINE_VERSION, validateConfig, conditionKey, clone, newId } from './config.mjs';
import { closedLoop, polesOf, isStrictlyStable, transition } from './numerics.mjs';
import { calculateMetrics } from './metrics.mjs';

function baseRun(config, options) {
  let snapshot;
  try { snapshot = clone(config); } catch { snapshot = {}; }
  return {
    id: options.id ?? newId(), configVersion: options.configVersion ?? 1, conditionKey: conditionKey(snapshot),
    config: snapshot, engineVersion: ENGINE_VERSION, createdAt: new Date().toISOString(),
    status: 'completed', verdict: 'unknown', reason: '', metrics: {
      overshoot: null, settlingTime: null, steadyError: null, recoveryTime: null, controlPeak: null, maxDisturbanceDeviation: null,
    }, checks: [], curves: { t: [], r: [], y: [], e: [], u: [], d: [] }, poles: [], warnings: [],
  };
}

export function simulate(config, options = {}) {
  const run = baseRun(config, options);
  const validation = validateConfig(run.config);
  run.warnings = validation.warnings;
  if (!validation.valid) {
    run.status = 'invalid'; run.reason = validation.errors.join('；');
    run.checks = [{ key: 'input', label: '输入有效性', value: null, limit: null, state: 'unknown', message: run.reason }];
    return run;
  }
  config = run.config;
  try {
    const system = closedLoop(config);
    run.poles = polesOf(system.a);
    if (!isStrictlyStable(run.poles)) {
      run.status = 'unstable'; run.verdict = 'fail'; run.reason = '闭环不满足严格稳定条件，未将发散轨迹作为有效改进方案';
      run.checks = [{ key: 'stability', label: '闭环稳定性', value: null, limit: null, state: 'fail', message: run.reason }];
      return run;
    }
    const { duration, dt } = config.simulation;
    const { signal, disturbance } = config;
    const referenceAt = t => t >= signal.stepTime - 1e-12 ? signal.target : signal.initial;
    const disturbanceAt = t => disturbance.enabled && t >= disturbance.time - 1e-12
      && (disturbance.duration === null || t < disturbance.time + disturbance.duration - 1e-12) ? disturbance.amplitude : 0;
    const grid = [];
    for (let i = 0; i <= Math.floor(duration / dt); i++) grid.push(Number((i * dt).toPrecision(14)));
    grid.push(duration, signal.stepTime);
    if (disturbance.enabled) {
      grid.push(disturbance.time);
      if (disturbance.duration !== null && disturbance.time + disturbance.duration < duration) grid.push(disturbance.time + disturbance.duration);
    }
    const times = grid.filter(t => t >= 0 && t <= duration).sort((a, b) => a - b)
      .filter((t, i, arr) => i === 0 || t - arr[i - 1] > 1e-11);
    let state = [...system.initial], peakControl = 0;
    const transitions = new Map();
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (i > 0) {
        const previous = times[i - 1], h = t - previous;
        const key = h.toPrecision(11);
        if (!transitions.has(key)) transitions.set(key, transition(system, h));
        const oldReference = referenceAt(previous), oldDisturbance = disturbanceAt(previous);
        state = transitions.get(key)(state, oldReference, oldDisturbance);
        peakControl = Math.max(peakControl, Math.abs(system.action(state, oldReference)));
      }
      const r = referenceAt(t), d = disturbanceAt(t), y = system.output(state), u = system.action(state, r);
      if (![...state, y, u].every(Number.isFinite) || state.some(v => Math.abs(v) > 1e14)) throw new Error('数值幅值超过可靠计算范围');
      peakControl = Math.max(peakControl, Math.abs(u));
      run.curves.t.push(t); run.curves.r.push(r); run.curves.d.push(d);
      run.curves.y.push(y); run.curves.e.push(r - y); run.curves.u.push(u);
    }
    Object.assign(run, calculateMetrics(config, system, run.curves, peakControl));
    run.warnings.push('调节与恢复时间是当前采样和观察窗口内的结果，不能证明窗口外永不越界。');
    if (Math.max(...run.poles.map(p => Math.hypot(p.real, p.imaginary))) * dt > 0.5) run.warnings.push('采样步长相对最快闭环动态偏大；状态转移使用矩阵指数，峰值与时间指标仍建议用更细采样复核。');
    return run;
  } catch (error) {
    run.status = 'numerical_error'; run.verdict = 'unknown'; run.reason = `数值计算未完成：${error.message}`;
    run.curves = { t: [], r: [], y: [], e: [], u: [], d: [] };
    run.metrics = { overshoot: null, settlingTime: null, steadyError: null, recoveryTime: null, controlPeak: null, maxDisturbanceDeviation: null };
    run.checks = [{ key: 'numerical', label: '数值计算', value: null, limit: null, state: 'unknown', message: run.reason }];
    return run;
  }
}

export function compareRuns(original, recomputed) {
  const tolerances = { absolute: 1e-8, relative: 1e-6, time: Math.max(original?.config?.simulation?.dt ?? 0, recomputed?.config?.simulation?.dt ?? 0) + 1e-9 };
  const close = (a, b, time = false) => a === null && b === null ? true : typeof a === 'number' && typeof b === 'number'
    && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= (time ? tolerances.time : tolerances.absolute + tolerances.relative * Math.max(Math.abs(a), Math.abs(b)));
  const reasons = [];
  if (!original || !recomputed) return { pass: false, metrics: [], curveMaxError: null, tolerances, summary: '缺少待比较的计算记录' };
  const hasResult = run => ['completed', 'invalid', 'unstable', 'numerical_error'].includes(run.status)
    && ['pass', 'fail', 'unknown'].includes(run.verdict) && run.metrics && typeof run.metrics === 'object'
    && ['overshoot', 'settlingTime', 'steadyError', 'recoveryTime', 'controlPeak', 'maxDisturbanceDeviation'].every(key => Object.hasOwn(run.metrics, key));
  if (!hasResult(original) || !hasResult(recomputed)) reasons.push('计算记录不完整');
  if (original.engineVersion !== recomputed.engineVersion) reasons.push('计算版本不同');
  const controllerKey = config => JSON.stringify(['type', 'kp', 'ki', 'kd', 'tf'].map(key => config?.controller?.[key]));
  if (original.conditionKey !== recomputed.conditionKey || conditionKey(original.config) !== conditionKey(recomputed.config)
    || original.conditionKey !== conditionKey(original.config) || controllerKey(original.config) !== controllerKey(recomputed.config)) reasons.push('计算配置不同');
  if (original.status !== recomputed.status || original.verdict !== recomputed.verdict) reasons.push('运行状态或达标判定不一致');
  const metrics = Object.keys(original.metrics ?? {}).map(key => ({ key, original: original.metrics[key], recomputed: recomputed.metrics?.[key] ?? null,
    pass: close(original.metrics[key], recomputed.metrics?.[key] ?? null, ['settlingTime', 'recoveryTime'].includes(key)) }));
  if (metrics.some(m => !m.pass)) reasons.push('部分指标超过公开容差');
  let curveMaxError = 0, curvePass = true;
  for (const key of ['t', 'r', 'y', 'e', 'u', 'd']) {
    const a = original.curves?.[key], b = recomputed.curves?.[key];
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) { curvePass = false; continue; }
    for (let i = 0; i < a.length; i++) {
      if (!close(a[i], b[i])) curvePass = false;
      if (Number.isFinite(a[i]) && Number.isFinite(b[i])) curveMaxError = Math.max(curveMaxError, Math.abs(a[i] - b[i]));
    }
  }
  if (!curvePass) reasons.push('曲线采样网格或数值不一致');
  return { pass: reasons.length === 0, metrics, curveMaxError, tolerances,
    summary: reasons.length ? `复算不一致：${reasons.join('；')}` : '配置、运行状态、采样曲线和指标均满足公开复算容差' };
}

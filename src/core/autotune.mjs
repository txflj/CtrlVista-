import { clone, validateConfig } from './config.mjs';
import { CASES } from './cases.mjs';
import { simulate } from './engine.mjs';

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function scoreRun(run) {
  if (run.status !== 'completed') return 1e12;
  const goals = run.config.goals, m = run.metrics;
  let score = run.verdict === 'pass' ? 0 : run.verdict === 'unknown' ? 1000 : 2000;
  const limits = { overshoot: goals.overshootMax, settlingTime: goals.settlingTimeMax,
    steadyError: goals.steadyErrorMax, recoveryTime: run.config.disturbance.enabled ? goals.recoveryTimeMax : null,
    controlPeak: goals.controlPeakMax };
  for (const [key, limit] of Object.entries(limits)) {
    if (limit === null) continue;
    if (m[key] === null) score += 200;
    else score += 10 * Math.min(1e4, m[key] / Math.max(limit, key === 'steadyError' ? 0.001 : 0.01));
  }
  // Area of absolute tracking error helps distinguish finite-window failures.
  let iae = 0;
  for (let i = 1; i < run.curves.t.length; i++) iae += (run.curves.t[i] - run.curves.t[i - 1]) * (Math.abs(run.curves.e[i]) + Math.abs(run.curves.e[i - 1])) / 2;
  return score + Math.min(100, iae / run.config.goals.referenceScale);
}

export function autotune(config, options = {}) {
  const budget = Number.isInteger(options.budget) ? Math.max(1, Math.min(160, options.budget)) : 48;
  const seed = Number.isInteger(options.seed) ? options.seed >>> 0 : 42;
  const validation = validateConfig(config);
  if (!validation.valid) return { candidates: [], evaluated: 0, budget, seed, summary: `配置无效，未开始搜索：${validation.errors.join('；')}` };
  const random = randomGenerator(seed), source = clone(config), base = source.controller;
  const dimensions = base.type === 'P' ? ['kp'] : base.type === 'PI' ? ['kp', 'ki'] : ['kp', 'ki', 'kd'];
  const clamp = (key, v) => Math.min(source.bounds[key][1], Math.max(source.bounds[key][0], v));
  const normalize = controller => {
    const out = { ...base };
    for (const key of dimensions) out[key] = Number(clamp(key, controller[key]).toPrecision(10));
    return out;
  };
  const queue = [base];
  const reference = CASES.find(c => c.id === config.caseId)?.referenceController;
  if (reference?.type === base.type) queue.push(reference);
  for (const multiplier of [0.25, 0.5, 2, 4]) queue.push(Object.fromEntries(dimensions.map(k => [k, (base[k] || source.bounds[k][1] * 0.02) * multiplier])));
  for (const key of dimensions) for (const multiplier of [0, 0.5, 2]) queue.push({ ...base, [key]: base[key] * multiplier });
  const seen = new Set(), results = [];
  let evaluated = 0, rejected = 0, attempts = 0, best = null;
  while (evaluated < budget && attempts++ < budget * 25 + 50) {
    let proposal;
    if (queue.length) proposal = queue.shift();
    else if (random() < 0.6) {
      const center = best?.controller ?? base;
      proposal = { ...center };
      for (const key of dimensions) proposal[key] = (center[key] || source.bounds[key][1] * 0.03) * Math.exp((random() - 0.5) * 3.2);
    } else {
      proposal = { ...base };
      for (const key of dimensions) {
        const [min, max] = source.bounds[key];
        proposal[key] = min + (max - min) * random() ** 2.5;
      }
    }
    const controller = normalize(proposal), key = JSON.stringify(controller);
    if (seen.has(key)) continue;
    seen.add(key);
    const run = simulate({ ...source, controller }, { configVersion: options.configVersion ?? 1 });
    evaluated++;
    if (run.status !== 'completed') { rejected++; continue; }
    const candidate = { controller, run, score: scoreRun(run) };
    results.push(candidate);
    if (!best || candidate.score < best.score) best = candidate;
  }
  results.sort((a, b) => a.score - b.score || JSON.stringify(a.controller).localeCompare(JSON.stringify(b.controller)));
  const candidates = results.slice(0, 3), passCount = results.filter(r => r.run.verdict === 'pass').length;
  return { candidates, evaluated, budget, seed,
    summary: `在声明的 ${base.type} 参数范围内实际计算 ${evaluated} 组（预算 ${budget}，随机种子 ${seed}），${passCount} 组达标，${rejected} 组因不稳定或数值问题排除。${passCount ? '展示评分最优的至多 3 组，仍需查看各项取舍。' : '本次有限搜索未找到达标参数，不代表数学上不存在可行解。'}` };
}

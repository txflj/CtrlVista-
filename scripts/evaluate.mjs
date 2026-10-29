import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { CASES, createCaseConfig, simulate, autotune, compareRuns, ENGINE_VERSION } from '../src/core/index.mjs';

const results = [];
for (const definition of CASES) {
  const config = createCaseConfig(definition.id);
  const initial = simulate(config);
  const reference = simulate({ ...config, controller: definition.referenceController });
  const finer = simulate({ ...reference.config, simulation: { ...config.simulation, dt: config.simulation.dt / 2 } });
  const started = performance.now();
  const tuned = autotune(config, { budget: 48, seed: 42 });
  const elapsedMs = performance.now() - started;
  const repeat = simulate(reference.config);
  const delta = Object.fromEntries(['overshoot','settlingTime','steadyError','recoveryTime','controlPeak'].map(key => [key,
    reference.metrics[key] === null || finer.metrics[key] === null ? null : Math.abs(reference.metrics[key] - finer.metrics[key])
  ]));
  results.push({ caseId: definition.id, name: definition.name,
    initial: { status: initial.status, verdict: initial.verdict, metrics: initial.metrics },
    reference: { controller: definition.referenceController, status: reference.status, verdict: reference.verdict, metrics: reference.metrics },
    finerSampling: { dt: finer.config.simulation.dt, verdict: finer.verdict, absoluteMetricDifference: delta },
    repeatedRun: compareRuns(reference, repeat),
    autotune: { budget: tuned.budget, seed: tuned.seed, evaluated: tuned.evaluated, elapsedMs, summary: tuned.summary, candidates: tuned.candidates.map(c => ({ controller: c.controller, verdict: c.run.verdict, metrics: c.run.metrics })) }
  });
}
const report = { generatedAt: new Date().toISOString(), engineVersion: ENGINE_VERSION,
  scope: '本机计算案例评测；没有调用真实模型 API，没有进行学生试用。自动整定初始种子包含同案例参考控制器。',
  allReferencesPass: results.every(item => item.reference.verdict === 'pass'),
  allFinerSamplesPass: results.every(item => item.finerSampling.verdict === 'pass'),
  allReproductionsPass: results.every(item => item.repeatedRun.pass), cases: results };
await fs.mkdir(new URL('../evidence/', import.meta.url), { recursive: true });
await fs.writeFile(new URL('../evidence/computational-evaluation.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ allReferencesPass: report.allReferencesPass, allFinerSamplesPass: report.allFinerSamplesPass, allReproductionsPass: report.allReproductionsPass,
  cases: results.map(item => ({ id: item.caseId, default: item.initial.verdict, reference: item.reference.verdict, tuningPass: item.autotune.candidates.some(c => c.verdict === 'pass'), elapsedMs: Math.round(item.autotune.elapsedMs) })) }, null, 2));
if (!report.allReferencesPass || !report.allFinerSamplesPass || !report.allReproductionsPass) process.exitCode = 1;

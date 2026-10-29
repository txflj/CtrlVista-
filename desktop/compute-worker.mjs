import { parentPort, workerData } from 'node:worker_threads';
import { simulate, autotune, compareRuns } from '../src/core/index.mjs';
try {
  const { method, config, options, original } = workerData;
  let result;
  if (method === 'simulate') result = simulate(config, options);
  else if (method === 'autotune') result = autotune(config, options);
  else if (method === 'reproduce') {
    const run = simulate(original.config, { configVersion: original.configVersion });
    result = { run, comparison: compareRuns(original, run) };
  } else throw new Error('未知计算任务。');
  parentPort.postMessage({ ok: true, result });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error.message || '计算任务失败。' });
}

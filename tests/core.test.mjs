import test from 'node:test';
import assert from 'node:assert/strict';
import { CASES, createCaseConfig, validateConfig, simulate, autotune, compareRuns, conditionKey } from '../src/core/index.mjs';
import { Matrix, expm } from '../src/core/numerics.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} within ${tolerance}`);
function firstOrder() {
  const config = createCaseConfig('motor');
  config.plant.denominator = [1, 1];
  config.controller = { type: 'P', kp: 4, ki: 0, kd: 0, tf: 0.05 };
  config.simulation = { duration: 5, dt: 0.01, initialState: [], integralInitial: 0, filterInitial: 0 };
  return config;
}
function assertFiniteJson(value) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value));
  else if (Array.isArray(value)) value.forEach(assertFiniteJson);
  else if (value && typeof value === 'object') Object.values(value).forEach(assertFiniteJson);
}

test('Padé matrix exponential matches diagonal and non-diagonal Jordan analytic results', () => {
  const diagonal = expm(new Matrix([[-30, 0], [0, 2]]));
  close(diagonal.get(0, 0), Math.exp(-30), 1e-20);
  close(diagonal.get(1, 1), Math.exp(2), 1e-12);
  assert.deepEqual(expm(new Matrix([[0, 1], [0, 0]])).to2DArray(), [[1, 1], [0, 1]]);
  const jordan = expm(new Matrix([[-2, 1], [0, -2]]));
  close(jordan.get(0, 0), Math.exp(-2), 1e-14);
  close(jordan.get(0, 1), Math.exp(-2), 1e-14);
});

test('P first-order curve and theoretical steady error match analytic equations, without artificial zero poles', () => {
  const run = simulate(firstOrder());
  assert.equal(run.status, 'completed');
  assert.equal(run.poles.length, 1);
  close(run.poles[0].real, -5);
  run.curves.t.forEach((t, i) => {
    close(run.curves.y[i], 0.8 * (1 - Math.exp(-5 * t)));
    close(run.curves.u[i], 4 * (1 - run.curves.y[i]));
  });
  close(run.metrics.steadyError, 0.2);
  assert.equal(run.verdict, 'fail');
  assertFiniteJson(run);
});

test('PI cancellation reference matches analytic y=1-exp(-4t), settling and output peak', () => {
  const config = createCaseConfig('motor');
  config.controller = { ...CASES[0].referenceController };
  const run = simulate(config);
  assert.equal(run.status, 'completed');
  assert.equal(run.poles.length, 2);
  run.curves.t.forEach((t, i) => close(run.curves.y[i], 1 - Math.exp(-4 * t)));
  close(run.metrics.settlingTime, Math.ceil(Math.log(50) / 4 / 0.01) * 0.01);
  close(run.metrics.controlPeak, 2);
  close(run.metrics.steadyError, 0);
});

test('second-order underdamped curve and target overshoot match analytic response', () => {
  const config = firstOrder();
  config.plant = { numerator: [9], denominator: [1, 0.4, 1] };
  config.controller.kp = 1;
  config.simulation.duration = 20;
  config.simulation.dt = 0.002;
  const run = simulate(config), wd = Math.sqrt(10 - 0.04);
  assert.equal(run.status, 'completed');
  run.curves.t.forEach((t, i) => close(run.curves.y[i], 0.9 * (1 - Math.exp(-0.2 * t) * (Math.cos(wd * t) + 0.2 / wd * Math.sin(wd * t))), 1e-9));
  const expectedPeak = 0.9 * (1 + Math.exp(-0.2 * Math.PI / wd));
  close(run.metrics.overshoot, (expectedPeak - 1) * 100, 0.001);
  close(run.metrics.steadyError, 0.1);
});

test('nonzero plant initial state is preserved in canonical state coordinates', () => {
  const config = firstOrder();
  config.simulation.initialState = [0.3];
  const run = simulate(config);
  close(run.curves.y[0], 0.3);
  run.curves.t.forEach((t, i) => close(run.curves.y[i], 0.8 + (0.3 - 0.8) * Math.exp(-5 * t)));
});

test('PI integral initial value affects the initial action and dynamics', () => {
  const config = firstOrder();
  config.controller = { type: 'PI', kp: 1, ki: 1, kd: 0, tf: 0.05 };
  config.simulation.integralInitial = 0.4;
  const run = simulate(config);
  close(run.curves.u[0], 1.4);
  // A repeated pole at -1: y=1+(-1+0.4t)e^-t.
  run.curves.t.forEach((t, i) => close(run.curves.y[i], 1 + (-1 + 0.4 * t) * Math.exp(-t), 1e-9));
});

test('PID derivative acts on measurement, has no reference kick, and omits unused integral state', () => {
  const config = firstOrder();
  config.controller = { type: 'PID', kp: 4, ki: 0, kd: 2, tf: 0.1 };
  const run = simulate(config);
  assert.equal(run.status, 'completed');
  assert.equal(run.poles.length, 2);
  close(run.curves.u[0], 4);
  config.simulation.filterInitial = 0.2;
  close(simulate(config).curves.u[0], 8);
  config.controller.kd = 0;
  assert.equal(simulate(config).poles.length, 1);
  config.controller.type = 'PI';
  assert.equal(simulate(config).poles.length, 1);
});

test('non-grid reference step and finite input disturbance are integrated at exact event times', () => {
  const config = firstOrder();
  config.signal.stepTime = 0.235;
  config.simulation.dt = 0.1;
  config.disturbance = { enabled: true, time: 0.35, amplitude: 0.7, duration: 0.17 };
  const run = simulate(config);
  assert.equal(run.status, 'completed');
  const response = (t, event, amplitude) => t < event ? 0 : amplitude / 5 * (1 - Math.exp(-5 * (t - event)));
  run.curves.t.forEach((t, i) => close(run.curves.y[i], response(t, 0.235, 4) + response(t, 0.35, 0.7) - response(t, 0.52, 0.7), 1e-10));
  for (const time of [0.235, 0.35, 0.52]) assert.ok(run.curves.t.some(t => Math.abs(t - time) < 1e-12));
  close(run.curves.d[run.curves.t.findIndex(t => Math.abs(t - 0.35) < 1e-12)], 0.7);
  close(run.curves.d[run.curves.t.findIndex(t => Math.abs(t - 0.52) < 1e-12)], 0);
  close(run.metrics.steadyError, 0.2);
});

test('reference initial value is an input, not an implicit steady-state plant initial condition', () => {
  const config = firstOrder();
  config.signal = { initial: 0.4, target: 1, stepTime: 0.235 };
  const run = simulate(config);
  run.curves.t.forEach((t, i) => {
    const expected = 0.32 * (1 - Math.exp(-5 * t)) + (t >= 0.235 ? 0.48 * (1 - Math.exp(-5 * (t - 0.235))) : 0);
    close(run.curves.y[i], expected);
  });
});

test('stable third-order object can produce unstable feedback and is rejected before trajectories', () => {
  const config = firstOrder();
  config.plant = { numerator: [1], denominator: [1, 3, 3, 1] };
  config.controller.kp = 100;
  config.bounds.kp = [0, 100];
  assert.equal(validateConfig(config).valid, true);
  const run = simulate(config);
  assert.equal(run.status, 'unstable');
  assert.equal(run.verdict, 'fail');
  assert.equal(run.curves.t.length, 0);
  assertFiniteJson(run);
});

test('invalid objects, unsupported transfer functions, bounds and time grids return invalid rather than throwing', () => {
  const inputs = [null, undefined, {}, [], 'x'];
  const changes = [
    c => c.plant.denominator = [1, -1],
    c => c.plant.denominator = [1, 0],
    c => c.plant.denominator = [1, 2, 3, 4, 5],
    c => c.plant.numerator = [1, 1],
    c => c.plant.numerator = [-1],
    c => c.controller.kp = 31,
    c => c.controller.ki = NaN,
    c => c.simulation.dt = 0,
    c => c.simulation.dt = 0.00001,
    c => c.simulation.initialState = [0, 0],
    c => c.signal.stepTime = c.simulation.duration,
    c => c.goals.holdTime = 0,
    c => c.goals.referenceScale = 0,
    c => { c.goals.relativeTolerance = 1e308; c.goals.referenceScale = 1e308; },
    c => c.disturbance.duration = -1,
    c => c.bounds.kp = [10, 2],
  ];
  for (const change of changes) { const config = firstOrder(); change(config); inputs.push(config); }
  for (const input of inputs) {
    assert.equal(validateConfig(input).valid, false);
    const run = simulate(input);
    assert.equal(run.status, 'invalid', JSON.stringify(input));
    assert.equal(run.verdict, 'unknown');
    assertFiniteJson(run);
  }
});

test('extreme coefficient scales stop as a numerical error with finite JSON values', () => {
  const config = firstOrder();
  config.plant = { numerator: [1e8], denominator: [1e-12, 1e8] };
  config.controller.kp = 1e5;
  config.bounds.kp = [0, 1e5];
  const run = simulate(config);
  assert.equal(run.status, 'numerical_error');
  assert.equal(run.verdict, 'unknown');
  assert.equal(run.curves.t.length, 0);
  assertFiniteJson(run);
});

test('zero target change has undefined percent overshoot, while its absolute error remains meaningful', () => {
  const config = firstOrder();
  config.signal.target = 0;
  const run = simulate(config);
  assert.equal(run.metrics.overshoot, null);
  close(run.metrics.steadyError, 0);
  close(run.metrics.settlingTime, 0);
  assert.equal(run.verdict, 'unknown');
  assertFiniteJson(run);
  config.goals.overshootMax = null;
  assert.equal(simulate(config).verdict, 'pass');
});

test('short observation remains unknown rather than falsely treating last sample as steady state', () => {
  const config = createCaseConfig('motor');
  config.controller = { type: 'PI', kp: 2, ki: 4, kd: 0, tf: 0.05 };
  config.simulation.duration = 0.5;
  config.goals.holdTime = 0.2;
  const run = simulate(config);
  assert.equal(run.verdict, 'unknown');
  assert.equal(run.metrics.settlingTime, null);
  close(run.metrics.steadyError, 0);
  assert.ok(run.metrics.tailError > 0.1);
  config.goals.settlingTimeMax = 0.1;
  assert.equal(simulate(config).verdict, 'fail');
});

test('control budget checks untruncated action and includes pre-event left limit', () => {
  const config = firstOrder();
  config.goals.controlPeakMax = 3;
  let run = simulate(config);
  close(run.metrics.controlPeak, 4);
  close(run.curves.u[0], 4);
  assert.equal(run.checks.find(c => c.key === 'controlPeak').state, 'fail');
  config.signal = { initial: 1, target: -1, stepTime: 0.5 };
  run = simulate(config);
  const actionAtStep = 4 * (-1 - 0.8 * (1 - Math.exp(-2.5)));
  close(run.metrics.controlPeak, Math.abs(actionAtStep));
});

test('negative reference step produces a finite direction-aware target overshoot', () => {
  const config = createCaseConfig('position');
  config.signal.target = -1;
  const negative = simulate(config);
  config.signal.target = 1;
  const positive = simulate(config);
  close(negative.metrics.overshoot, positive.metrics.overshoot);
  close(negative.metrics.controlPeak, positive.metrics.controlPeak);
});

test('persistent disturbance equilibrium differs from last sample and pulse final equilibrium uses post-pulse input', () => {
  const config = firstOrder();
  config.disturbance = { enabled: true, time: 4.9, amplitude: 0.5, duration: null };
  let run = simulate(config);
  close(run.metrics.finalValue, 0.9);
  close(run.metrics.steadyError, 0.1);
  assert.ok(Math.abs(run.metrics.tailError - run.metrics.steadyError) > 0.01);
  config.disturbance.duration = 5;
  run = simulate(config);
  close(run.metrics.finalValue, 0.8);
});

test('all documented default reference controllers actually pass the common simulation pipeline', () => {
  for (const item of CASES) {
    const config = createCaseConfig(item.id);
    config.controller = copy(item.referenceController);
    const run = simulate(config);
    assert.equal(run.status, 'completed', `${item.id}: ${run.reason}`);
    assert.equal(run.verdict, 'pass', `${item.id}: ${run.reason}`);
    assert.ok(run.curves.t.length > 100);
    assertFiniteJson(run);
    if (item.id === 'temperature') {
      config.goals.recoveryTimeMax = 18.45;
      assert.equal(simulate(config).checks.find(check => check.key === 'recoveryTime').state, 'pass');
    }
  }
  const a = createCaseConfig('motor'), b = createCaseConfig('motor');
  a.plant.denominator[0] = 123;
  assert.equal(b.plant.denominator[0], 0.5);
  assert.throws(() => createCaseConfig('missing'), /未知实验/);
});

test('autotune is budget limited, deterministic by seed, transparent and does not mutate config', () => {
  const config = createCaseConfig('position'), snapshot = copy(config);
  const a = autotune(config, { budget: 24, seed: 123, configVersion: 7 });
  const b = autotune(config, { budget: 24, seed: 123, configVersion: 7 });
  assert.deepEqual(config, snapshot);
  assert.equal(a.evaluated, 24);
  assert.equal(a.budget, 24);
  assert.ok(a.candidates.length > 0 && a.candidates.length <= 3);
  assert.deepEqual(a.candidates.map(c => [c.controller, c.score]), b.candidates.map(c => [c.controller, c.score]));
  assert.ok(a.candidates.every(c => c.run.configVersion === 7));
  a.candidates.forEach((candidate, i) => assert.equal(compareRuns(candidate.run, b.candidates[i].run).pass, true));
  assert.equal(a.candidates[0].run.verdict, 'pass');
});

test('autotune handles no feasible tested candidate and fixed parameter ranges without claiming impossibility', () => {
  const config = firstOrder();
  config.bounds = { kp: [4, 4], ki: [0, 0], kd: [0, 0] };
  const result = autotune(config, { budget: 10, seed: 0 });
  assert.equal(result.evaluated, 1);
  assert.equal(result.candidates[0].run.verdict, 'fail');
  assert.match(result.summary, /不代表数学上不存在/);
  assert.equal(autotune({}, { budget: 2 }).evaluated, 0);
});

test('condition key excludes controller and presentation but includes evaluation and initial conditions', () => {
  const config = firstOrder(), edited = copy(config);
  edited.controller.kp = 2; edited.title = '另一个标题';
  assert.equal(conditionKey(config), conditionKey(edited));
  edited.goals.controlPeakMax = 50;
  assert.notEqual(conditionKey(config), conditionKey(edited));
  const reordered = Object.fromEntries(Object.entries(config).reverse());
  assert.equal(conditionKey(config), conditionKey(reordered));
});

test('JSON-exported run reproduces; metric/curve/config tampering and incomplete records do not pass', () => {
  const original = copy(simulate(firstOrder(), { configVersion: 4 }));
  const reproduced = simulate(original.config, { configVersion: 4 });
  assert.equal(compareRuns(original, reproduced).pass, true);
  const curveChanged = copy(original); curveChanged.curves.y[30] += 0.01;
  assert.equal(compareRuns(curveChanged, reproduced).pass, false);
  const metricChanged = copy(original); metricChanged.metrics.steadyError += 0.1;
  assert.equal(compareRuns(metricChanged, reproduced).pass, false);
  const configChanged = copy(original); configChanged.config.goals.controlPeakMax += 1;
  assert.equal(compareRuns(configChanged, reproduced).pass, false);
  assert.equal(compareRuns({}, {}).pass, false);
  assert.equal(compareRuns(null, reproduced).pass, false);
});

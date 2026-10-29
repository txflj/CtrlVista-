import { Matrix, EigenvalueDecomposition, solve } from 'ml-matrix';

export { Matrix, solve };

export function polesOf(matrix) {
  const e = new EigenvalueDecomposition(matrix);
  return e.realEigenvalues.map((real, i) => ({ real, imaginary: e.imaginaryEigenvalues[i] }));
}

export function isStrictlyStable(poles) {
  return poles.every(p => Number.isFinite(p.real) && Number.isFinite(p.imaginary) && p.real < -1e-10);
}

function lincomb(terms) {
  const out = Matrix.zeros(terms[0][1].rows, terms[0][1].columns);
  for (const [coefficient, matrix] of terms) out.add(Matrix.mul(matrix, coefficient));
  return out;
}

// Scaling and squaring with the order-13 Padé approximant (Higham 2005).
// Matrix.exp from ml-matrix is elementwise and must NOT be used here.
export function expm(input) {
  if (input.rows !== input.columns) throw new Error('矩阵指数需要方阵');
  const n = input.rows;
  let norm = 0;
  for (let j = 0; j < n; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.abs(input.get(i, j));
    norm = Math.max(norm, sum);
  }
  if (!Number.isFinite(norm)) throw new Error('矩阵包含无效数值');
  const scaling = Math.max(0, Math.ceil(Math.log2(norm / 5.371920351148152)));
  if (scaling > 60) throw new Error('矩阵尺度超过当前数值计算范围');
  const a = Matrix.div(input, 2 ** scaling);
  const i = Matrix.eye(n), a2 = a.mmul(a), a4 = a2.mmul(a2), a6 = a4.mmul(a2);
  const b = [64764752532480000, 32382376266240000, 7771770303897600,
    1187353796428800, 129060195264000, 10559470521600, 670442572800,
    33522128640, 1323241920, 40840800, 960960, 16380, 182, 1];
  const u = a.mmul(a6.mmul(lincomb([[b[13], a6], [b[11], a4], [b[9], a2]]))
    .add(lincomb([[b[7], a6], [b[5], a4], [b[3], a2], [b[1], i]])));
  const v = a6.mmul(lincomb([[b[12], a6], [b[10], a4], [b[8], a2]]))
    .add(lincomb([[b[6], a6], [b[4], a4], [b[2], a2], [b[0], i]]));
  let result = solve(Matrix.sub(v, u), Matrix.add(v, u));
  for (let s = 0; s < scaling; s++) result = result.mmul(result);
  if (!result.to1DArray().every(Number.isFinite)) throw new Error('矩阵指数未得到有限结果');
  return result;
}

export function plantStateSpace(plant) {
  const den = plant.denominator.map(v => v / plant.denominator[0]);
  let num = [...plant.numerator];
  while (num.length > 1 && num[0] === 0) num.shift();
  num = num.map(v => v / plant.denominator[0]);
  const n = den.length - 1;
  const a = Matrix.zeros(n, n), b = Array(n).fill(0);
  for (let j = 0; j < n - 1; j++) a.set(j, j + 1, 1);
  for (let j = 0; j < n; j++) a.set(n - 1, j, -den[n - j]);
  b[n - 1] = 1;
  const padded = [...Array(n - num.length).fill(0), ...num];
  const c = padded.reverse();
  return { a, b, c, n };
}

export function closedLoop(config) {
  const { a: plantA, b, c, n } = plantStateSpace(config.plant);
  const control = config.controller;
  const ki = control.type !== 'P' ? control.ki : 0;
  const kd = control.type === 'PID' ? control.kd : 0;
  const integralIndex = ki > 0 ? n : -1;
  const filterIndex = kd > 0 ? n + (integralIndex >= 0 ? 1 : 0) : -1;
  const size = n + (integralIndex >= 0 ? 1 : 0) + (filterIndex >= 0 ? 1 : 0);
  const a = Matrix.zeros(size, size);
  const br = Array(size).fill(0), bd = Array(size).fill(0);
  const measurementGain = control.kp + (kd > 0 ? kd / control.tf : 0);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) a.set(row, col, plantA.get(row, col) - b[row] * measurementGain * c[col]);
    if (integralIndex >= 0) a.set(row, integralIndex, b[row] * ki);
    if (filterIndex >= 0) a.set(row, filterIndex, b[row] * kd / control.tf);
    br[row] = b[row] * control.kp;
    bd[row] = b[row];
  }
  if (integralIndex >= 0) {
    for (let j = 0; j < n; j++) a.set(integralIndex, j, -c[j]);
    br[integralIndex] = 1;
  }
  if (filterIndex >= 0) {
    for (let j = 0; j < n; j++) a.set(filterIndex, j, c[j] / control.tf);
    a.set(filterIndex, filterIndex, -1 / control.tf);
  }
  const initial = Array(size).fill(0);
  for (let j = 0; j < n; j++) initial[j] = config.simulation.initialState[j] ?? 0;
  if (integralIndex >= 0) initial[integralIndex] = config.simulation.integralInitial;
  if (filterIndex >= 0) initial[filterIndex] = config.simulation.filterInitial;
  const output = state => c.reduce((s, coefficient, j) => s + coefficient * state[j], 0);
  const action = (state, reference) => {
    const y = output(state);
    return control.kp * (reference - y) + (integralIndex >= 0 ? ki * state[integralIndex] : 0)
      - (filterIndex >= 0 ? kd * (y - state[filterIndex]) / control.tf : 0);
  };
  return { a, br, bd, initial, output, action, size };
}

export function transition(system, dt) {
  const { a, br, bd, size } = system;
  const aug = Matrix.zeros(size + 2, size + 2);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) aug.set(i, j, a.get(i, j) * dt);
    aug.set(i, size, br[i] * dt);
    aug.set(i, size + 1, bd[i] * dt);
  }
  const out = expm(aug).to2DArray();
  return (state, reference, disturbance) => out.slice(0, size).map(row =>
    state.reduce((sum, value, j) => sum + row[j] * value, row[size] * reference + row[size + 1] * disturbance));
}

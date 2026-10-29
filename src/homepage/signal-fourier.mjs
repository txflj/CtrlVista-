// Standalone, deterministic teaching signals. These are not control-lab run data.
// Every reported component is recovered from sampled data by the DFT below.
const SAMPLE_COUNT = 256;
const DURATION = 2;
const TAU = 2 * Math.PI;
const CASE_IDS = ['motor', 'position', 'temperature', 'challenge'];
const SIGNALS = [
  [
    { frequency: 1, amplitude: 1, phase: 0.35 },
    { frequency: 3, amplitude: 0.45, phase: -0.6 },
    { frequency: 7, amplitude: 0.2, phase: 1.1 },
  ],
  [
    { frequency: 0.5, amplitude: 0.9, phase: -0.45 },
    { frequency: 2, amplitude: 0.4, phase: 0.8 },
    { frequency: 5, amplitude: 0.25, phase: -1.2 },
  ],
  [
    { frequency: 1, amplitude: 0.85, phase: 0.7 },
    { frequency: 2.5, amplitude: 0.35, phase: -0.9 },
    { frequency: 4, amplitude: 0.15, phase: 1.4 },
  ],
  [
    { frequency: 1.5, amplitude: 1, phase: -0.3 },
    { frequency: 4, amplitude: 0.5, phase: 1.2 },
    { frequency: 8, amplitude: 0.3, phase: -1.5 },
  ],
];
const cache = new Map();

function resolveCaseIndex(value) {
  if (typeof value === 'string') {
    const index = CASE_IDS.indexOf(value);
    if (index !== -1) return index;
    throw new RangeError(`Unknown Fourier demonstration case: ${value}`);
  }
  if (typeof value !== 'number') {
    throw new TypeError('Fourier demonstration case must be an index or case id.');
  }
  if (!Number.isInteger(value) || value < 0 || value >= CASE_IDS.length) {
    throw new RangeError('Fourier demonstration case index must be an integer from 0 to 3.');
  }
  return value;
}

function singleSidedDft(samples, sampleRate) {
  const count = samples.length;
  const spectrum = [];
  for (let bin = 0; bin <= count / 2; bin += 1) {
    let real = 0;
    let imaginary = 0;
    for (let n = 0; n < count; n += 1) {
      const angle = TAU * bin * n / count;
      real += samples[n] * Math.cos(angle);
      imaginary -= samples[n] * Math.sin(angle);
    }
    // Only interior bins have a distinct negative-frequency partner.
    const scale = bin === 0 || bin === count / 2 ? 1 / count : 2 / count;
    const amplitude = Math.hypot(real, imaginary) * scale;
    // DFT phase is cosine-based; expose sine phase to match the teaching formula.
    const sinePhase = Math.atan2(imaginary, real) + Math.PI / 2;
    const phase = amplitude < 1e-12 ? 0 : Math.atan2(Math.sin(sinePhase), Math.cos(sinePhase));
    spectrum.push(Object.freeze({ frequency: bin * sampleRate / count, amplitude, phase }));
  }
  return Object.freeze(spectrum);
}

/**
 * Create an independent Fourier teaching demonstration, cached once per case.
 *
 * All waveforms share t[n] = n / sampleRate, covering [0, duration). The repeated
 * endpoint is deliberately excluded. The two-second window contains whole
 * periods of each source tone, so a rectangular-window DFT has no leakage.
 *
 * components are the three strongest non-DC DFT bins, sorted by frequency, and
 * use amplitude * sin(2 * PI * frequency * t + phase), with phase in radians.
 * Their parameters and reconstruction come from the DFT, never the source list.
 * The result and nested arrays are frozen so animation code cannot corrupt cache.
 *
 * @param {number|string} [caseIndexOrId=0] 0..3 or a control-lab case id.
 * @returns {object} Shared immutable demo data; no control simulation is run.
 */
export function createFourierDemo(caseIndexOrId = 0) {
  const caseIndex = resolveCaseIndex(caseIndexOrId);
  if (cache.has(caseIndex)) return cache.get(caseIndex);

  const sampleRate = SAMPLE_COUNT / DURATION;
  const t = Object.freeze(Array.from({ length: SAMPLE_COUNT }, (_, n) => n / sampleRate));
  const composite = Object.freeze(t.map(time => SIGNALS[caseIndex].reduce(
    (sum, tone) => sum + tone.amplitude * Math.sin(TAU * tone.frequency * time + tone.phase),
    0,
  )));
  const spectrum = singleSidedDft(composite, sampleRate);
  const peaks = spectrum.slice(1, -1)
    .sort((left, right) => right.amplitude - left.amplitude)
    .slice(0, 3)
    .sort((left, right) => left.frequency - right.frequency);
  const components = Object.freeze(peaks.map(peak => Object.freeze({
    ...peak,
    waveform: Object.freeze(t.map(time => peak.amplitude * Math.sin(TAU * peak.frequency * time + peak.phase))),
  })));
  const reconstruction = Object.freeze(t.map((_, n) => components.reduce(
    (sum, component) => sum + component.waveform[n],
    0,
  )));
  const residual = composite.map((sample, n) => sample - reconstruction[n]);
  const error = Object.freeze({
    maxAbsolute: Math.max(...residual.map(Math.abs)),
    rms: Math.sqrt(residual.reduce((sum, value) => sum + value * value, 0) / SAMPLE_COUNT),
  });
  const demo = Object.freeze({
    caseId: CASE_IDS[caseIndex],
    kind: 'fourier-demonstration',
    label: '独立合成信号的傅里叶演示，非控制实验数据',
    sampleCount: SAMPLE_COUNT,
    duration: DURATION,
    sampleRate,
    frequencyResolution: 1 / DURATION,
    phaseConvention: 'sine',
    t,
    composite,
    spectrum,
    components,
    reconstruction,
    error,
  });
  cache.set(caseIndex, demo);
  return demo;
}

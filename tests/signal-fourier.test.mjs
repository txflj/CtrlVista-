import test from 'node:test';
import assert from 'node:assert/strict';
import { createFourierDemo } from '../src/homepage/signal-fourier.mjs';

const close = (actual, expected, tolerance = 1e-12) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
};

const fixtures = [
  { id: 'motor', tones: [[1, 1, 0.35], [3, 0.45, -0.6], [7, 0.2, 1.1]] },
  { id: 'position', tones: [[0.5, 0.9, -0.45], [2, 0.4, 0.8], [5, 0.25, -1.2]] },
  { id: 'temperature', tones: [[1, 0.85, 0.7], [2.5, 0.35, -0.9], [4, 0.15, 1.4]] },
  { id: 'challenge', tones: [[1.5, 1, -0.3], [4, 0.5, 1.2], [8, 0.3, -1.5]] },
];

test('DFT recovers known frequencies, single-sided amplitudes and signed nonzero sine phases', () => {
  for (const fixture of fixtures) {
    const demo = createFourierDemo(fixture.id);
    assert.equal(demo.components.length, 3);
    fixture.tones.forEach(([frequency, amplitude, phase], index) => {
      const component = demo.components[index];
      close(component.frequency, frequency);
      close(component.amplitude, amplitude);
      close(component.phase, phase);
      const bin = demo.spectrum.find(point => point.frequency === frequency);
      assert.equal(component.amplitude, bin.amplitude);
      assert.equal(component.phase, bin.phase);
    });
    const remainingBins = demo.spectrum.filter(bin => !fixture.tones.some(tone => tone[0] === bin.frequency));
    assert.ok(Math.max(...remainingBins.map(bin => bin.amplitude)) < 1e-12);
  }
});

test('DFT values agree with a separate complex projection of the sampled signal', () => {
  const demo = createFourierDemo('motor');
  for (const { frequency, amplitude, phase } of demo.spectrum) {
    const real = demo.t.reduce((sum, time, n) => sum + demo.composite[n] * Math.cos(2 * Math.PI * frequency * time), 0);
    const imaginary = demo.t.reduce((sum, time, n) => sum - demo.composite[n] * Math.sin(2 * Math.PI * frequency * time), 0);
    const scale = frequency === 0 || frequency === demo.sampleRate / 2 ? 1 : 2;
    close(amplitude, scale * Math.hypot(real, imaginary) / demo.sampleCount);
    if (amplitude > 1e-10) {
      close(amplitude * Math.sin(phase), scale * real / demo.sampleCount);
      close(-amplitude * Math.cos(phase), scale * imaginary / demo.sampleCount);
    }
  }
});

test('three recovered tones reconstruct every sample and report actual reconstruction error', () => {
  for (const fixture of fixtures) {
    const demo = createFourierDemo(fixture.id);
    const residual = [];
    demo.t.forEach((time, n) => {
      const expected = fixture.tones.reduce((sum, [frequency, amplitude, phase]) => (
        sum + amplitude * Math.sin(2 * Math.PI * frequency * time + phase)
      ), 0);
      close(demo.composite[n], expected);
      const recovered = demo.components.reduce((sum, component) => {
        close(component.waveform[n], component.amplitude * Math.sin(2 * Math.PI * component.frequency * time + component.phase));
        return sum + component.waveform[n];
      }, 0);
      close(demo.reconstruction[n], recovered);
      residual.push(demo.composite[n] - demo.reconstruction[n]);
    });
    close(demo.error.maxAbsolute, Math.max(...residual.map(Math.abs)), 1e-20);
    close(demo.error.rms, Math.sqrt(residual.reduce((sum, value) => sum + value ** 2, 0) / demo.sampleCount), 1e-20);
    assert.ok(demo.error.maxAbsolute < 1e-12);
    assert.ok(demo.error.rms < 1e-12);
  }
});

test('all waveforms use the same uniform half-open time axis and independent demo labels', () => {
  for (const fixture of fixtures) {
    const demo = createFourierDemo(fixture.id);
    assert.equal(demo.kind, 'fourier-demonstration');
    assert.match(demo.label, /非控制实验数据/);
    assert.equal(demo.phaseConvention, 'sine');
    assert.equal(demo.sampleCount, 256);
    assert.equal(demo.duration, 2);
    assert.equal(demo.sampleRate, 128);
    assert.equal(demo.frequencyResolution, 0.5);
    for (const series of [demo.t, demo.composite, demo.reconstruction, ...demo.components.map(component => component.waveform)]) {
      assert.equal(series.length, demo.sampleCount);
      assert.ok(series.every(Number.isFinite));
    }
    demo.t.forEach((time, n) => close(time, n / demo.sampleRate));
    assert.ok(demo.t.at(-1) < demo.duration);
    assert.equal(demo.spectrum.length, demo.sampleCount / 2 + 1);
    assert.equal(demo.spectrum[0].frequency, 0);
    assert.equal(demo.spectrum.at(-1).frequency, demo.sampleRate / 2);
  }
});

test('cache shares frozen data across case aliases and fresh generation is deterministic', async () => {
  const { createFourierDemo: regenerate } = await import('../src/homepage/signal-fourier.mjs?determinism-test');
  assert.equal(createFourierDemo(), createFourierDemo(0));
  fixtures.forEach((fixture, index) => {
    const demo = createFourierDemo(index);
    assert.equal(demo, createFourierDemo(fixture.id));
    assert.deepEqual(demo, regenerate(index));
    assert.ok(Object.isFrozen(demo));
    for (const series of [demo.t, demo.composite, demo.reconstruction, demo.components, demo.spectrum]) {
      assert.ok(Object.isFrozen(series));
    }
    assert.ok(Object.isFrozen(demo.components[0]));
    assert.ok(Object.isFrozen(demo.components[0].waveform));
    assert.ok(Object.isFrozen(demo.spectrum[0]));
    assert.ok(Object.isFrozen(demo.error));
    assert.throws(() => { demo.composite[0] = 100; }, TypeError);
    assert.throws(() => { demo.components[0].amplitude = 100; }, TypeError);
  });
  assert.notDeepEqual(createFourierDemo(0).composite, createFourierDemo(1).composite);
});

test('unsupported cases fail explicitly instead of silently displaying a different signal', () => {
  for (const value of [-1, 4, 0.5, NaN, Infinity, '', '0', 'unknown']) {
    assert.throws(() => createFourierDemo(value), RangeError);
  }
  for (const value of [null, {}, [], true, 1n]) {
    assert.throws(() => createFourierDemo(value), TypeError);
  }
});

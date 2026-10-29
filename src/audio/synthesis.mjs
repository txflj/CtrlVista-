// Adapted from RhineLabUI src/audio.ts at 12cc5e4013acb9408f753ff71de6b8492299b7c8.
// Copyright (c) 2026 LBEILC. MIT; see third-party/RhineLabUI/LICENSE.
// The original sampled typing branch has been replaced with procedural synthesis.
const noiseBuffers = new WeakMap();
export const rampLevel = (
  param,
  value,
  now,
  seconds = 0.05,
) => {
  if (typeof param.cancelAndHoldAtTime === "function") {
    param.cancelAndHoldAtTime(now);
  } else {
    const held = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(held, now);
  }
  param.linearRampToValueAtTime(value, now + seconds);
};
/** Shared by live playback and OfflineAudioContext verification. */
export function synthesizeSound(
  c,
  destination,
  type,
  at,
  pan = 0,
) {
  const output = c.createGain(),
    stereo = c.createStereoPanner();
  stereo.pan.value = Math.max(-0.65, Math.min(0.65, pan));
  output.connect(stereo);
  stereo.connect(destination);
  const sources = [];
  let remaining = 0,
    end = at;
  const connect = (
    source,
    node,
    gain,
    delay,
    duration,
    attack = 0.006,
  ) => {
    const env = c.createGain(),
      start = at + delay;
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(
      gain,
      start + Math.min(attack, duration * 0.3),
    );
    env.gain.exponentialRampToValueAtTime(0.00001, start + duration);
    env.gain.linearRampToValueAtTime(0, start + duration + 0.012);
    node.connect(env);
    env.connect(output);
    sources.push(source);
    remaining++;
    source.onended = () => {
      source.disconnect();
      node.disconnect();
      env.disconnect();
      if (--remaining === 0) {
        output.disconnect();
        stereo.disconnect();
      }
    };
    source.start(start);
    source.stop(start + duration + 0.015);
    end = Math.max(end, start + duration + 0.015);
  };
  const tone = (
    f,
    to,
    gain,
    duration,
    delay = 0,
    attack = 0.006,
  ) => {
    const osc = c.createOscillator();
    osc.frequency.setValueAtTime(f, at + delay);
    osc.frequency.exponentialRampToValueAtTime(to, at + delay + duration);
    connect(osc, osc, gain, delay, duration, attack);
  };
  const air = (
    f,
    to,
    gain,
    duration,
    delay = 0,
    attack = 0.008,
  ) => {
    let buffer = noiseBuffers.get(c);
    if (!buffer) {
      buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const data = buffer.getChannelData(0);
      let seed = 773;
      for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[i] = seed / 2147483648 - 1;
      }
      noiseBuffers.set(c, buffer);
    }
    const src = c.createBufferSource(),
      filter = c.createBiquadFilter();
    src.buffer = buffer;
    filter.type = "bandpass";
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(f, at + delay);
    filter.frequency.exponentialRampToValueAtTime(to, at + delay + duration);
    src.connect(filter);
    connect(src, filter, gain, delay, duration, attack);
  };
  // A thin glass plate: a fast contact transient excites unequal modes.
  // Upper modes fade first, leaving a small, clear body instead of a long bell.
  const glass = (
    fundamental,
    gain,
    decay,
    delay = 0,
  ) => {
    const modes = [
      [1, 1, 1],
      [1.47, 0.39, 0.66],
      [2.09, 0.21, 0.4],
      [2.73, 0.095, 0.25],
      [3.86, 0.035, 0.15],
    ];
    for (const [ratio, amplitude, damping] of modes) {
      const frequency = fundamental * ratio;
      if (frequency > Math.min(8500, c.sampleRate * 0.42)) continue;
      tone(
        frequency,
        frequency,
        gain * amplitude,
        decay * damping,
        delay,
        0.0012,
      );
    }
    air(4800, 3600, gain * 0.24, 0.013, delay, 0.0008);
  };
  switch (type) {
    case "page-open":
      air(700, 1800, 0.065, 0.18, 0, 0.025);
      tone(360, 480, 0.032, 0.16, 0, 0.014);
      tone(960, 960, 0.009, 0.075, 0.06, 0.01);
      break;
    case "page-close":
      air(1300, 600, 0.05, 0.13, 0, 0.014);
      tone(420, 280, 0.027, 0.13, 0, 0.01);
      break;
    case "ui-tick":
      air(1500, 1200, 0.042, 0.036, 0, 0.003);
      tone(820, 820, 0.022, 0.052, 0, 0.003);
      break;
    case "brand":
      tone(146.83, 146.83, 0.039, 0.72, 0, 0.08);
      tone(293.66, 293.66, 0.03, 0.62, 0.07, 0.07);
      tone(440, 440, 0.022, 0.54, 0.17, 0.055);
      air(420, 1750, 0.036, 0.7, 0, 0.13);
      break;
    case "text-reveal":
      air(2100, 1300, 0.033, 0.064, 0, 0.005);
      tone(1050, 1050, 0.012, 0.06, 0, 0.005);
      break;
    case "key": {
      // Original synthesized key tick; no recordings, sample banks or film audio.
      air(3100, 1900, 0.023, 0.021, 0, 0.001);
      tone(1250, 740, 0.009, 0.026, 0, 0.001);
      break;
    }
    case "tick":
      glass(1680, 0.064, 0.24);
      break;
    case "column":
      glass(1280, 0.065, 0.32);
      glass(2050, 0.016, 0.18, 0.045);
      break;
    case "open":
      glass(1150, 0.071, 0.58);
      glass(2180, 0.025, 0.36, 0.16);
      air(3100, 4400, 0.014, 0.25, 0.035, 0.025);
      break;
    case "confirm":
      tone(640, 640, 0.039, 0.095, 0, 0.008);
      tone(960, 960, 0.026, 0.15, 0.095, 0.009);
      break;
    case "back":
      glass(1120, 0.066, 0.22);
      tone(560, 560, 0.012, 0.1, 0.025, 0.002);
      break;
    case "scan":
      air(1800, 3400, 0.025, 0.8, 0, 0.12);
      for (let i = 0; i < 4; i++)
        tone(760, 760, 0.025, 0.064, i * 0.19 + 0.15, 0.007);
      break;
    case "welcome":
      [293.66, 440, 659.25, 739.99].forEach((f, i) =>
        tone(f, f, 0.034, 1.6, i * 0.095, 0.05),
      );
      air(600, 1800, 0.065, 0.9, 0, 0.15);
      break;
    case "array":
      air(1600, 3300, 0.025, 0.8, 0, 0.12);
      for (let i = 0; i < 5; i++)
        glass(1180 + i * 170, 0.043 - i * 0.005, 0.31, 0.05 + i * 0.105);
      break;
    case "inspect":
      tone(1120, 1120, 0.026, 0.055, 0, 0.005);
      tone(1120, 1120, 0.018, 0.055, 0.11, 0.005);
      break;
    case "explode":
      [1220, 1680, 2260].forEach((f, i) =>
        glass(f, 0.054 - i * 0.01, 0.4 - i * 0.055, i * 0.115),
      );
      break;
    case "assemble":
      [2260, 1680, 1220].forEach((f, i) =>
        glass(f, 0.035 + i * 0.008, 0.2, i * 0.095),
      );
      break;
  }
  return {
    end,
    stop(now) {
      rampLevel(output.gain, 0, now, 0.018);
      for (const source of sources) {
        try {
          source.stop(now + 0.02);
        } catch {
          /* already ended */
        }
      }
    },
  };
}

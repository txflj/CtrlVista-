import test from 'node:test';
import assert from 'node:assert/strict';
import { GlobalAudio, MUSIC_LOOP_SECONDS } from '../src/audio/global-audio.mjs';
import { AUDIO_PREFERENCES_KEY, DEFAULT_AUDIO_PREFERENCES, isAudioPreferencePatch, isSound, readAudioPreferences } from '../src/audio/preferences.mjs';

function memoryStorage(initial) {
  const values = new Map(initial ? [[AUDIO_PREFERENCES_KEY, initial]] : []);
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}
class Parameter {
  value = 0;
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
  cancelAndHoldAtTime() {}
}
class AudioNode {
  gain = new Parameter(); frequency = new Parameter(); pan = new Parameter(); Q = new Parameter();
  threshold = new Parameter(); knee = new Parameter(); ratio = new Parameter(); attack = new Parameter(); release = new Parameter();
  fftSize = 2048;
  startCalls = []; stopCalls = [];
  connect() {} disconnect() {}
  start(...args) { this.startCalls.push(args); }
  stop(...args) { this.stopCalls.push(args); }
  getFloatTimeDomainData(values) { values.fill(0); }
}
class AudioContextFake {
  state = 'running'; currentTime = 12; sampleRate = 48000; destination = new AudioNode(); sources = []; closed = false;
  createGain() { return new AudioNode(); }
  createDynamicsCompressor() { return new AudioNode(); }
  createAnalyser() { return new AudioNode(); }
  createStereoPanner() { return new AudioNode(); }
  createBiquadFilter() { return new AudioNode(); }
  createOscillator() { return new AudioNode(); }
  createBufferSource() { const node = new AudioNode(); this.sources.push(node); return node; }
  createBuffer(channels, length, rate) { return { duration: length / rate, getChannelData: () => new Float32Array(length) }; }
  async decodeAudioData() { return { duration: MUSIC_LOOP_SECONDS }; }
  async resume() { this.state = 'running'; }
  async close() { this.closed = true; this.state = 'closed'; }
}
const response = () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
const settle = () => new Promise(resolve => setImmediate(resolve));

test('audio preferences reject malformed frame messages and preserve explicit mute', () => {
  for (const value of [null, [], {}, { enabled: 'false' }, { musicVolume: Infinity }, { soundVolume: -1 }, { musicVolume: 1.1 }, { enabled: true, apiKey: 'x' }]) assert.equal(isAudioPreferencePatch(value), false);
  assert.equal(isAudioPreferencePatch({ enabled: false, musicVolume: 0 }), true);
  assert.equal(isSound('key'), true); assert.equal(isSound('typing-samples'), false);
  const values = readAudioPreferences(memoryStorage(JSON.stringify({ enabled: false, music: false, typing: false, musicVolume: 0.13, soundVolume: 'broken', extra: 'ignored' })));
  assert.deepEqual(values, { ...DEFAULT_AUDIO_PREFERENCES, enabled: false, music: false, typing: false, musicVolume: 0.13 });
  assert.deepEqual(readAudioPreferences(memoryStorage('{')), DEFAULT_AUDIO_PREFERENCES);
});

test('one looping transport survives repeated starts, settings and elapsed loops', async () => {
  const c = new AudioContextFake(), storage = memoryStorage(); let fetches = 0, contexts = 0;
  const audio = new GlobalAudio({ storage, createContext: () => { contexts++; return c; }, fetcher: async () => { fetches++; return response(); } });
  audio.start(); audio.start(); audio.start(); await settle();
  assert.equal(contexts, 1); assert.equal(fetches, 3); assert.equal(audio.musicStartCount, 1);
  const sources = [...audio.tracks], start = audio.musicStartedAt;
  assert.equal(sources.length, 3);
  for (const source of sources) { assert.equal(source.loop, true); assert.equal(source.loopEnd, MUSIC_LOOP_SECONDS); assert.deepEqual(source.startCalls, [[start, 0]]); }
  c.currentTime = start + MUSIC_LOOP_SECONDS * 2 + 7;
  audio.configure({ musicVolume: 0.4 }); audio.start();
  audio.configure({ enabled: false }); assert.equal(audio.master.gain.value, 0); assert.equal(audio.status, 'muted');
  audio.configure({ enabled: true }); audio.configure({ music: false });
  assert.equal(audio.musicBus.gain.value, 0);
  audio.configure({ music: true });
  assert.equal(audio.musicStartCount, 1); assert.deepEqual(audio.tracks, sources);
  assert.equal(audio.getState().completedLoops, 2); assert.ok(Math.abs(audio.getState().playbackPosition - 7) < 1e-8);
  assert.equal(sources.every(source => source.stopCalls.length === 0), true);
  audio.configure({ enabled: false });
  assert.equal(readAudioPreferences(storage).enabled, false);
  audio.dispose(); assert.equal(c.closed, true); assert.equal(sources.every(source => source.stopCalls.length === 1), true);
});

test('late music decoding cannot bypass a mute or create duplicate sources', async () => {
  const c = new AudioContextFake(), resolves = [];
  const audio = new GlobalAudio({ storage: memoryStorage(), createContext: () => c, fetcher: () => new Promise(resolve => resolves.push(resolve)) });
  audio.start(); audio.configure({ enabled: false });
  resolves.forEach(resolve => resolve(response())); await settle();
  assert.equal(audio.tracks.length, 0); assert.equal(audio.getState().status, 'muted');
  audio.configure({ enabled: true }); audio.start();
  assert.equal(audio.musicStartCount, 1); assert.equal(audio.tracks.length, 3);
  audio.dispose();
});

test('typing can be disabled independently and repeated sound events are throttled', async () => {
  const c = new AudioContextFake();
  const audio = new GlobalAudio({ storage: memoryStorage(), createContext: () => c, fetcher: async () => response() });
  audio.start(); await settle();
  audio.play('key'); audio.play('key'); assert.equal(audio.playedKeys, 1);
  c.currentTime += 0.06; audio.play('key'); assert.equal(audio.playedKeys, 2);
  audio.configure({ typing: false }); c.currentTime += 1; audio.play('key'); assert.equal(audio.playedKeys, 2);
  audio.play('confirm'); assert.equal(audio.effectCount, 3);
  audio.configure({ sound: false }); c.currentTime += 1; audio.play('confirm'); assert.equal(audio.effectCount, 3);
  assert.equal(audio.musicStartCount, 1); audio.dispose();
});

test('failed local music never disables effects and disposed loads cannot restart playback', async () => {
  const c = new AudioContextFake();
  const audio = new GlobalAudio({ storage: memoryStorage(), createContext: () => c, fetcher: async () => { throw new Error('missing local file'); } });
  audio.start(); await settle(); assert.equal(audio.status, 'unavailable');
  audio.play('confirm'); assert.equal(audio.effectCount, 1); await settle();
  audio.dispose();
  const resolves = [], late = new GlobalAudio({ storage: memoryStorage(), createContext: () => new AudioContextFake(), fetcher: () => new Promise(resolve => resolves.push(resolve)) });
  late.start(); late.dispose(); resolves.forEach(resolve => resolve(response())); await settle();
  assert.equal(late.musicStartCount, 0); assert.equal(late.tracks.length, 0);
});

test('welcome effects, gestures, settings and context events cannot start background music before the handoff', async () => {
  const c = new AudioContextFake(), storage = memoryStorage(); let fetches = 0;
  const audio = new GlobalAudio({ musicReady: false, storage, createContext: () => c, fetcher: async () => { fetches++; return response(); } });
  audio.start(); audio.play('confirm'); await settle();
  assert.equal(fetches, 3, 'local stems can be decoded ahead of the handoff');
  assert.equal(audio.effectCount, 1, 'welcome effects remain available');
  assert.equal(audio.getState().musicReady, false);
  assert.equal(audio.getState().status, 'ready');
  audio.start(); audio.startMusic(); c.onstatechange();
  audio.configure({ musicVolume: 0.5 }); audio.configure({ music: false }); audio.configure({ music: true });
  audio.configure({ enabled: false }); audio.configure({ enabled: true }); await settle();
  assert.equal(audio.tracks.length, 0);
  assert.equal(c.sources.filter(source => source.loop === true).length, 0);
  assert.equal(audio.musicStartedAt, null);
  assert.equal(audio.musicStartCount, 0);
  assert.equal(audio.musicBus.gain.value, 0);
  for (const invalid of ['true', 1, null, undefined, {}]) assert.equal(audio.setMusicReady(invalid), false);
  assert.equal(audio.getState().musicReady, false);
  audio.setMusicReady(true); audio.start(); c.onstatechange(); await settle();
  assert.equal(audio.tracks.length, 3); assert.equal(audio.musicStartCount, 1);
  assert.equal(audio.getState().status, 'playing');
  audio.dispose();
});

test('readiness is not a saved preference and repeated handoffs retain the same musical phase', async () => {
  const c = new AudioContextFake(), storage = memoryStorage(); let writes = 0;
  const save = storage.setItem;
  storage.setItem = (...args) => { writes++; save(...args); };
  const audio = new GlobalAudio({ musicReady: false, storage, createContext: () => c, fetcher: async () => response() });
  audio.start(); await settle();
  audio.setMusicReady(true);
  const tracks = [...audio.tracks], startedAt = audio.musicStartedAt;
  c.currentTime = startedAt + MUSIC_LOOP_SECONDS + 9;
  audio.setMusicReady(true); audio.start();
  assert.equal(audio.musicStartCount, 1); assert.equal(writes, 0);
  audio.setMusicReady(false);
  assert.equal(audio.musicBus.gain.value, 0);
  assert.equal(audio.getState().status, 'ready');
  audio.setMusicReady(true); audio.start();
  assert.deepEqual(audio.tracks, tracks); assert.equal(audio.musicStartedAt, startedAt);
  assert.equal(audio.musicStartCount, 1); assert.equal(writes, 0);
  assert.equal(audio.tracks.every(source => source.stopCalls.length === 0), true);
  assert.equal(audio.getState().completedLoops, 1);
  assert.ok(Math.abs(audio.getState().playbackPosition - 9) < 1e-8);
  assert.deepEqual(readAudioPreferences(storage), DEFAULT_AUDIO_PREFERENCES);
  audio.dispose();
});

test('opening the handoff gate respects saved global mute and saved music-only mute', async () => {
  let contexts = 0;
  const c = new AudioContextFake(), storage = memoryStorage(JSON.stringify({ ...DEFAULT_AUDIO_PREFERENCES, enabled: false }));
  const audio = new GlobalAudio({ musicReady: false, storage, createContext: () => { contexts++; return c; }, fetcher: async () => response() });
  audio.start(); audio.play('confirm'); audio.setMusicReady(true); await settle();
  assert.equal(contexts, 0); assert.equal(audio.musicStartCount, 0); assert.equal(audio.effectCount, 0);
  assert.equal(readAudioPreferences(storage).enabled, false);
  audio.configure({ enabled: true }); await settle();
  assert.equal(contexts, 1); assert.equal(audio.musicStartCount, 1);
  audio.dispose();

  const musicStorage = memoryStorage(JSON.stringify({ ...DEFAULT_AUDIO_PREFERENCES, music: false }));
  const effects = new GlobalAudio({ musicReady: false, storage: musicStorage, createContext: () => new AudioContextFake(), fetcher: async () => response() });
  effects.start(); effects.setMusicReady(true); effects.play('confirm'); await settle();
  assert.equal(effects.effectCount, 1); assert.equal(effects.musicStartCount, 0);
  assert.equal(readAudioPreferences(musicStorage).music, false);
  effects.dispose();
});

test('late decoding rechecks readiness, mute and disposal instead of starting from a stale opening event', async () => {
  const c = new AudioContextFake(), decode = [];
  c.decodeAudioData = () => new Promise(resolve => decode.push(resolve));
  const audio = new GlobalAudio({ musicReady: false, storage: memoryStorage(), createContext: () => c, fetcher: async () => response() });
  audio.start(); await settle();
  assert.equal(decode.length, 3);
  audio.setMusicReady(true); audio.setMusicReady(false);
  decode.forEach(resolve => resolve({ duration: MUSIC_LOOP_SECONDS })); await settle();
  assert.equal(audio.musicStartCount, 0); assert.equal(audio.tracks.length, 0);
  audio.configure({ enabled: false }); audio.setMusicReady(true); c.onstatechange(); await settle();
  assert.equal(audio.musicStartCount, 0);
  audio.configure({ enabled: true }); audio.setMusicReady(true); await settle();
  assert.equal(audio.musicStartCount, 1);
  audio.dispose(); assert.equal(audio.setMusicReady(false), false); assert.equal(audio.setMusicReady(true), false);
  assert.equal(audio.tracks.length, 0); assert.equal(audio.musicStartCount, 1);
});

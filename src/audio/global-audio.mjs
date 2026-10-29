import { isAudioPreferencePatch, isSound, readAudioPreferences, saveAudioPreferences } from './preferences.mjs';
import { rampLevel, synthesizeSound } from './synthesis.mjs';

export const MUSIC_LOOP_SECONDS = 160 / 3;
export const MUSIC_STEMS = Object.freeze(['atmosphere', 'motif', 'pulse']);
const MIX = [0.9, 0.72, 0.65];

// One instance belongs to the application shell, never to the home frame or a route.
// Route visibility does not suspend the context or recreate any music source.
export class GlobalAudio {
  constructor({ storage, createContext = () => new AudioContext(), fetcher = (...args) => fetch(...args), assetBase = './audio/', musicReady = true } = {}) {
    this.preferences = readAudioPreferences(storage);
    this.storage = storage;
    this.createContext = createContext;
    this.fetcher = fetcher;
    this.assetBase = assetBase;
    // Runtime startup state, never a saved audio preference. Effects may play
    // while the welcome and archive opening are waiting for their handoff.
    this.musicReady = musicReady === true;
    this.context = null;
    this.buffers = null;
    this.tracks = [];
    this.voices = [];
    this.lastSound = new Map();
    this.listeners = new Set();
    this.requests = new Set();
    this.disposed = false;
    this.saved = true;
    this.musicError = '';
    this.contextError = '';
    this.musicLoading = null;
    this.musicStartedAt = null;
    this.musicStartCount = 0;
    this.effectCount = 0;
    this.playedKeys = 0;
    this.status = 'idle';
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  snapshot() { return { preferences: { ...this.preferences }, status: this.status, saved: this.saved }; }
  publish(force = false) {
    if (this.disposed) return;
    const p = this.preferences;
    const next = !p.enabled || (!p.sound && !p.music) ? 'muted'
      : this.contextError || (this.musicReady && p.music && this.musicError) ? 'unavailable'
      : !this.context || this.context.state !== 'running' ? 'waiting'
      : this.musicReady && p.music && this.musicLoading ? 'loading'
      : this.musicReady && p.music && this.tracks.length ? 'playing' : 'ready';
    if (next !== this.status || force) {
      this.status = next;
      for (const listener of this.listeners) listener(this.snapshot());
    }
  }
  ensureContext() {
    if (this.context) return this.context;
    const c = this.context = this.createContext();
    this.master = c.createGain();
    this.effects = c.createGain();
    this.musicBus = c.createGain();
    this.limiter = c.createDynamicsCompressor();
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 2048;
    this.meter = new Float32Array(this.analyser.fftSize);
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 8;
    this.limiter.ratio.value = 6;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.18;
    this.effects.connect(this.master);
    this.musicBus.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(this.analyser);
    this.analyser.connect(c.destination);
    this.stemGains = MUSIC_STEMS.map((_, i) => {
      const gain = c.createGain(); gain.gain.value = MIX[i]; gain.connect(this.musicBus); return gain;
    });
    this.master.gain.value = this.preferences.enabled ? 0.8 : 0;
    this.effects.gain.value = this.preferences.sound ? this.preferences.soundVolume : 0;
    this.musicBus.gain.value = this.musicReady && this.preferences.music ? this.preferences.musicVolume : 0;
    c.onstatechange = () => { if (!this.disposed) { this.startMusic(); this.publish(); } };
    return c;
  }
  start() {
    if (this.disposed || !this.preferences.enabled || (!this.preferences.sound && !this.preferences.music)) { this.publish(); return; }
    try {
      const c = this.ensureContext();
      // Called on mount in Electron, and retried directly on a real gesture in browsers.
      // Do not await resume before decoding: gesture-gated browsers may leave it pending.
      if (c.state !== 'running') void c.resume().then(() => { this.startMusic(); this.publish(); }).catch(() => this.publish());
      if (this.preferences.music && !this.buffers && !this.musicLoading) void this.loadMusic();
      this.startMusic();
      this.publish();
    } catch (error) { this.contextError = String(error?.message || 'Audio unavailable'); this.publish(); }
  }
  async loadMusic() {
    if (this.disposed || this.musicLoading || this.buffers) return;
    this.musicError = '';
    this.musicLoading = Promise.all(MUSIC_STEMS.map(async name => {
      const controller = new AbortController(); this.requests.add(controller);
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await this.fetcher(`${this.assetBase}${name}.ogg`, { signal: controller.signal });
        if (!response.ok) throw new Error(`本地配乐 ${name} 载入失败（${response.status}）`);
        const bytes = await response.arrayBuffer();
        if (this.disposed) return null;
        return await this.context.decodeAudioData(bytes);
      } finally { clearTimeout(timeout); this.requests.delete(controller); }
    }));
    this.publish();
    try {
      const buffers = await this.musicLoading;
      if (!this.disposed && buffers.every(Boolean)) this.buffers = buffers;
    } catch (error) { if (!this.disposed) this.musicError = String(error?.message || '本地配乐无法载入'); }
    finally { this.musicLoading = null; if (!this.disposed) { this.startMusic(); this.publish(); } }
  }
  startMusic() {
    const c = this.context;
    if (this.disposed || !this.musicReady || !c || c.state !== 'running' || !this.buffers || this.tracks.length || !this.preferences.enabled || !this.preferences.music) return;
    this.musicStartedAt = c.currentTime + 0.04;
    this.loopDuration = Math.min(MUSIC_LOOP_SECONDS, ...this.buffers.map(buffer => buffer.duration));
    this.tracks = this.buffers.map((buffer, i) => {
      const source = c.createBufferSource();
      source.buffer = buffer; source.loop = true; source.loopStart = 0; source.loopEnd = this.loopDuration;
      source.connect(this.stemGains[i]); source.start(this.musicStartedAt, 0); return source;
    });
    this.musicStartCount++;
    this.musicBus.gain.cancelScheduledValues(c.currentTime);
    this.musicBus.gain.setValueAtTime(0, c.currentTime);
    this.musicBus.gain.linearRampToValueAtTime(this.preferences.musicVolume, c.currentTime + 0.8);
  }
  setMusicReady(ready) {
    if (this.disposed || typeof ready !== 'boolean') return false;
    if (this.musicReady === ready) return true;
    this.musicReady = ready;
    if (this.context) {
      rampLevel(this.musicBus.gain, ready && this.preferences.music ? this.preferences.musicVolume : 0, this.context.currentTime, 0.18);
    }
    // Once created, the transport is retained even if a caller temporarily
    // closes the gate. Reopening resumes its phase rather than creating tracks.
    if (ready) this.start();
    this.publish(true);
    return true;
  }
  configure(patch) {
    if (this.disposed || !isAudioPreferencePatch(patch)) return false;
    this.preferences = { ...this.preferences, ...patch };
    this.saved = saveAudioPreferences(this.storage, this.preferences);
    if (this.context) {
      const now = this.context.currentTime, p = this.preferences;
      rampLevel(this.master.gain, p.enabled ? 0.8 : 0, now, 0.05);
      rampLevel(this.effects.gain, p.sound ? p.soundVolume : 0, now, 0.05);
      rampLevel(this.musicBus.gain, this.musicReady && p.music ? p.musicVolume : 0, now, 0.12);
      if (!p.enabled || !p.sound) { this.voices.forEach(voice => voice.stop(now)); this.voices = []; }
    }
    // Muting changes gain only, so unmuting and route changes preserve musical phase.
    this.start(); this.publish(true); return true;
  }
  play(sound) {
    if (this.disposed || !isSound(sound) || !this.preferences.enabled || !this.preferences.sound || (sound === 'key' && !this.preferences.typing)) return;
    this.start();
    const c = this.context;
    if (!c || c.state !== 'running' || this.preferences.soundVolume === 0) return;
    const now = c.currentTime, interval = sound === 'key' ? 0.055 : sound === 'tick' || sound === 'column' ? 0.075 : 0.12;
    if (now - (this.lastSound.get(sound) ?? -Infinity) < interval) return;
    this.lastSound.set(sound, now);
    this.voices = this.voices.filter(voice => voice.end > now);
    if (this.voices.length >= 8) this.voices.shift().stop(now);
    this.voices.push(synthesizeSound(c, this.effects, sound, now + 0.004));
    this.effectCount++; if (sound === 'key') this.playedKeys++;
  }
  getState() {
    const c = this.context, elapsed = this.musicStartedAt === null ? 0 : Math.max(0, (c?.currentTime || 0) - this.musicStartedAt);
    let rms = 0, peak = 0;
    if (this.analyser && this.meter) {
      this.analyser.getFloatTimeDomainData(this.meter);
      for (const value of this.meter) { rms += value * value; peak = Math.max(peak, Math.abs(value)); }
      rms = Math.sqrt(rms / this.meter.length);
    }
    return { ...this.snapshot(), contextState: c?.state || 'not-created', currentTime: c?.currentTime || 0,
      musicReady: this.musicReady, musicStartCount: this.musicStartCount, sourceCount: this.tracks.length, musicStartedAt: this.musicStartedAt,
      loopDuration: this.loopDuration || MUSIC_LOOP_SECONDS, playbackPosition: elapsed % (this.loopDuration || MUSIC_LOOP_SECONDS),
      completedLoops: Math.floor(elapsed / (this.loopDuration || MUSIC_LOOP_SECONDS)), outputRms: rms, outputPeak: peak,
      effectCount: this.effectCount, playedKeys: this.playedKeys, error: this.musicError || this.contextError,
      muted: !this.preferences.enabled || (!this.preferences.sound && !this.preferences.music), disposed: this.disposed };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.requests.forEach(controller => controller.abort()); this.requests.clear();
    this.voices.forEach(voice => voice.stop(this.context.currentTime)); this.voices = [];
    this.tracks.forEach(track => { track.stop(); track.disconnect(); }); this.tracks = [];
    if (this.context) { this.context.onstatechange = null; void this.context.close().catch(() => {}); }
    this.listeners.clear();
  }
}

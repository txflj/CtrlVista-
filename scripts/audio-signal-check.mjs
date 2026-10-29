import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.KX_PLAYWRIGHT_PATH || 'playwright');
const server = await createServer({ root: process.cwd(), configFile: false, server: { host: '127.0.0.1', port: 5197, strictPort: true, watch: { ignored: ['**/release/**', '**/.test-data/**', '**/.cache/**'] } } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.KX_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const page = await browser.newPage();
  await page.route('**/audio-check.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated audio signal verification</title>' }));
  await page.goto('http://127.0.0.1:5197/audio-check.html');
  const result = await page.evaluate(async () => {
    const { synthesizeSound } = await import('/src/audio/synthesis.mjs');
    const { SOUNDS } = await import('/src/audio/preferences.mjs');
    const { MUSIC_STEMS, MUSIC_LOOP_SECONDS } = await import('/src/audio/global-audio.mjs');
    const metrics = data => {
      let sum = 0, peak = 0, nonfinite = false;
      for (const value of data) { sum += value * value; peak = Math.max(peak, Math.abs(value)); nonfinite ||= !Number.isFinite(value); }
      return { rms: Math.sqrt(sum / data.length), peak, nonfinite };
    };
    const sounds = [];
    for (const sound of SOUNDS) {
      const c = new OfflineAudioContext(2, 48000 * 3, 48000);
      synthesizeSound(c, c.destination, sound, 0.02);
      const rendered = await c.startRendering();
      sounds.push({ sound, ...metrics(rendered.getChannelData(0)) });
    }
    const decode = new OfflineAudioContext(2, 48000, 48000), music = [];
    const buffers = [];
    for (const name of MUSIC_STEMS) {
      const response = await fetch(`/audio/${name}.ogg`);
      if (!response.ok) throw new Error(name);
      const buffer = await decode.decodeAudioData(await response.arrayBuffer());
      buffers.push(buffer);
      music.push({ name, duration: buffer.duration, channels: buffer.numberOfChannels, ...metrics(buffer.getChannelData(0)) });
    }
    // Real browser decoding and a two-loop render expose missing files, silence,
    // clipping and incorrect loop boundaries without relying on a fake audio API.
    const c = new OfflineAudioContext(2, Math.ceil((MUSIC_LOOP_SECONDS * 2 + 0.1) * 48000), 48000);
    buffers.forEach((buffer, i) => {
      const source = c.createBufferSource(), gain = c.createGain();
      source.buffer = buffer; source.loop = true; source.loopEnd = MUSIC_LOOP_SECONDS;
      gain.gain.value = [0.9, 0.72, 0.65][i] * 0.22 * 0.8;
      source.connect(gain); gain.connect(c.destination); source.start(0);
    });
    const rendered = await c.startRendering(), data = rendered.getChannelData(0), boundary = Math.round(MUSIC_LOOP_SECONDS * 48000);
    return { sounds, music, mix: { ...metrics(data), loopBoundaryDelta: Math.abs(data[boundary] - data[boundary - 1]), duration: rendered.duration }, scope: '浏览器 OfflineAudioContext 信号生成、Ogg 解码与双循环渲染；不是人工听感评价。' };
  });
  assert.equal(result.sounds.length, 15);
  for (const item of [...result.sounds, ...result.music, result.mix]) { assert.equal(item.nonfinite, false); assert.ok(item.rms > 0.00001); assert.ok(item.peak < 1); }
  for (const item of result.music) { assert.equal(item.channels, 2); assert.ok(Math.abs(item.duration - 160 / 3) < 0.01); }
  assert.ok(result.mix.loopBoundaryDelta < 0.01);
  await fs.mkdir('evidence', { recursive: true });
  await fs.writeFile('evidence/audio-signal-check.json', JSON.stringify({ version: '2.2.0', verifiedAt: new Date().toISOString(), ...result }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, soundCount: result.sounds.length, music: result.music, mix: result.mix, scope: result.scope }, null, 2));
} finally { await browser?.close(); await server.close(); }

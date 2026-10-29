/** Array-only portion of RhineLabUI's choreography (MIT / LBEILC).
 * Historical scene time is original-reference time minus five seconds.
 * No logo, identity screen, PV artwork or original audio is used here.
 */
export const ARRAY_INTRO_START = 22;
export const ARRAY_INTRO_END = 26.56;
const smooth = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (10 + t * (-15 + 6 * t));
};

export class ArchiveIntro {
  phase = 'waiting';
  elapsed = 0;
  previous = null;

  start(now, reduced = false) {
    if (this.phase !== 'waiting') return;
    if (reduced) { this.finish(); return; }
    this.phase = 'running';
    this.previous = now;
  }

  resetClock() { this.previous = null; }

  advance(now, visible = true) {
    if (this.phase !== 'running') return null;
    if (!visible) { this.resetClock(); return null; }
    if (this.previous !== null) this.elapsed += Math.max(0, now - this.previous) / 1000;
    this.previous = now;
    if (this.elapsed >= ARRAY_INTRO_END - ARRAY_INTRO_START) {
      this.finish();
      return null;
    }
    const time = ARRAY_INTRO_START + this.elapsed;
    return {
      time,
      reveal: smooth((time - 22) / 0.4),
      lift: smooth((time - 26) / 1.8),
      zoom: 0,
      uiOpacity: smooth((this.elapsed - 3.1) / 1.2),
      captionOpacity: 1 - smooth((this.elapsed - 2.8) / 0.45),
      letters: Math.min(8, Math.floor(this.elapsed * 12)),
    };
  }

  finish() {
    this.phase = 'done';
    this.elapsed = ARRAY_INTRO_END - ARRAY_INTRO_START;
    this.previous = null;
  }
}

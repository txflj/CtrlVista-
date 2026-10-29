import { useCallback, useEffect, useRef, useState } from 'react';
import { GlobalAudio } from './global-audio.mjs';
import { readAudioPreferences } from './preferences.mjs';
import { getColorThemeStorage } from '../app/color-theme.mjs';

export function useGlobalAudio({ musicReady = false } = {}) {
  const engine = useRef(null);
  const readiness = useRef(musicReady === true);
  readiness.current = musicReady === true;
  const [audio, setAudio] = useState(() => ({ preferences: readAudioPreferences(getColorThemeStorage()), status: 'idle', saved: true }));
  useEffect(() => {
    const player = new GlobalAudio({ storage: getColorThemeStorage(), musicReady: readiness.current }); engine.current = player;
    const unsubscribe = player.subscribe(setAudio);
    const unlock = () => player.start();
    const click = event => {
      const target = event.target?.closest?.('button, input[type="checkbox"], select');
      if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true' || target.closest('[data-audio-control]')) return;
      player.play(target.closest('[data-testid="feature-home"]') ? 'back' : 'ui-tick');
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    document.addEventListener('click', click, true);
    // Read-only diagnostics for audio continuity and packaged-release verification.
    const diagnostics = Object.freeze({ getState: () => player.getState() });
    window.__kxAudio = diagnostics;
    player.start(); setAudio(player.snapshot());
    return () => {
      unsubscribe(); document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true); document.removeEventListener('click', click, true);
      player.dispose(); engine.current = null;
      if (window.__kxAudio === diagnostics) delete window.__kxAudio;
    };
  }, []);
  useEffect(() => { engine.current?.setMusicReady(musicReady === true); }, [musicReady]);
  const configure = useCallback(patch => engine.current?.configure(patch), []);
  const play = useCallback(sound => engine.current?.play(sound), []);
  return { ...audio, configure, play };
}

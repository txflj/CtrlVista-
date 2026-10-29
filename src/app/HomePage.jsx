import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../ui/components.jsx';
import { isColorTheme } from './color-theme.mjs';
import { isAudioPreferencePatch, isSound } from '../audio/preferences.mjs';

const caseIds = new Set(['motor', 'position', 'temperature', 'challenge']);
const actions = new Set(['start-experiment', 'open-records', 'open-settings', 'open-library', 'open-verification', 'continue-experiment']);
const HOME_READY_TIMEOUT_MS = 30_000;

// Packaged file: pages have an opaque origin. Validate the exact frame window.
export function isHomeMessage(event, frameWindow) {
  if (!frameWindow || event.source !== frameWindow) return false;
  const data = event.data;
  if (!data || typeof data !== 'object' || data.source !== 'kongxiaozhu-home') return false;
  if (data.type === 'ready') return true;
  if (data.type === 'entry-complete') return true;
  if (data.type === 'color-theme') return isColorTheme(data.theme);
  if (data.type === 'audio-play') return isSound(data.sound);
  if (data.type === 'audio-settings') return isAudioPreferencePatch(data.patch);
  return actions.has(data.type) && (data.type !== 'start-experiment' || caseIds.has(data.caseId));
}

export default function HomePage({ visible, active, context, onAction, onEntryComplete, colorTheme, onColorTheme, audio }) {
  const iframe = useRef(null);
  const homeReady = useRef(false);
  const readyTimeout = useRef(null);
  const current = useRef({ active, visible, context, onAction, onEntryComplete, colorTheme, onColorTheme, audio });
  current.current = { active, visible, context, onAction, onEntryComplete, colorTheme, onColorTheme, audio };
  const [loadFailed, setLoadFailed] = useState(false);
  const [frameGeneration, setFrameGeneration] = useState(0);
  const clearReadyTimeout = useCallback(() => {
    if (readyTimeout.current !== null) clearTimeout(readyTimeout.current);
    readyTimeout.current = null;
  }, []);
  const watchReady = useCallback(() => {
    clearReadyTimeout();
    // Only wait while the homepage is usable; welcome, settings and hidden
    // windows must not consume its loading budget.
    if (homeReady.current || !current.current.active || !current.current.visible || document.hidden) return;
    readyTimeout.current = setTimeout(() => {
      readyTimeout.current = null;
      if (!homeReady.current && current.current.active && current.current.visible && !document.hidden) setLoadFailed(true);
    }, HOME_READY_TIMEOUT_MS);
  }, [clearReadyTimeout]);
  const retryHome = useCallback(() => {
    clearReadyTimeout();
    homeReady.current = false;
    setLoadFailed(false);
    // A new frame also rejects late ready messages from the previous attempt.
    setFrameGeneration(generation => generation + 1);
  }, [clearReadyTimeout]);
  const publishState = useCallback(() => {
    const target = iframe.current?.contentWindow;
    if (!target) return;
    target.postMessage({ source: 'kongxiaozhu-app', type: 'visibility', active: current.current.active }, '*');
    target.postMessage({ source: 'kongxiaozhu-app', type: 'context', ...current.current.context }, '*');
    target.postMessage({ source: 'kongxiaozhu-app', type: 'color-theme', theme: current.current.colorTheme }, '*');
    target.postMessage({ source: 'kongxiaozhu-app', type: 'audio-state', preferences: current.current.audio.preferences, status: current.current.audio.status, saved: current.current.audio.saved }, '*');
  }, []);
  useEffect(() => {
    function receive(event) {
      if (!isHomeMessage(event, iframe.current?.contentWindow)) return;
      if (event.data.type === 'ready') {
        homeReady.current = true;
        clearReadyTimeout();
        setLoadFailed(false);
        publishState();
        return;
      }
      if (!current.current.active || !current.current.visible) return;
      if (event.data.type === 'entry-complete') { current.current.onEntryComplete(); return; }
      if (event.data.type === 'color-theme') { current.current.onColorTheme(event.data.theme); return; }
      if (event.data.type === 'audio-play') { current.current.audio.play(event.data.sound); return; }
      if (event.data.type === 'audio-settings') { current.current.audio.configure(event.data.patch); return; }
      current.current.onAction({ type: event.data.type, caseId: event.data.caseId });
    }
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [publishState, clearReadyTimeout]);
  useEffect(() => {
    watchReady();
    document.addEventListener('visibilitychange', watchReady);
    return () => {
      clearReadyTimeout();
      document.removeEventListener('visibilitychange', watchReady);
    };
  }, [active, visible, frameGeneration, watchReady, clearReadyTimeout]);
  useEffect(publishState, [active, context, colorTheme, publishState]);
  useEffect(() => {
    iframe.current?.contentWindow?.postMessage({ source: 'kongxiaozhu-app', type: 'audio-state', preferences: audio.preferences, status: audio.status, saved: audio.saved }, '*');
  }, [audio.preferences, audio.status, audio.saved]);
  return <main className="homepage-host" hidden={!visible} aria-label="控小助主页">
    <iframe key={frameGeneration} ref={iframe} src="./homepage.html" title="控小助实验档案主页" data-testid="homepage-frame" onLoad={() => { publishState(); watchReady(); }} onError={() => { clearReadyTimeout(); setLoadFailed(true); }} />
    {loadFailed && <div className="homepage-fallback" role="alert"><h1>主页暂时无法载入</h1><p>可以先打开实验库，继续使用本机实验功能。</p><Button kind="primary" onClick={() => onAction({ type: 'open-library' })}>打开实验库</Button><Button onClick={retryHome}>重试主页</Button></div>}
  </main>;
}

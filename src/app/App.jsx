import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { featureHomeEnabled, featureRegistry } from './featureRegistry.js';
import { Button, Empty, ErrorBoundary } from '../ui/components.jsx';
import Settings from '../ui/Settings.jsx';
import HomePage from './HomePage.jsx';
import { applyColorTheme, getColorThemeStorage, isColorTheme, readColorTheme, saveColorTheme } from './color-theme.mjs';
import './homepage-shell.css';
import { useGlobalAudio } from '../audio/useGlobalAudio.jsx';
import WelcomeScreen from './WelcomeScreen.jsx';
import BrandMark from '../ui/BrandMark.jsx';

const features = featureRegistry.map(feature => ({ ...feature, Component: lazy(feature.load) }));
function readReducedMotion() {
  try {
    const stored = JSON.parse(getColorThemeStorage()?.getItem('kx-home-settings-v1') || 'null');
    if (typeof stored?.reduced === 'boolean') return stored.reduced;
  } catch { /* A damaged preference cannot block the welcome or the workbench. */ }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function App() {
  const api = window.kongxiaozhu;
  const [welcomeComplete, setWelcomeComplete] = useState(false);
  const [homeEntryComplete, setHomeEntryComplete] = useState(!featureHomeEnabled);
  const [reducedMotion] = useState(readReducedMotion);
  const audio = useGlobalAudio({ musicReady: welcomeComplete && homeEntryComplete });
  const completeWelcome = useCallback(() => setWelcomeComplete(true), []);
  const completeHomeEntry = useCallback(() => setHomeEntryComplete(true), []);
  const [bootstrap, setBootstrap] = useState(null);
  const [colorTheme, setColorTheme] = useState(() => readColorTheme(getColorThemeStorage()));
  const [themeSaved, setThemeSaved] = useState(true);
  const changeColorTheme = useCallback(theme => {
    if (!isColorTheme(theme)) return;
    applyColorTheme(document.documentElement, theme);
    setThemeSaved(saveColorTheme(getColorThemeStorage(), theme));
    setColorTheme(theme);
  }, []);
  const [error, setError] = useState('');
  const [activeFeature, setActiveFeature] = useState(featureHomeEnabled ? 'home' : 'control-lab');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [requests, setRequests] = useState([]);
  const [labContext, setLabContext] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const [navigationError, setNavigationError] = useState('');
  const requestSequence = useRef(0);
  const leaveFeature = useRef(null);
  const leavingRef = useRef(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const registerLeave = useCallback(handler => { leaveFeature.current = handler; }, []);
  const onRequestComplete = useCallback(nonce => setRequests(values => values.filter(item => item.nonce !== nonce)), []);
  const onLabContext = useCallback(context => setLabContext(previous => {
    if (previous && Object.keys(context).every(key => previous[key] === context[key])) return previous;
    return context;
  }), []);
  const onHomeAction = useCallback(message => {
    if (message.type === 'open-settings') { setSettingsOpen(true); return; }
    if (leavingRef.current) return;
    setNavigationError('');
    setHomeEntryComplete(true);
    setRequests(values => [...values, { type: message.type, caseId: message.caseId, nonce: ++requestSequence.current }]);
    setActiveFeature('control-lab');
  }, []);
  const returnHome = useCallback(async () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    setNavigationError('');
    try {
      document.activeElement?.blur?.();
      await leaveFeature.current?.();
      setActiveFeature('home');
    } catch (reason) {
      setNavigationError(`实验尚未保存，仍保留在当前工作台。${reason.message || '请重试。'}`);
    } finally {
      leavingRef.current = false;
      setLeaving(false);
    }
  }, []);
  useEffect(() => {
    if (!api) { setError('未检测到桌面运行环境。请双击控小助程序打开；浏览器中的开发页面不会冒充本机存储或在线 AI。'); return; }
    api.getBootstrap().then(setBootstrap).catch(reason => setError(reason.message));
  }, [api]);
  if (error) return <div className="fatal-error"><BrandMark /><h1>控小助</h1><p role="alert">{error}</p><Button onClick={() => window.location.reload()}>重试</Button></div>;
  if (!bootstrap) return <div className="loading-screen"><BrandMark /><h1>正在打开控小助</h1><p>读取本机设置与实验记录…</p></div>;
  const isHome = activeFeature === 'home';
  const context = labContext || { experimentCount: bootstrap.experiments?.length || 0, currentExperimentTitle: '', currentExperimentId: null };
  return <ErrorBoundary><div className={`app-shell ${isHome ? 'app-shell-home' : 'app-shell-workspace'}`} inert={!welcomeComplete} aria-hidden={!welcomeComplete || undefined}>
    <header className="app-chrome" hidden={isHome}>
      <div className="app-brand"><BrandMark small /><strong>控小助</strong><span className="muted">本机控制实验</span></div>
      <div className="chrome-actions">{featureHomeEnabled && <Button onClick={returnHome} disabled={leaving || requests.length > 0} data-testid="feature-home">{leaving ? '正在保存…' : '返回主页'}</Button>}<Button onClick={openSettings} data-testid="open-settings">模型与设置</Button><span className="version">v{bootstrap.appVersion}</span></div>
    </header>
    {featureHomeEnabled && <HomePage visible={isHome} active={isHome && !settingsOpen && welcomeComplete} context={context} onAction={onHomeAction} onEntryComplete={completeHomeEntry} colorTheme={colorTheme} onColorTheme={changeColorTheme} audio={audio} />}
    {navigationError && !isHome && <div className="notice error shell-navigation-error" role="alert">{navigationError}</div>}
    {features.map(({ id, Component }) => <section key={id} hidden={activeFeature !== id} className="feature-host"><Suspense fallback={<Empty title="正在加载实验模块" />}><Component api={api} bootstrap={bootstrap} settings={bootstrap.settings} onSettings={openSettings} active={activeFeature === id} requests={requests} onRequestComplete={onRequestComplete} onContext={onLabContext} onRegisterLeave={registerLeave} /></Suspense></section>)}
    {settingsOpen && <Settings api={api} settings={bootstrap.settings} dataPath={bootstrap.dataPath} colorTheme={colorTheme} onColorTheme={changeColorTheme} themeSaved={themeSaved} audio={audio} onSaved={settings => setBootstrap(value => ({ ...value, settings }))} onClose={closeSettings} />}
  </div>{!welcomeComplete && <WelcomeScreen theme={colorTheme} reducedMotion={reducedMotion} onComplete={completeWelcome} onCue={audio.play} />}</ErrorBoundary>;
}

import React, { useEffect, useRef } from "react";
import {
  drawWelcomeFrame,
  WelcomeTimeline,
  WELCOME_SECONDS,
  WELCOME_FADE_SECONDS,
} from "./welcome-motion.mjs";
import "./welcome-screen.css";

export default function WelcomeScreen({
  theme = "light",
  reducedMotion = false,
  onComplete,
  onCue,
}) {
  const screen = useRef(null);
  const canvas = useRef(null);
  const skip = useRef(null);
  const handlers = useRef({ theme, reducedMotion, onComplete, onCue });
  const finishRef = useRef(null);
  const drawRef = useRef(null);
  const completionSent = useRef(false);
  handlers.current = { theme, reducedMotion, onComplete, onCue };

  useEffect(() => {
    const timeline = new WelcomeTimeline();
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let disposed = false;
    let notified = false;

    const complete = (reason) => {
      if (disposed || notified || completionSent.current) return;
      timeline.finish(reason);
      notified = true;
      completionSent.current = true;
      cancelAnimationFrame(frame);
      handlers.current.onComplete?.({ reason: timeline.reason || reason });
    };
    finishRef.current = complete;
    const draw = () =>
      drawWelcomeFrame(
        canvas.current,
        timeline.elapsed,
        handlers.current.theme,
      );
    drawRef.current = draw;
    const resize = () => {
      const target = canvas.current;
      if (!target || disposed) return;
      const bounds = target.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      target.width = Math.round(bounds.width * ratio);
      target.height = Math.round(bounds.height * ratio);
      draw();
    };
    const tick = (now) => {
      if (disposed || notified) return;
      const cues = timeline.advance(now, !document.hidden);
      if (!document.hidden) {
        draw();
        if (screen.current) {
          screen.current.dataset.phase = timeline.phase;
          screen.current.style.opacity = String(
            Math.max(
              0,
              1 -
                Math.max(0, timeline.elapsed - WELCOME_SECONDS) /
                  WELCOME_FADE_SECONDS,
            ),
          );
        }
        for (const name of cues) handlers.current.onCue?.(name);
      }
      if (timeline.phase === "done") complete(timeline.reason);
      else frame = requestAnimationFrame(tick);
    };
    const visibility = () => timeline.resetClock();
    const keydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        complete("skipped");
      } else if (event.key === "Tab") {
        event.preventDefault();
        skip.current?.focus({ preventScroll: true });
      }
    };
    const motionChanged = (event) => {
      if (event.matches) complete("reduced");
    };
    const diagnostics = Object.freeze({ getState: () => timeline.getState() });
    window.__kxWelcome = diagnostics;
    const observer = new ResizeObserver(resize);
    if (screen.current) observer.observe(screen.current);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("keydown", keydown, true);
    media.addEventListener("change", motionChanged);
    timeline.start(
      performance.now(),
      handlers.current.reducedMotion || media.matches,
    );
    resize();
    if (timeline.phase === "done") complete("reduced");
    else {
      skip.current?.focus({ preventScroll: true });
      frame = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("keydown", keydown, true);
      media.removeEventListener("change", motionChanged);
      finishRef.current = null;
      drawRef.current = null;
      if (window.__kxWelcome === diagnostics) delete window.__kxWelcome;
    };
  }, []);

  useEffect(() => {
    drawRef.current?.();
  }, [theme]);
  useEffect(() => {
    if (reducedMotion) finishRef.current?.("reduced");
  }, [reducedMotion]);

  return (
    <section
      ref={screen}
      className="welcome-screen"
      data-theme={theme}
      data-testid="welcome-screen"
      role="dialog"
      aria-modal="true"
      aria-label="控小助欢迎"
    >
      <canvas
        ref={canvas}
        className="welcome-screen-canvas"
        role="img"
        aria-label="控小助欢迎动画：复合信号展开为频率分量，随后切换为阻尼响应示意，最终收束为收敛环图标与控小助名称。品牌动画不代表当前实验结果。"
      />
      <button
        ref={skip}
        className="welcome-screen-skip"
        data-testid="skip-welcome"
        data-audio-control
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.nativeEvent.stopImmediatePropagation();
          finishRef.current?.("skipped");
        }}
      >
        跳过欢迎 <kbd>ESC</kbd>
      </button>
    </section>
  );
}

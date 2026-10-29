// Adapted from the user-approved local logo-welcome-01 design.
// This is brand motion, not experimental data or a Fourier-control algorithm.
export const WELCOME_SECONDS = 8;
export const WELCOME_FADE_SECONDS = 0.32;
export const WELCOME_CUES = Object.freeze([
  Object.freeze({ at: 0.12, sound: "page-open" }),
  Object.freeze({ at: 1.45, sound: "text-reveal" }),
  Object.freeze({ at: 6.9, sound: "confirm" }),
]);

export class WelcomeTimeline {
  phase = "waiting";
  elapsed = 0;
  previous = null;
  reason = null;
  consumed = new Set();

  start(now, reduced = false) {
    if (this.phase !== "waiting") return;
    if (reduced) {
      this.finish("reduced");
      return;
    }
    this.phase = "running";
    this.previous = now;
  }

  resetClock() {
    this.previous = null;
  }

  advance(now, visible = true) {
    if (this.phase === "done" || this.phase === "waiting") return [];
    if (!visible) {
      this.resetClock();
      return [];
    }
    if (this.previous !== null)
      this.elapsed += Math.max(0, now - this.previous) / 1000;
    this.previous = now;
    const cues = [];
    for (const cue of WELCOME_CUES) {
      if (this.elapsed < cue.at || this.consumed.has(cue.at)) continue;
      this.consumed.add(cue.at);
      // Do not play a burst of missed cues after a blocked drawing frame.
      if (this.elapsed - cue.at <= 0.25) cues.push(cue.sound);
    }
    if (this.elapsed >= WELCOME_SECONDS + WELCOME_FADE_SECONDS)
      this.finish("completed");
    else if (this.elapsed >= WELCOME_SECONDS) this.phase = "fading";
    return cues;
  }

  finish(reason = "skipped") {
    if (this.phase === "done") return false;
    this.phase = "done";
    this.reason = reason;
    this.previous = null;
    return true;
  }

  getState() {
    return {
      phase: this.phase,
      elapsed: this.elapsed,
      progress: Math.min(1, this.elapsed / WELCOME_SECONDS),
      completed: this.phase === "done",
      reason: this.reason,
    };
  }
}

const ARC =
  "M218 107 C208 67 167 43 126 43 C73 43 32 76 32 125 C32 175 72 207 126 207 C169 207 207 185 218 158";
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (x) => {
  x = clamp(x);
  return x * x * (3 - 2 * x);
};
const lerp = (a, b, t) => a + (b - a) * t;

export function drawWelcomeFrame(canvas, time, theme = "light") {
  const ctx = canvas?.getContext("2d");
  if (!ctx || !canvas.width || !canvas.height) return false;
  const dark = theme === "dark";
  function stroke(points, color, width = 3, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = clamp(alpha);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach((p, i) =>
      i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]),
    );
    ctx.stroke();
    ctx.restore();
  }
  function label(
    text,
    x,
    y,
    size = 12,
    color = "#66717b",
    alpha = 1,
    align = "left",
    weight = 400,
  ) {
    ctx.save();
    ctx.globalAlpha = clamp(alpha);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.font = `${weight} ${size}px "Microsoft YaHei UI","Microsoft YaHei",sans-serif`;
    ctx.fillText(text, x, y);
    ctx.restore();
  }
  function line(x1, y1, x2, y2, c, alpha = 1, w = 1) {
    stroke(
      [
        [x1, y1],
        [x2, y2],
      ],
      c,
      w,
      alpha,
    );
  }
  function rounded(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }
  function part(u, i, phase = 0) {
    return (
      [65, 29, 13][i] *
      Math.sin(u * Math.PI * 2 * [2, 5, 11][i] + [0, 0.65, 1.1][i] + phase)
    );
  }
  function samples(fn, n = 350) {
    return Array.from({ length: n + 1 }, (_, i) => fn(i / n));
  }
  function response(u) {
    return -94 * Math.exp(-4.1 * u) * Math.sin(u * Math.PI * 7.5);
  }
  const curves = [
    [
      [34, 145],
      [65, 148],
      [68, 82],
      [89, 82],
    ],
    [
      [89, 82],
      [109, 82],
      [111, 152],
      [129, 152],
    ],
    [
      [129, 152],
      [145, 152],
      [148, 117],
      [161, 117],
    ],
    [
      [161, 117],
      [173, 117],
      [171, 136],
      [189, 136],
    ],
    [
      [189, 136],
      [194, 136],
      [199, 136],
      [204, 136],
    ],
  ];
  function glyphPoint(u) {
    const f = Math.min(u * 5, 4.999999),
      p = curves[Math.floor(f)],
      v = f % 1,
      w = 1 - v;
    return [0, 1].map(
      (k) =>
        w * w * w * p[0][k] +
        3 * w * w * v * p[1][k] +
        3 * w * v * v * p[2][k] +
        v * v * v * p[3][k],
    );
  }
  function draw(t) {
    const W = 1200,
      H = 630;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = dark ? "#17212e" : "#e8e5e1";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / W, canvas.height / H);
    ctx.setTransform(
      scale,
      0,
      0,
      scale,
      (canvas.width - W * scale) / 2,
      (canvas.height - H * scale) / 2,
    );
    const ink = dark ? "#f0ede5" : "#172b40",
      muted = dark ? "#91a4b7" : "#7c8589",
      blue = dark ? "#96b8e4" : "#4c7099",
      grid = dark ? "#3b5164" : "#cbd0cd";
    const end = ease((t - 5.1) / 0.65);
    label("控小助  /  AI CONTROL LAB", 44, 44, 12, muted, 1 - end);
    label("SIGNAL → RESPONSE", 1156, 44, 11, muted, 1 - end, "right");
    const plotAlpha = (1 - end) * 0.45;
    for (let x = 160; x <= 1040; x += 55)
      line(x, 170, x, 440, grid, plotAlpha * 0.35);
    for (let y = 170; y <= 440; y += 45)
      line(160, y, 1040, y, grid, plotAlpha * 0.35);
    const foot = ["捕捉变化", "解析信号", "观察收敛", "凝结为标志"][
      t < 1.4 ? 0 : t < 3.2 ? 1 : t < 5.4 ? 2 : 3
    ];
    label(foot, 600, 527, 17, ink, 1 - ease((t - 5.3) / 0.4), "center");
    if (t < 3.2) {
      const sep = ease((t - 1.4) / 1.05);
      const phase = Math.min(t, 1.4) * 0.35;
      const alpha = 1 - ease((t - 2.9) / 0.3);
      const composite = samples((u) => [
        160 + 880 * u,
        305 + part(u, 0, phase) + part(u, 1, phase) + part(u, 2, phase),
      ]);
      stroke(composite, ink, 3, alpha * (1 - sep));
      for (let i = 0; i < 3; i++) {
        const pts = samples((u) => [
          160 + 880 * u,
          lerp(
            305 + part(u, 0, phase) + part(u, 1, phase) + part(u, 2, phase),
            210 + i * 95 + part(u, i, phase) * 0.64,
            sep,
          ),
        ]);
        stroke(pts, [ink, blue, muted][i], 2.5, alpha * sep);
        line(160, 210 + i * 95, 1040, 210 + i * 95, grid, 0.5 * sep * alpha);
        label(
          ["f₁", "f₂", "f₃"][i],
          110,
          216 + i * 95,
          15,
          [ink, blue, muted][i],
          sep * alpha,
        );
      }
      label(
        t < 1.4 ? "三种正弦分量叠加" : "展开频率分量，保留信号的构成",
        600,
        560,
        12,
        muted,
        alpha,
        "center",
      );
    }
    if (t >= 3.2 && t < 5.4) {
      const q = (t - 3.2) / 2.2;
      const show = ease(q / 0.24);
      const points = samples((u) => [160 + 880 * u, 305 + response(u)]).slice(
        0,
        Math.max(2, Math.floor(351 * show)),
      );
      line(160, 305, 1040, 305, muted, 0.42);
      stroke(points, blue, 3.5);
      if (points.length) {
        let p = points.at(-1);
        ctx.beginPath();
        ctx.arc(...p, 4, 0, Math.PI * 2);
        ctx.fillStyle = blue;
        ctx.fill();
      }
      label("阻尼振荡示意", 1040, 290, 11, muted, show, "right");
      label(
        "调节之后，响应逐渐趋稳",
        600,
        560,
        12,
        muted,
        1 - ease((t - 5.15) / 0.25),
        "center",
      );
    }
    if (t >= 5.4) {
      const morph = ease((t - 5.4) / 0.85),
        identity = ease((t - 6.25) / 0.65),
        tile = ease((t - 6.4) / 0.55);
      const sz = lerp(256, 156, identity),
        ox = 600 - sz / 2,
        oy = lerp(181, 153, identity);
      ctx.save();
      ctx.globalAlpha = tile;
      rounded(ox, oy, sz, sz, sz * 0.19);
      ctx.fillStyle = "#172b40";
      ctx.fill();
      ctx.restore();
      const pts = samples((u) => {
        let p = glyphPoint(u);
        return [
          lerp(160 + 880 * u, ox + (p[0] / 256) * sz, morph),
          lerp(305 + response(u), oy + (p[1] / 256) * sz, morph),
        ];
      });
      stroke(
        pts,
        tile > 0.4 ? "#f3f0e8" : blue,
        lerp(3.5, (11 * sz) / 256, morph),
      );
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(sz / 256, sz / 256);
      ctx.globalAlpha = ease((t - 5.85) / 0.55);
      ctx.lineWidth = 11;
      ctx.strokeStyle = tile > 0.4 ? "#f3f0e8" : ink;
      ctx.lineCap = "round";
      ctx.setLineDash([575]);
      ctx.lineDashOffset = 575 * (1 - ease((t - 5.85) / 0.7));
      ctx.stroke(new Path2D(ARC));
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(224, 133, 9, 0, Math.PI * 2);
      ctx.fillStyle = dark || tile > 0.4 ? "#88a8d6" : "#4c7099";
      ctx.fill();
      ctx.restore();
      label("控小助", 600, 385, 46, ink, identity, "center", 500);
      label("AI CONTROL LAB", 600, 420, 12, muted, identity, "center");
      label(
        "控制实验工作台",
        600,
        470,
        17,
        ink,
        ease((t - 6.9) / 0.6),
        "center",
      );
      label(
        "观察 · 调节 · 验证",
        600,
        502,
        12,
        muted,
        ease((t - 7.2) / 0.5),
        "center",
      );
    }
  }
  draw(clamp(time, 0, WELCOME_SECONDS));
  return true;
}

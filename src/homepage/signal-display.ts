import * as THREE from "three";
import { createFourierDemo } from "./signal-fourier.mjs";
import { SIGNAL_SCREEN } from "./signal-cartridge";

const W = 1440, H = 804;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { const t = clamp(x); return t * t * (3 - 2 * t); };
const colors = ["#91bfff", "#7bd2ce", "#c3b7ed"];

/** A sampled, deterministic demonstration. Its traces come from DFT output, not PID results. */
export class SignalDisplay {
  readonly canvas = document.createElement("canvas");
  readonly texture: THREE.CanvasTexture;
  private lastKey = "";
  private demo = createFourierDemo("motor");
  private progress = 0;

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = true;
    this.update("motor", 0);
  }

  update(caseId: string, progress: number) {
    this.progress = clamp(progress);
    const p = Math.floor(clamp(progress) * 150) / 150;
    const key = `${caseId}:${p}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.demo = createFourierDemo(caseId);
    this.draw();
    this.texture.needsUpdate = true;
  }

  snapshotMaterial() {
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    canvas.getContext("2d")!.drawImage(this.canvas, 0, 0);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map, toneMapped: false, transparent: true, depthWrite: false });
  }

  stats() {
    return {
      caseId: this.demo.caseId, kind: this.demo.kind, progress: this.progress,
      sampleCount: this.demo.sampleCount, componentsCount: this.demo.components.length,
      finite: this.demo.composite.every(Number.isFinite) && this.demo.components.every(c => c.waveform.every(Number.isFinite)),
      reconstructionMaxError: this.demo.error.maxAbsolute,
      frequencies: this.demo.components.map(c => c.frequency),
      screenWidth: SIGNAL_SCREEN.width, screenHeight: SIGNAL_SCREEN.height,
      screenAreaRatio: SIGNAL_SCREEN.width * SIGNAL_SCREEN.height / (5.01039 * 3.7),
      geometrySource: "procedural-signal-cartridge",
    };
  }

  private draw() {
    const c = this.canvas.getContext("2d")!;
    const p = this.progress;
    const split = smooth((p - .2) / .62);
    c.fillStyle = "#0b1523"; c.fillRect(0, 0, W, H);
    c.strokeStyle = "#21334a"; c.lineWidth = 1;
    for (let x = 60; x <= W - 60; x += 60) { c.beginPath(); c.moveTo(x, 115); c.lineTo(x, 670); c.stroke(); }
    for (let y = 130; y < 680; y += 45) { c.beginPath(); c.moveTo(60, y); c.lineTo(W - 60, y); c.stroke(); }
    c.font = "500 28px 'Microsoft YaHei', sans-serif";
    c.fillStyle = "#e4edf9";
    c.fillText(p < .22 ? "复合信号" : p < .85 ? "傅里叶解析" : "频率分量", 60, 64);
    c.font = "20px 'Segoe UI', sans-serif";
    c.fillStyle = "#9baec7";
    c.textAlign = "right";
    c.fillText(p === 0 ? "SIGNAL / READY" : p < 1 ? `ANALYZING  ${Math.round(p * 100)}%` : "ANALYSIS COMPLETE", W - 60, 62);
    c.textAlign = "left";
    c.fillStyle = "#3b516c"; c.fillRect(60, 88, W - 120, 2);
    if (p > 0) { c.fillStyle = "#91bfff"; c.fillRect(60, 88, (W - 120) * p, 2); }

    const scale = 145 / Math.max(1, ...this.demo.composite.map(Math.abs));
    const trace = (values: readonly number[], baseline: number, gain: number, color: string, alpha: number) => {
      if (alpha <= .001) return;
      c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = 3.2;
      c.beginPath();
      values.forEach((value, i) => {
        const x = 66 + i / (values.length - 1) * (W - 132);
        const y = baseline - value * gain;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      });
      c.stroke(); c.globalAlpha = 1;
    };
    trace(this.demo.composite, 387, scale, "#a5ceff", 1 - split);
    this.demo.components.forEach((component, index) => {
      const y = 387 * (1 - split) + [218, 397, 576][index] * split;
      const values = component.waveform.map((v, i) => this.demo.composite[i] * (1 - split) + v * split);
      const gain = scale * (1 - split) + 61 / component.amplitude * split;
      trace(values, y, gain, colors[index], split);
      if (split > .02) {
        c.globalAlpha = split;
        c.fillStyle = "#0b1523"; c.fillRect(60, y - 100, 405, 35);
        c.fillStyle = colors[index]; c.font = "21px Consolas, monospace";
        c.fillText(`f${index + 1}  ${component.frequency.toFixed(1)} Hz   A ${component.amplitude.toFixed(2)}`, 66, y - 75);
        c.globalAlpha = 1;
      }
    });
    if (p > 0 && p < .85) {
      const x = 60 + (W - 120) * clamp(p / .85);
      c.fillStyle = "rgba(145,191,255,.055)"; c.fillRect(x - 20, 115, 20, 555);
      c.strokeStyle = "#607fa4"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, 115); c.lineTo(x, 670); c.stroke();
    }
    c.fillStyle = "#263b53"; c.fillRect(60, 704, W - 120, 1);
    c.font = "20px 'Microsoft YaHei', sans-serif"; c.fillStyle = "#9baec7";
    c.fillText("合成示意 · 各分量独立缩放", 60, 754);
    c.font = "19px Consolas, monospace"; c.textAlign = "right";
    c.fillText(p < .85 ? "x(t) = Σ A·sin(2πft + φ)" : `DFT  N=${this.demo.sampleCount}   Δf=${this.demo.frequencyResolution.toFixed(1)} Hz`, W - 60, 754);
    c.textAlign = "left";
  }
}

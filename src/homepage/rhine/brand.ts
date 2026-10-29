import { version } from "../../../package.json";
export const appVersion = version;
// Reuse the existing 控 word mark. This is not a replacement application icon.
const mark = `<rect x="23" y="11" width="122" height="122" rx="20" fill="none" stroke="currentColor" stroke-width="5"/><text x="84" y="99" text-anchor="middle" font-family="Microsoft YaHei,Segoe UI,sans-serif" font-size="85" font-weight="600" fill="currentColor">控</text>`;
export const labelMarkSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 168 145" color="#172235">${mark}</svg>`;
export const logo = `<svg viewBox="0 0 168 145" aria-label="控小助" role="img">${mark}</svg>`;
export const brandHeading = `<h1>控小助<span class="brand-version">${appVersion}</span></h1><div>AI CONTROL LAB</div><p>控制实验工作台</p>`;
// Compatibility export only; the desktop homepage does not run a boot sequence.
export const bootMarkContour = "M23 31Q23 11 43 11H125Q145 11 145 31V113Q145 133 125 133H43Q23 133 23 113Z";

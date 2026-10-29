/** Adapted from RhineLabUI, MIT / LBEILC. See third-party/RhineLabUI.
 * Scene modules preserve the original choreography; this controller supplies the
 * teaching content and the strictly bounded bridge to the desktop app.
 */
import "@kitlangton/rolling-number/styles.css";
import "./style.css";
import "./quality-settings.css";
import "./responsive.css";
import "./document-decryption.css";
import "./decryption.css";
import {
  createRollingNumber,
  createRollingText,
} from "@kitlangton/rolling-number";
import { appVersion } from "./brand";
import { ArchiveScene } from "./scene";
import { DocumentDecryption } from "./document-decryption";
import { ContentTransition, SurfaceTransition } from "./ui-transitions";
import { viewportLayout } from "./viewport-layout";
import {
  records,
  categories,
  archiveColumns,
  columnFiles,
  fileLocation,
} from "./data";
import { wrap, type ArchiveNavigation } from "./archive-loop";
import { fullMotion, reducedMotion } from "./motion-preferences";
import {
  qualityPresets,
  normalizeQuality,
  type QualityPreset,
} from "./render-quality";
import { paintTheme, themeSettingsMarkup } from "./theme-ui";
import { escapeHtml } from "./html";
import { brandHeading } from "./brand";
import { getColorThemeStorage, isColorTheme, readColorTheme, saveColorTheme } from "../../app/color-theme.mjs";
import { DEFAULT_AUDIO_PREFERENCES, AUDIO_STATUS_LABELS } from "../../audio/preferences.mjs";
import { ArchiveIntro } from "./archive-intro.mjs";
import "./kongxiaozhu.css";
import "./desktop-home.css";
import "./archive-intro.css";
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const send = (type: string, extra = {}) =>
  window.parent.postMessage(
    { source: "kongxiaozhu-home", type, ...extra },
    "*",
  );
// The persistent app shell owns all playback. This frame only describes cues.
let audioPreferences = { ...DEFAULT_AUDIO_PREFERENCES };
let audioStatus = "idle";
let audioSaved = true;
const soundTimes = new Map<string, number>();
function sound(name: string, interval = 80) {
  if (!active || document.hidden) return;
  const now = performance.now();
  if (now - (soundTimes.get(name) ?? -Infinity) < interval) return;
  soundTimes.set(name, now);
  send("audio-play", { sound: name });
}
const intro = new ArchiveIntro();
let introLetters = 0;
let previousDecryptionPhase = "waiting";
let lastRevealKey = -Infinity;
function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
const storedValue = read<unknown>("kx-home-settings-v1", {});
const stored: Record<string, unknown> =
  storedValue && typeof storedValue === "object" && !Array.isArray(storedValue)
    ? (storedValue as Record<string, unknown>)
    : {};
const prefs = {
  dark: readColorTheme(getColorThemeStorage()) === "dark",
  reduced:
    typeof stored.reduced === "boolean"
      ? stored.reduced
      : matchMedia("(prefers-reduced-motion: reduce)").matches,
  quality: (typeof stored.quality === "string" &&
  Object.hasOwn(qualityPresets, stored.quality)
    ? stored.quality
    : "performance") as QualityPreset,
};
const storedFavorites = read<unknown>("kx-home-favorites-v1", []);
const saved = new Set<string>(
  (Array.isArray(storedFavorites) ? storedFavorites : []).filter(
    (id): id is string =>
      typeof id === "string" && records.some((r) => r.id === id),
  ),
);
let mode: "archive" | "detail" = "archive",
  selected = 0,
  activeTab = "overview",
  active = window.parent === window,
  ready = false;
let scene: ArchiveScene | undefined;
let modal: "search" | "saved" | "settings" | null = null,
  modalClosing = false,
  modalTransition: SurfaceTransition | undefined,
  previousFocus: HTMLElement | null = null;
let modalSiblings: { node: HTMLElement; inert: boolean }[] = [],
  query = "",
  filter = "全部实验",
  previousLayout = "",
  pendingDetailFocus = false;
let clockSecond = -1,
  toastTimer: ReturnType<typeof setTimeout>;
const columnMemory = archiveColumns.map((_, lane) => columnFiles(lane)[0]);
const motion = () => ({
  ...(prefs.reduced ? reducedMotion() : fullMotion()),
  boot: false,
});
paintTheme(prefs.dark ? 1 : 0);
$("#stage").innerHTML = `
<div id="three-scene" class="three-scene"></div><div class="scene-atmosphere archive-atmosphere"></div>
<header class="brand">${brandHeading}</header>
<nav class="system-nav" aria-label="主页导航"><button class="home-continue" data-action="continue" hidden>继续当前实验 <span>↗</span></button><button data-action="search"><span class="nav-glyph">⌕</span> 实验索引 <span class="key">/</span></button><button data-action="records">我的实验 <span id="record-count">00</span></button><button data-action="saved" aria-label="收藏的实验">收藏 <span id="saved-count">00</span></button><button class="settings-button" data-action="settings" aria-label="主页设置"><span class="settings-glyph" aria-hidden="true">◷</span><span class="settings-label">设置</span></button></nav>
<section id="archive-ui" class="archive-ui" aria-label="实验档案选择"><div class="archive-callout"><div class="eyebrow">EXPERIMENT ARCHIVE <span>／</span> <span id="archive-category">基础控制</span></div><button class="file-title" data-action="open">实验档案 <span id="selected-id">K-<span id="selected-code">001</span></span><span class="file-open">↗</span></button><div class="callout-rule"><i></i></div><div class="file-summary"><span id="selected-title">电机调速</span><span id="selected-clearance">LOCAL SIMULATION</span></div><button class="read-file" data-action="open" data-testid="home-open-detail">查看实验 <span>→</span></button></div>
<div id="hover-label" class="hover-label" hidden>K-<span id="hover-code">001</span> / <span id="hover-title"></span></div>
<div class="archive-counter"><span class="tiny-label">EXPERIMENT / SELECT</span><div><span id="selected-number">01</span><i>/</i><span class="count-total">${String(records.length).padStart(2, "0")}</span></div></div>
<div class="archive-navigation"><button data-action="prev" aria-label="上一个实验">↑</button><div id="file-ticks" class="file-ticks"></div><button data-action="next" aria-label="下一个实验">↓</button></div>
<div class="column-navigation"><button data-action="column-prev" aria-label="上一组">←</button><div><span id="column-number">GROUP <span id="column-index">01</span> / 02</span><strong id="column-name">基础控制</strong></div><button data-action="column-next" aria-label="下一组">→</button></div>
<div class="archive-hint"><kbd>←</kbd> <kbd>→</kbd> 切换分组 <span>／</span> <kbd>↑</kbd> <kbd>↓</kbd> 选择实验 <span>／</span> <kbd>ENTER</kbd> 查看 <span>／</span> 拖动浏览</div></section>
<section id="detail-ui" class="detail-ui" aria-label="实验说明" hidden><button class="back-button" data-action="back">← <span>返回实验档案</span><small>ESC</small></button><div class="object-caption"><span id="object-id">NO.001</span><div>CONTROL EXPERIMENT</div><small>拖动查看档案外观 <span>↔</span></small></div><article id="detail-content" class="detail-content"></article></section>
<div class="powered">EXPLORE WITH <b>控小助</b><i></i></div><footer class="system-footer"><span><i class="status-light"></i> 本机计算 · 本机保存</span><span>CONTROL LAB <i>／</i> <span id="clock"></span></span><button data-action="verification">开放与验证 ↗</button></footer>
<div id="modal-root"></div><div id="toast" class="toast" role="status"></div><div class="scene-status" id="scene-status" role="status">正在载入本地实验档案…</div>`;
$("#stage").insertAdjacentHTML("beforeend", `<div class="array-intro-ui"><div class="array-intro-copy" aria-hidden="true"><span id="array-intro-text"></span><small>SIGNAL ARCHIVE / 实验信号匣</small></div><button class="array-intro-skip" data-action="skip-intro" aria-label="跳过入场动画">跳过入场 <small>ESC</small></button></div>`);
$("#stage").dataset.mode = "archive";
$("#stage").dataset.boot = "done";
$("#stage").dataset.intro = "waiting";
for (const selector of ["#archive-ui", ".system-nav", ".system-footer"]) $(selector).inert = true;
function finishIntro(immediate = false) {
  const wasOpening = intro.phase !== "done" || $("#stage").dataset.intro !== "done";
  intro.finish();
  $("#stage").dataset.intro = "done";
  $("#stage").style.setProperty("--intro-ui", "1");
  for (const selector of ["#archive-ui", ".system-nav", ".system-footer"]) $(selector).inert = Boolean(modal);
  if (wasOpening && ready && scene && immediate) scene.enterArchiveImmediately(selected);
  if (wasOpening && document.activeElement?.closest(".array-intro-ui")) $(".read-file").focus({ preventScroll: true });
  if (ready && active) send("entry-complete");
}
function startIntroWhenVisible() {
  if (!ready || !active || document.hidden) return;
  if (intro.phase === "done") { send("entry-complete"); return; }
  if (intro.phase !== "waiting") return;
  intro.start(performance.now(), prefs.reduced);
  if (intro.phase === "running") {
    $("#stage").dataset.intro = "running";
    $("[data-action=\"skip-intro\"]").focus({ preventScroll: true });
    scene?.update(performance.now() / 1000, intro.advance(performance.now())!);
    sound("array");
  } else finishIntro();
}
const detailTransition = new SurfaceTransition(
    $("#detail-ui"),
    undefined,
    180,
    180,
  ),
  tabTransition = new ContentTransition();
const documentDecryption = new DocumentDecryption();
const rolling = { duration: 460, motionBlur: true, animated: !prefs.reduced };
const numberOptions = {
  ...rolling,
  locales: "en-US",
  format: { minimumIntegerDigits: 2, useGrouping: false },
  value: 1,
};
const fileCounter = createRollingNumber($("#selected-number"), numberOptions),
  columnCounter = createRollingNumber($("#column-index"), numberOptions);
const codeOptions = {
  ...numberOptions,
  format: { minimumIntegerDigits: 3, useGrouping: false },
};
const selectedCode = createRollingNumber($("#selected-code"), codeOptions),
  hoverCode = createRollingNumber($("#hover-code"), codeOptions);
const titles = [
  "selected-title",
  "column-name",
  "hover-title",
  "archive-category",
  "selected-clearance",
].map((id) =>
  createRollingText($("#" + id), {
    ...rolling,
    transition: "direct",
    stagger: "none",
    text: $("#" + id).textContent ?? "",
  }),
);
const [selectionTitle, columnTitle, hoverTitle, categoryTitle, clearanceTitle] =
  titles;
function fit() {
  const stage = $("#stage"),
    viewport = $("#viewport");
  if (!viewport.clientWidth || !viewport.clientHeight) return;
  const { width, height, scale, kind } = viewportLayout(
    viewport.clientWidth,
    viewport.clientHeight,
    matchMedia("(pointer: coarse)").matches,
  );
  Object.assign(stage.style, {
    width: `${width}px`,
    height: `${height}px`,
    transform: `translate(-50%, -50%) scale(${scale})`,
  });
  stage.dataset.layout = kind;
  stage.dataset.touch = String(matchMedia("(pointer: coarse)").matches);
  stage.style.setProperty("--stage-scale", String(scale));
  stage.style.setProperty("--modal-top", "0px");
  stage.style.setProperty("--modal-height", `${height}px`);
  viewport.style.setProperty("--scale", String(scale));
  const key = `${width}:${height}:${scale}:${devicePixelRatio}`;
  if (key !== previousLayout) {
    previousLayout = key;
    scene?.resize();
  }
  requestAnimationFrame(() => {
    documentDecryption.refresh();
    positionTab();
  });
}
window.addEventListener("resize", fit);
window.visualViewport?.addEventListener("resize", fit);
function applyPrefs() {
  try { localStorage.setItem("kx-home-settings-v1", JSON.stringify(prefs)); }
  catch { /* Keep the interface usable even if preferences cannot be saved. */ }
  const saved = saveColorTheme(getColorThemeStorage(), prefs.dark ? "dark" : "light");
  scene?.setMotion(motion());
  scene?.setTheme(prefs.dark, !ready || prefs.reduced);
  scene?.setQuality(normalizeQuality(qualityPresets[prefs.quality]));
  if (!scene) paintTheme(prefs.dark ? 1 : 0);
  $("#stage").classList.toggle("reduce-motion", prefs.reduced);
  $("#stage").classList.toggle("reduce-surfaces", prefs.reduced);
  if (prefs.reduced) {
    finishIntro(true);
    titles.forEach((t) => t.finish());
    [fileCounter, columnCounter, selectedCode, hoverCode].forEach((n) =>
      n.finish(),
    );
    detailTransition.finish();
    modalTransition?.finish();
    tabTransition.finish();
  }
  return saved;
}
function select(index: number, navigation?: ArchiveNavigation) {
  if (!Number.isInteger(index) || index < 0 || index >= records.length) return;
  if (intro.phase === "running") return;
  const changed = selected !== index;
  selected = index;
  columnMemory[fileLocation(index).lane] = index;
  if (mode === "detail") setMode("archive");
  activeTab = "overview";
  scene?.select(index, navigation);
  updateSelection(navigation);
  if (changed) sound(navigation && "axis" in navigation && navigation.axis === "lane" ? "column" : "tick", 110);
}
function stepFile(direction: number) {
  select(wrap(selected + direction, records.length), {
    axis: "row",
    direction,
  });
}
function stepColumn(direction: number) {
  select(
    columnMemory[
      wrap(fileLocation(selected).lane + direction, archiveColumns.length)
    ],
    { axis: "lane", direction },
  );
}
function updateSelection(navigation?: ArchiveNavigation) {
  const r = records[selected],
    lane = fileLocation(selected).lane,
    animated = !prefs.reduced && mode === "archive";
  selectionTitle.update({ text: r.title, animated });
  categoryTitle.update({ text: r.category, animated });
  columnTitle.update({ text: r.category, animated });
  clearanceTitle.update({ text: r.clearance, animated });
  const direction =
    navigation && "axis" in navigation
      ? navigation.direction > 0
        ? "up"
        : "down"
      : "auto";
  selectedCode.update({ value: Number(r.id.slice(2)), animated, direction });
  fileCounter.update({
    value: selected + 1,
    animated,
    direction,
  });
  columnCounter.update({ value: lane + 1, animated, direction });
  $(".count-total").textContent = String(records.length).padStart(2, "0");
  if ($("#file-ticks").children.length !== records.length)
    $("#file-ticks").innerHTML = records.map(() => "<button></button>").join("");
  [...$("#file-ticks").children].forEach((node, index) => {
    const b = node as HTMLButtonElement,
      record = records[index];
    b.dataset.select = String(index);
    b.setAttribute("aria-label", `选择 ${record.title}`);
    b.title = record.title;
    b.classList.toggle("selected", index === selected);
    b.setAttribute("aria-pressed", String(index === selected));
  });
  $("#saved-count").textContent = String(saved.size).padStart(2, "0");
}
function setMode(next: typeof mode) {
  if (intro.phase === "running") return;
  const previous = mode;
  mode = next;
  $("#stage").dataset.mode = next;
  $("#archive-ui").inert = next !== "archive" || Boolean(modal);
  $("#archive-ui").setAttribute("aria-hidden", String(next !== "archive"));
  $("#detail-ui").inert = next !== "detail" || Boolean(modal);
  scene?.setMode(next);
  if (previous !== next) {
    sound(next === "detail" ? "open" : "back");
    previousDecryptionPhase = "waiting";
  }
  fit();
  if (next === "detail") {
    titles.forEach((t) => t.finish());
    $("#hover-label").hidden = true;
    if (previous !== "detail") {
      renderDetail();
      detailTransition.show(prefs.reduced);
      pendingDetailFocus = true;
    }
  } else if (previous === "detail") {
    pendingDetailFocus = false;
    tabTransition.cancel();
    detailTransition.hide(prefs.reduced);
    $(".read-file").focus({ preventScroll: true });
  }
}
function renderDetail() {
  const r = records[selected];
  $("#object-id").textContent = r.id;
  $("#detail-content").innerHTML =
    `<div class="detail-kicker"><span>EXPERIMENT ${r.id}</span><span>${r.clearance}</span></div><h2>${escapeHtml(r.title)}</h2><div class="detail-title-cn">${r.en}<span>${r.category}</span></div><div class="detail-rule"></div><dl class="metadata"><div><dt>FOCUS / 实验主题</dt><dd>${r.department}</dd></div><div><dt>MODE / 学习方式</dt><dd>${r.date}</dd></div><div><dt>CONTROLLER / 控制器</dt><dd>${r.lead}</dd></div><div><dt>STATUS / 计算环境</dt><dd><i></i>本机仿真 · 无需硬件</dd></div></dl><div class="detail-tabs" role="tablist" aria-label="实验说明页签">${[
      ["overview", "实验任务"],
      ["notes", "学习目标"],
      ["boundary", "模型与边界"],
    ]
      .map(
        ([id, label], i) =>
          `<button id="tab-${id}" role="tab" aria-controls="tab-panel" data-tab="${id}">${String(i + 1).padStart(2, "0")} <span>${label}</span></button>`,
      )
      .join(
        "",
      )}<i class="tab-indicator" aria-hidden="true"></i></div><div id="tab-panel" class="tab-panel" role="tabpanel" tabindex="0"></div><div class="detail-actions"><button class="solid-button" data-action="start" data-testid="home-start-${r.caseId}">开始${r.caseId === "challenge" ? "挑战" : "实验"}<span>进入工作台 →</span></button><button class="export-button" data-action="bookmark" aria-pressed="${saved.has(r.id)}">${saved.has(r.id) ? "已收藏" : "收藏实验"} <span>＋</span></button></div><div class="detail-footnote"><span>左侧为合成信号傅里叶解析示意；实验响应在工作台实际计算。</span><span>${selected + 1} / ${records.length}</span></div>`;
  $("#detail-content").tabIndex = -1;
  setTab(activeTab, false);
  documentDecryption.reset(
    $("#detail-content"),
    prefs.reduced || !scene || scene.decryptionFrame.phase === "clear",
  );
  if (!scene) revealDetailWithoutScene();
}
function revealDetailWithoutScene() {
  const content = $("#detail-content");
  // Loading can fail after the user already opened a still-redacted detail.
  // Reset the physical reveal's DOM state so the experiment action stays usable.
  content.style.opacity = "1";
  content.style.translate = "0 0";
  content.inert = false;
  documentDecryption.reset(content, true);
}
function positionTab() {
  const tab = $<HTMLButtonElement>(".detail-tabs button.active"),
    indicator = $(".tab-indicator");
  if (tab && indicator)
    indicator.style.transform = `translateX(${tab.offsetLeft}px) scaleX(${tab.offsetWidth})`;
}
function setTab(tab: string, animate = true) {
  if (!["overview", "notes", "boundary"].includes(tab)) return;
  activeTab = tab;
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  });
  const r = records[selected];
  $("#tab-panel").setAttribute("aria-labelledby", `tab-${tab}`);
  $("#tab-panel").innerHTML =
    tab === "overview"
      ? `<div class="panel-label">TASK / 实验任务</div><p>${escapeHtml(r.abstract)}</p><p class="experiment-flow">预测 → 调参 → 仿真 → 比较 → 复盘</p>`
      : `<div class="panel-label">${tab === "notes" ? "LEARNING / 学习目标" : "MODEL / 模型假设"}</div><ol class="research-notes">${(tab === "notes" ? r.findings : r.assumptions).map((item, i) => `<li><span>${String(i + 1).padStart(2, "0")}</span>${escapeHtml(item)}</li>`).join("")}</ol>`;
  $("#tab-panel").scrollTop = 0;
  positionTab();
  documentDecryption.refresh();
  if (animate) { tabTransition.reveal($("#tab-panel"), prefs.reduced); sound("ui-tick"); }
}
function notify(message: string) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 2600);
}
function toggleSaved() {
  sound("confirm");
  const id = records[selected].id;
  if (saved.has(id)) saved.delete(id);
  else saved.add(id);
  localStorage.setItem("kx-home-favorites-v1", JSON.stringify([...saved]));
  updateSelection();
  const button = $('[data-action="bookmark"]');
  button.innerHTML = `${saved.has(id) ? "已收藏" : "收藏实验"} <span>＋</span>`;
  button.setAttribute("aria-pressed", String(saved.has(id)));
  notify(saved.has(id) ? "实验已加入收藏" : "已取消收藏");
}
function openModal(kind: NonNullable<typeof modal>) {
  finishIntro(true);
  sound("page-open");
  previousFocus = document.activeElement as HTMLElement;
  modalSiblings = [...$("#stage").children]
    .filter(
      (node): node is HTMLElement =>
        node instanceof HTMLElement && node.id !== "modal-root",
    )
    .map((node) => ({ node, inert: node.inert }));
  modalSiblings.forEach(({ node }) => (node.inert = true));
  modal = kind;
  modalClosing = false;
  query = "";
  filter = "全部实验";
  renderModal();
}
function closeModal(after = () => {}) {
  if (!modal) {
    after();
    return;
  }
  if (modalClosing) return;
  sound("page-close");
  modalClosing = true;
  modalTransition!.hide(prefs.reduced, () => {
    modal = null;
    modalClosing = false;
    $("#modal-root").replaceChildren();
    modalTransition = undefined;
    modalSiblings.forEach(({ node, inert }) => (node.inert = inert));
    modalSiblings = [];
    previousFocus?.focus({ preventScroll: true });
    after();
  });
}
function syncAudioSettings() {
  for (const key of ["enabled", "sound", "music", "typing"] as const) {
    const button = $<HTMLButtonElement>(`[data-audio-toggle="${key}"]`);
    if (!button) continue;
    button.setAttribute("aria-pressed", String(audioPreferences[key]));
    button.textContent = audioPreferences[key] ? "开启" : "关闭";
  }
  for (const key of ["soundVolume", "musicVolume"] as const) {
    const input = $<HTMLInputElement>(`[data-audio-volume="${key}"]`);
    if (!input) continue;
    input.value = String(Math.round(audioPreferences[key] * 100));
    $(`[data-audio-output="${key}"]`).textContent = input.value + "%";
  }
  const status = $("#home-audio-status");
  if (status) status.textContent = audioSaved ? (AUDIO_STATUS_LABELS[audioStatus] || "声音已就绪") : "声音已应用，但本机存储暂时不可写，重启后可能无法保留。";
}
function audioSettingsMarkup() {
  const toggles = [
    ["enabled", "全部声音", "关闭后，背景配乐与全部操作音效同时静音。"],
    ["music", "背景配乐", "主页进入实验台后继续播放，循环衔接。"],
    ["sound", "交互音效", "切换、抽取、解析和按钮的轻声反馈。"],
    ["typing", "文字解析声", "逐字出现时的合成短音，可单独关闭。"],
  ] as const;
  return `<section class="home-audio-settings" aria-label="声音设置"><h3>声音</h3>${toggles.map(([key, title, description]) => `<div class="home-setting-row"><div><strong>${title}</strong><span>${description}</span></div><button type="button" data-audio-toggle="${key}" aria-label="${title}" aria-pressed="${audioPreferences[key]}">${audioPreferences[key] ? "开启" : "关闭"}</button></div>`).join("")}${([["musicVolume", "配乐音量"], ["soundVolume", "音效音量"]] as const).map(([key, title]) => `<div class="home-setting-row"><div><strong>${title}</strong></div><label class="home-audio-volume"><input type="range" min="0" max="100" step="1" data-audio-volume="${key}" aria-label="${title}" value="${Math.round(audioPreferences[key] * 100)}"/><output data-audio-output="${key}">${Math.round(audioPreferences[key] * 100)}%</output></label></div>`).join("")}<p class="home-audio-status" id="home-audio-status">${escapeHtml(AUDIO_STATUS_LABELS[audioStatus] || "声音已就绪")}</p></section>`;
}
function settingsMarkup() {
  return `<h2>主页设置<small>DISPLAY & SOUND</small></h2>${themeSettingsMarkup(prefs.dark)}${audioSettingsMarkup()}<div class="home-setting-row"><div><strong>动态效果</strong><span>阵列入场、档案浏览、抽取、归位与信号解析。</span></div><button data-action="motion" aria-pressed="${!prefs.reduced}">${prefs.reduced ? "减少动态效果" : "完整动态效果"}</button></div><div class="home-setting-row"><div><strong>三维画质</strong><span>性能模式降低渲染开销，文字保持清晰。</span></div><select id="home-quality" aria-label="三维画质">${Object.entries(
    { performance: "流畅", original: "标准", high: "精细", ultra: "极高" },
  )
    .map(
      ([value, label]) =>
        `<option value="${value}" ${prefs.quality === value ? "selected" : ""}>${label}</option>`,
    )
    .join(
      "",
    )}</select></div><div class="home-setting-row"><div><strong>AI 模型与 API</strong><span>DeepSeek 或兼容接口，在软件设置中配置。</span></div><button data-action="api-settings">配置模型 ↗</button></div><div class="home-setting-row"><div><strong>控小助 ${appVersion}</strong><span>实验计算与数据保存在本机。</span></div><button data-action="verification">开放与验证 ↗</button></div><p class="home-attribution">档案交互基于 RhineLabUI（LBEILC，MIT）改编。详细来源与许可证随软件提供。</p>`;
}
function renderModal() {
  modalTransition?.dispose();
  const settings = modal === "settings";
  $("#modal-root").innerHTML =
    `<div class="modal-backdrop"><section class="terminal-modal ${settings ? "settings-modal" : ""}" role="dialog" aria-modal="true" aria-label="${settings ? "主页设置" : modal === "saved" ? "收藏实验" : "实验索引"}"><div class="modal-top"><span>控小助 / ${settings ? "PREFERENCES" : "EXPERIMENT INDEX"}</span><button data-action="close-modal" aria-label="关闭窗口">CLOSE <span>×</span></button></div>${settings ? settingsMarkup() : `<h2>${modal === "saved" ? "收藏实验" : "实验索引"}<small>4 个实验 · 真实计算</small></h2><div class="search-field"><span>⌕</span><input id="archive-search" type="search" placeholder="输入实验名称、编号或控制器" aria-label="检索实验"/><span class="key">ESC</span></div><div class="category-filters">${categories.map((c, i) => `<button data-filter="${c}" class="${i === 0 ? "active" : ""}">${c}</button>`).join("")}</div><div class="result-header"><span>EXPERIMENT / 实验</span><span>MODE / 类型</span><span>查看</span></div><div id="search-results" class="search-results"></div><div class="modal-bottom"><span id="result-count"></span><button data-action="library">打开列表形式的实验库 →</button></div>`}</section></div>`;
  const backdrop = $(".modal-backdrop");
  backdrop.hidden = true;
  modalTransition = new SurfaceTransition(backdrop, $(".terminal-modal"));
  modalTransition.show(prefs.reduced);
  if (!settings) renderResults();
  requestAnimationFrame(() => {
    if (backdrop.isConnected)
      (settings
        ? $('[data-action="close-modal"]')
        : $("#archive-search")
      ).focus();
  });
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
}
function renderResults() {
  const found = records
    .map((r, i) => ({ r, i }))
    .filter(
      ({ r }) =>
        (modal !== "saved" || saved.has(r.id)) &&
        (filter === "全部实验" || r.category === filter) &&
        `${r.id} ${r.title} ${r.en} ${r.lead}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
  $("#search-results").innerHTML = found.length
    ? found
        .map(
          ({ r, i }) =>
            `<button class="result-row" data-result="${i}" data-testid="home-select-${r.caseId}"><span class="result-name"><b>${r.id}</b><span>${r.title}<small>${r.en}</small></span></span><span>${r.date}</span><span>查看实验 ↗</span></button>`,
        )
        .join("")
    : '<p class="empty-results">没有匹配的实验。</p>';
  $("#result-count").textContent = `${found.length} 个实验`;
}
function navigate(type: string, extra = {}) {
  if (type !== "start-experiment") sound("page-open");
  closeModal(() => send(type, extra));
}
document.addEventListener("click", (event) => {
  if (!active) return;
  const el = (event.target as Element).closest<HTMLElement>(
    "button,[data-action]",
  );
  if (!el) return;
  if (el.dataset.action === "skip-intro") { finishIntro(true); sound("confirm"); return; }
  if (intro.phase !== "done") return;
  if (el.dataset.audioToggle && ["enabled", "sound", "music", "typing"].includes(el.dataset.audioToggle)) {
    const key = el.dataset.audioToggle as "enabled" | "sound" | "music" | "typing";
    audioPreferences[key] = !audioPreferences[key];
    syncAudioSettings();
    send("audio-settings", { patch: { [key]: audioPreferences[key] } });
    return;
  }
  if (el.dataset.select !== undefined) {
    select(Number(el.dataset.select));
    return;
  }
  if (el.dataset.result !== undefined) {
    const index = Number(el.dataset.result);
    closeModal(() => {
      select(index);
      setMode("detail");
    });
    return;
  }
  if (el.dataset.filter) {
    sound("ui-tick");
    filter = el.dataset.filter;
    document
      .querySelectorAll<HTMLElement>("[data-filter]")
      .forEach((b) =>
        b.classList.toggle("active", b.dataset.filter === filter),
      );
    renderResults();
    return;
  }
  if (el.dataset.tab) {
    setTab(el.dataset.tab);
    return;
  }
  if (el.dataset.colorTheme) {
    sound("ui-tick");
    prefs.dark = el.dataset.colorTheme === "dark";
    if (!applyPrefs()) notify("配色已应用，但本机存储暂时不可写，重启后可能无法保留。");
    send("color-theme", { theme: prefs.dark ? "dark" : "light" });
    document
      .querySelectorAll<HTMLElement>("[data-color-theme]")
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String((b.dataset.colorTheme === "dark") === prefs.dark),
        ),
      );
    return;
  }
  switch (el.dataset.action) {
    case "open":
      setMode("detail");
      break;
    case "back":
      setMode("archive");
      break;
    case "prev":
      stepFile(-1);
      break;
    case "next":
      stepFile(1);
      break;
    case "column-prev":
      stepColumn(-1);
      break;
    case "column-next":
      stepColumn(1);
      break;
    case "search":
    case "saved":
    case "settings":
      openModal(el.dataset.action);
      break;
    case "close-modal":
      closeModal();
      break;
    case "bookmark":
      toggleSaved();
      break;
    case "motion":
      sound("ui-tick");
      prefs.reduced = !prefs.reduced;
      applyPrefs();
      el.textContent = prefs.reduced ? "减少动态效果" : "完整动态效果";
      el.setAttribute("aria-pressed", String(!prefs.reduced));
      break;
    case "records":
      navigate("open-records");
      break;
    case "library":
      navigate("open-library");
      break;
    case "api-settings":
      navigate("open-settings");
      break;
    case "verification":
      navigate("open-verification");
      break;
    case "continue":
      navigate("continue-experiment");
      break;
    case "start":
      sound("confirm");
      navigate("start-experiment", { caseId: records[selected].caseId });
      break;
  }
});
document.addEventListener("input", (e) => {
  const audioInput = e.target as HTMLInputElement;
  if (["soundVolume", "musicVolume"].includes(audioInput.dataset.audioVolume ?? "")) {
    const key = audioInput.dataset.audioVolume as "soundVolume" | "musicVolume";
    audioPreferences[key] = Math.max(0, Math.min(1, Number(audioInput.value) / 100));
    $(`[data-audio-output="${key}"]`).textContent = `${Math.round(audioPreferences[key] * 100)}%`;
    send("audio-settings", { patch: { [key]: audioPreferences[key] } });
    return;
  }
  if ((e.target as HTMLElement).id === "archive-search") {
    query = (e.target as HTMLInputElement).value;
    renderResults();
  }
});
document.addEventListener("change", (e) => {
  if ((e.target as HTMLElement).id === "home-quality") {
    prefs.quality = (e.target as HTMLSelectElement).value as QualityPreset;
    applyPrefs();
    sound("ui-tick");
  }
});
document.addEventListener("keydown", (e) => {
  if (!active) return;
  if (intro.phase !== "done") {
    if (["Escape", "Enter", " "].includes(e.key)) { e.preventDefault(); finishIntro(true); sound("confirm"); }
    return;
  }
  if (modal) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
    }
    if (e.key === "Tab") {
      const focusable = [
        ...$(".terminal-modal").querySelectorAll<HTMLElement>(
          'button,input,select,a,[tabindex="0"]',
        ),
      ].filter((n) => !n.hasAttribute("disabled") && n.getClientRects().length);
      const first = focusable[0],
        last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    return;
  }
  if ((e.target as HTMLElement).matches("input,textarea,select")) return;
  if (
    (e.target as HTMLElement).closest('[role="tablist"]') &&
    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
  ) {
    e.preventDefault();
    const tabs = [
      ...document.querySelectorAll<HTMLButtonElement>("[data-tab]"),
    ];
    let index = tabs.indexOf(e.target as HTMLButtonElement);
    index =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? tabs.length - 1
          : wrap(index + (e.key === "ArrowRight" ? 1 : -1), tabs.length);
    tabs[index].focus();
    setTab(tabs[index].dataset.tab!);
    return;
  }
  if (e.key === "Escape" && mode === "detail") {
    e.preventDefault();
    setMode("archive");
    return;
  }
  if (e.key === "/") {
    e.preventDefault();
    openModal("search");
    return;
  }
  if (mode !== "archive") return;
  const actions: Record<string, () => void> = {
    ArrowUp: () => stepFile(-1),
    ArrowDown: () => stepFile(1),
    ArrowLeft: () => stepColumn(-1),
    ArrowRight: () => stepColumn(1),
    Enter: () => setMode("detail"),
  };
  if (
    actions[e.key] &&
    !(e.key === "Enter" && (e.target as HTMLElement).closest("button"))
  ) {
    e.preventDefault();
    actions[e.key]();
  }
});
window.addEventListener("message", (event) => {
  if (
    event.source !== window.parent ||
    event.data?.source !== "kongxiaozhu-app"
  )
    return;
  if (
    event.data.type === "visibility" &&
    typeof event.data.active === "boolean"
  ) {
    active = event.data.active;
    intro.resetClock();
    $("#stage").inert = !active;
    if (active) {
      scene?.resetAnimationClock();
      requestAnimationFrame(fit);
      startIntroWhenVisible();
    }
  }
  if (event.data.type === "audio-state") {
    const candidate = event.data.preferences;
    if (candidate && typeof candidate === "object" &&
      ["enabled", "sound", "music", "typing"].every(key => typeof candidate[key] === "boolean") &&
      ["soundVolume", "musicVolume"].every(key => Number.isFinite(candidate[key]) && candidate[key] >= 0 && candidate[key] <= 1)) {
      audioPreferences = Object.fromEntries(Object.keys(DEFAULT_AUDIO_PREFERENCES).map(key => [key, candidate[key]])) as typeof audioPreferences;
      if (typeof event.data.status === "string" && Object.hasOwn(AUDIO_STATUS_LABELS, event.data.status)) audioStatus = event.data.status;
      audioSaved = event.data.saved !== false;
      syncAudioSettings();
    }
  }
  if (event.data.type === "color-theme" && isColorTheme(event.data.theme)) {
    const dark = event.data.theme === "dark";
    if (prefs.dark !== dark) {
      prefs.dark = dark;
      applyPrefs();
      document.querySelectorAll<HTMLElement>("[data-color-theme]").forEach(button =>
        button.setAttribute("aria-pressed", String((button.dataset.colorTheme === "dark") === dark)),
      );
    }
  }
  if (event.data.type === "context") {
    const title =
      typeof event.data.currentExperimentTitle === "string"
        ? event.data.currentExperimentTitle
        : "";
    $("#record-count").textContent = String(
      Math.max(0, Number(event.data.experimentCount) || 0),
    ).padStart(2, "0");
    $(".home-continue").hidden = !title;
    $(".home-continue").title = title;
  }
});
function frame(ms: number) {
  requestAnimationFrame(frame);
  const visible = active && !document.hidden && Boolean($("#viewport").clientWidth && $("#viewport").clientHeight);
  const opening = intro.advance(ms, visible);
  if (
    !visible
  )
    return;
  const time = ms / 1000;
  paintTheme(scene?.themeAmount ?? (prefs.dark ? 1 : 0));
  scene?.update(time, opening ?? undefined);
  if (opening) {
    $("#stage").style.setProperty("--intro-ui", String(opening.uiOpacity));
    $(".array-intro-copy").style.opacity = String(opening.captionOpacity);
    $("#array-intro-text").textContent = "正在展开实验档案".slice(0, opening.letters);
    if (opening.letters > introLetters) { introLetters = opening.letters; sound("key", 95); }
  } else if (intro.phase === "done" && $("#stage").dataset.intro !== "done") finishIntro();
  if (mode === "detail") {
    if (scene) {
      documentDecryption.update(time, scene.decryptionFrame, prefs.reduced);
      const phase = scene.decryptionFrame.phase;
      if (phase !== previousDecryptionPhase) {
        if (phase === "joining") sound("scan", 1000);
        if (phase === "revealing") sound("text-reveal");
        if (phase === "clear" && previousDecryptionPhase !== "waiting") sound("confirm");
        previousDecryptionPhase = phase;
      }
      if (phase === "revealing" && time - lastRevealKey >= 0.11) { lastRevealKey = time; sound("key", 95); }
      $("#detail-content").style.opacity = String(scene.detailVisibility);
      $("#detail-content").style.translate =
        `0 ${(1 - scene.detailVisibility) * 18}px`;
      $("#detail-content").inert = scene.detailVisibility < 0.1;
    }
    if (
      pendingDetailFocus &&
      (!scene || scene.detailVisibility >= 0.1) &&
      !modal
    ) {
      $("#detail-content").focus({ preventScroll: true });
      pendingDetailFocus = false;
    }
  }
  $("#stage").style.setProperty(
    "--detail-shade",
    String(scene?.detailVisibility ?? 0),
  );
  if (Math.floor(time) !== clockSecond) {
    clockSecond = Math.floor(time);
    $("#clock").textContent = new Date().toLocaleTimeString("en-GB");
    $("#three-scene").dataset.renderStats = JSON.stringify(
      scene?.getStats() ?? { loaded: false },
    );
  }
}
async function start() {
  fit();
  updateSelection();
  applyPrefs();
  requestAnimationFrame(frame);
  try {
    scene = new ArchiveScene($("#three-scene"));
    scene.setTheme(prefs.dark, true);
    scene.setQuality(normalizeQuality(qualityPresets[prefs.quality]));
    scene.setMotion(motion());
    await scene.load();
    scene.onSelect = (i, cell) => {
      if (intro.phase === "done" && mode === "archive" && !modal)
        select(i, cell ? { cell } : undefined);
    };
    scene.onNavigate = (axis, direction) => {
      if (intro.phase === "done" && mode === "archive" && !modal)
        (axis === "lane" ? stepColumn : stepFile)(direction);
    };
    scene.onHover = (i) => {
      const label = $("#hover-label");
      if (intro.phase !== "done" || i === null || mode !== "archive" || modal) {
        label.hidden = true;
        return;
      }
      hoverCode.update({
        value: Number(records[i].id.slice(2)),
        animated: !label.hidden && !prefs.reduced,
      });
      hoverTitle.update({
        text: records[i].title,
        animated: !label.hidden && !prefs.reduced,
      });
      label.hidden = false;
    };
    scene.enterArchiveImmediately(selected);
    if (mode === "detail") scene.setMode("detail");
    ready = true;
    $("#scene-status").hidden = true;
    send("ready");
    startIntroWhenVisible();
  } catch (error) {
    console.error(error);
    scene?.dispose();
    scene = undefined;
    if (mode === "detail") revealDetailWithoutScene();
    ready = true;
    finishIntro();
    $("#scene-status").textContent =
      "三维档案未能载入。实验索引和本机计算仍可使用。";
    $("#stage").classList.add("scene-unavailable");
    send("ready");
  }
}
void start();
document.addEventListener("visibilitychange", () => { intro.resetClock(); startIntroWhenVisible(); });
window.addEventListener("beforeunload", () => {
  scene?.dispose();
});
Object.defineProperty(window, "__kxHome", {
  value: {
    getState: () => ({
      mode,
      selected,
      caseId: records[selected].caseId,
      ready,
      active,
      modal,
      intro: { phase: intro.phase, active: intro.phase === "running", completed: intro.phase === "done", elapsed: intro.elapsed, progress: intro.elapsed / 4.56 },
      audio: { preferences: { ...audioPreferences }, status: audioStatus, saved: audioSaved },
      stats: scene?.getStats() ?? null,
      prefs: { ...prefs },
    }),
  },
});

import { animate, spring } from "motion";

/* ------------------------------------------------------------------ 基础 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EASE = [0.16, 1, 0.3, 1];

const T = window.TIMELINE || {
  intro: 2.6,
  scenes: [
    { id: "s1", duration: 6.5 }, { id: "s2", duration: 10 }, { id: "s3", duration: 12.8 },
    { id: "s4", duration: 12 }, { id: "s5", duration: 16 }, { id: "s6", duration: 11 },
    { id: "s7", duration: 10 }, { id: "s8", duration: 8 }
  ]
};

const sceneEls = T.scenes.map((s) => document.getElementById("scene-" + s.id));
const chapters = {
  s1: "01 · 明早几点走，今晚就知道",
  s2: "02 · 上车才看地图，已经晚了",
  s3: "03 · 出发前收到结论",
  s4: "04 · 未来 7 天",
  s5: "05 · 暴雨与事故，系统会改口",
  s6: "06 · 路线与备选",
  s7: "07 · 高德开放平台",
  s8: "08 · HappyDriver"
};

/* 舞台缩放：录制时 1920×1080，预览时自适应 */
const stage = $("#stage");
function fit() {
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  stage.style.transform = "scale(" + s + ")";
}
fit();
window.addEventListener("resize", fit);

/* 进度条 */
const total = T.intro + T.scenes.reduce((a, b) => a + b.duration, 0);
const bar = $("#progressBar");
const t0 = performance.now();
let done = false;
function tick(now) {
  if (done) return;
  const p = Math.min(1, (now - t0) / 1000 / total);
  bar.style.width = (p * 100).toFixed(2) + "%";
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/* 通用入场 */
function enter(el, opts = {}) {
  if (!el) return;
  const { y = 34, delay = 0, duration = 0.8, scale = null } = opts;
  const k = { opacity: [0, 1], y: [y, 0] };
  if (scale) k.scale = scale;
  animate(el, k, { duration, delay, easing: EASE });
}

/* ------------------------------------------------------------------ 场景 */
function playS1() {
  enter($(".s1-badge"), { y: 22, delay: 0.15, duration: 0.7 });
  animate($(".s1-title"), { opacity: [0, 1], scale: [0.92, 1], y: [40, 0] },
    { duration: 1.1, delay: 0.3, easing: EASE });
  enter($(".s1-tag"), { y: 26, delay: 0.75 });
  enter($(".s1-desc"), { y: 22, delay: 0.95 });
}

function playS2() {
  enter($("#scene-s2 .kick"), { y: 18, delay: 0.15, duration: 0.6 });
  enter($("#scene-s2 .h-xl"), { y: 30, delay: 0.25, duration: 0.9 });
  enter($("#scene-s2 .muted"), { y: 20, delay: 0.55 });
  enter($("#scene-s2 .metric"), { y: 20, delay: 0.8 });
  animate($("#phone2"), { opacity: [0, 1], x: [60, 0], rotate: [-9, -5], scale: [0.94, 1] },
    { duration: 1.1, delay: 0.35, easing: EASE });
  animate($("#phone2 img"), { scale: [1.06, 1] }, { duration: 9, easing: "linear" });

  const obj = { v: 38 };
  animate(obj, { v: 78 }, {
    duration: 3.6, delay: 1.4, easing: [0.4, 0, 0.2, 1],
    onUpdate: () => {
      $("#etaNum").textContent = Math.round(obj.v);
      const m = 7 * 60 + 42 + obj.v;
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(Math.round(m % 60)).padStart(2, "0");
      $("#etaClock").textContent = hh + ":" + mm;
    }
  });
  animate($(".phone-badge"), { opacity: [0.6, 1] }, { duration: 1.2, delay: 1.4, repeat: Infinity, direction: "alternate" });
}

function playS3() {
  animate($("#heroShot"), { opacity: [0, 1], x: [-70, 0], rotate: [-7, -3], scale: [0.94, 1] },
    { duration: 1.15, delay: 0.3, easing: EASE });
  [".float-chip.c1", ".float-chip.c2", ".float-chip.c3"].forEach((sel, i) => {
    enter($(sel), { y: 24, delay: 0.9 + i * 0.22, duration: 0.7 });
  });
  enter($("#scene-s3 .kick"), { y: 18, delay: 0.2, duration: 0.6 });
  enter($("#scene-s3 .h-xl"), { y: 30, delay: 0.35, duration: 0.9 });
  enter($("#scene-s3 .muted"), { y: 20, delay: 0.65 });
  enter($("#scene-s3 .tags"), { y: 18, delay: 0.95, duration: 0.6 });
}

function playS4() {
  enter($(".s4-head"), { y: 22, delay: 0.15, duration: 0.8 });
  $$(".d-card").forEach((el, i) => {
    animate(el, { opacity: [0, 1], y: [46, 0], scale: [0.96, 1] },
      { duration: 0.7, delay: 0.7 + i * 0.09, easing: EASE });
  });
  const rain = $(".d-card.rain");
  setTimeout(() => {
    animate(rain, { scale: [1, 1.045, 1] }, { duration: 1.6, easing: EASE });
    animate($(".d-flag"), { opacity: [0, 1], scale: [0.7, 1] }, { duration: 0.6, easing: EASE });
  }, 1500);
  enter($(".s4-note"), { y: 14, delay: 1.4, duration: 0.7 });
}

function playS5() {
  enter($(".s5-head"), { y: 22, delay: 0.15, duration: 0.8 });
  enter($(".time-flow"), { y: 16, delay: 0.5, duration: 0.6 });
  animate($("#browser5"), { opacity: [0, 1], y: [50, 0], scale: [0.96, 1] },
    { duration: 1.0, delay: 0.45, easing: EASE });

  setTimeout(() => {
    animate($("#t50"), { opacity: [0.9, 0.35] }, { duration: 0.4 });
    animate($("#t35"), { opacity: [0.5, 1], backgroundColor: ["rgba(255,255,255,.07)", "rgba(255,196,110,.18)"] }, { duration: 0.5 });
  }, 2300);
  setTimeout(() => {
    animate($("#t35"), { opacity: [1, 0.55] }, { duration: 0.4 });
    animate($("#t25"), { opacity: [0.5, 1], scale: [0.94, 1.06, 1] }, { duration: 0.6, easing: EASE });
  }, 4700);

  setTimeout(() => {
    animate($("#pushCard"), { opacity: [0, 1], x: [60, 0], scale: [0.94, 1] },
      { type: spring, stiffness: 210, damping: 22, delay: 0.1 });
  }, 5600);
}

function playS6() {
  enter($(".s6-head"), { y: 22, delay: 0.15, duration: 0.8 });
  animate($(".map-wrap"), { opacity: [0, 1], y: [40, 0], scale: [0.97, 1] },
    { duration: 1.0, delay: 0.4, easing: EASE });
  animate($(".map-wrap img"), { scale: [1.02, 1.1], x: [0, -26] }, { duration: 12, easing: "linear" });
  $$(".r-card").forEach((el, i) => {
    animate(el, { opacity: [0, 1], x: [40, 0] }, { duration: 0.7, delay: 0.9 + i * 0.18, easing: EASE });
  });
}

function playS7() {
  enter($(".s7-head"), { y: 22, delay: 0.15, duration: 0.8 });
  $$(".cap").forEach((el, i) => {
    animate(el, { opacity: [0, 1], y: [36, 0], scale: [0.96, 1] },
      { duration: 0.6, delay: 0.55 + i * 0.075, easing: EASE });
  });
  enter($(".s7-foot"), { y: 14, delay: 1.35, duration: 0.7 });
}

function playS8() {
  animate($(".s8-mark"), { opacity: [0, 1], scale: [0.8, 1], y: [20, 0] },
    { duration: 1.0, delay: 0.15, easing: EASE });
  animate($(".s8-name"), { opacity: [0, 1], y: [26, 0] }, { duration: 0.9, delay: 0.4, easing: EASE });
  enter($(".s8-tag"), { y: 18, delay: 0.65, duration: 0.7 });
  animate($(".s8-qr"), { opacity: [0, 1], y: [22, 0], scale: [0.94, 1] },
    { duration: 0.8, delay: 0.9, easing: EASE });
}

const players = { s1: playS1, s2: playS2, s3: playS3, s4: playS4, s5: playS5, s6: playS6, s7: playS7, s8: playS8 };

/* ------------------------------------------------------------------ 时间轴 */
const chapterEl = $("#chapter");
const chrome = $(".chrome");
const slate = $("#slate");

async function enterScene(i) {
  const el = sceneEls[i];
  const meta = T.scenes[i];
  el.style.visibility = "visible";
  el.classList.add("on");
  animate(el, { opacity: [0, 1] }, { duration: 0.6, easing: "ease-out" });
  chapterEl.textContent = chapters[meta.id] || "";
  // 标题场景隐藏常驻角标，避免抢视线
  chrome.classList.toggle("hide", meta.id === "s1" || meta.id === "s8");
  players[meta.id] && players[meta.id]();
}

async function exitScene(i) {
  const el = sceneEls[i];
  await animate(el, { opacity: [1, 0] }, { duration: 0.45, easing: "ease-in" }).finished;
  el.classList.remove("on");
  el.style.visibility = "hidden";
}

async function run() {
  window.__startWall = Date.now();
  window.__startPerf = performance.now();

  // 片头 slate：保留 2.6s 作为视频的呼吸位
  await sleep(T.intro * 1000);
  animate(slate, { opacity: [1, 0] }, { duration: 0.55 });
  setTimeout(() => { slate.style.display = "none"; }, 600);

  // 场景 1 与 slate 交叉淡入
  enterScene(0);
  await sleep(T.scenes[0].duration * 1000 - 500);
  await exitScene(0);

  for (let i = 1; i < sceneEls.length; i++) {
    const meta = T.scenes[i];
    enterScene(i);
    if (i === sceneEls.length - 1) {
      await sleep(meta.duration * 1000);
    } else {
      await sleep(meta.duration * 1000 - 450);
      await exitScene(i);
    }
  }

  done = true;
  bar.style.width = "100%";
  await sleep(300);
  window.__videoDone = true;
}

window.__start = run;

/* 预览：静态展示某一场景，便于截图检查 */
window.__showScene = (i) => {
  sceneEls.forEach((el) => { el.style.visibility = "hidden"; el.classList.remove("on"); });
  $("#slate").style.display = "none";
  enterScene(i);
};

/* 自动开始（?static=1 仅静态预览，不跑时间轴） */
if (!/static/.test(location.search)) {
  if (document.readyState === "complete") setTimeout(run, 300);
  else window.addEventListener("load", () => setTimeout(run, 300));
}

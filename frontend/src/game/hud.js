// game/hud.js — HUD + 播报 + 结算 + v4.0 输入重写
import { CFG } from "./config.js";
import "./bjs.js";

export function createHud(rootEl, opts = {}) {
  if (!rootEl) {
    rootEl = document.createElement("div");
    rootEl.id = "gameUI";
    document.body.appendChild(rootEl);
  }

  rootEl.innerHTML = `
    <style>
      #gameUI { position: fixed; inset: 0; z-index: 100; pointer-events: none; font-family: -apple-system, sans-serif; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
      #gameUI .topBar { position: absolute; top: env(safe-area-inset-top, 0); left: 0; right: 0; height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 8px; background: rgba(22,25,31,0.85); border-bottom: 1px solid #555; pointer-events: auto; transition: opacity 0.8s; }
      #gameUI .topBar button { background: #2a2f3f; color: #fff; border: 1px solid #555; padding: 6px 10px; font-size: 12px; cursor: pointer; margin-right: 4px; }
      #gameUI .topBar .stats { color: #c9d1e0; font-size: 11px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      #gameUI .centerAnnounce { position: absolute; top: calc(80px + env(safe-area-inset-top, 0)); left: 50%; transform: translateX(-50%); color: #fff; font-size: 20px; font-weight: 700; text-shadow: 0 2px 8px rgba(0,0,0,0.8); pointer-events: none; opacity: 0; transition: opacity 0.15s; text-align: center; max-width: 80%; }
      #gameUI .centerAnnounce.show { opacity: 1; }
      #gameUI .joystick { position: absolute; left: calc(24px + env(safe-area-inset-left, 0)); bottom: calc(24px + env(safe-area-inset-bottom, 0)); width: 120px; height: 120px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.25); border-radius: 50%; pointer-events: auto; touch-action: none; }
      #gameUI .joystick .knob { position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px; background: rgba(255,255,255,0.35); border-radius: 50%; }
      #gameUI .lookZone { position: absolute; right: 0; top: 0; bottom: 0; width: 52%; pointer-events: auto; touch-action: none; }
      #gameUI .actionBtns { position: absolute; right: calc(12px + env(safe-area-inset-right, 0)); bottom: calc(24px + env(safe-area-inset-bottom, 0)); display: flex; flex-direction: column; gap: 8px; pointer-events: auto; }
      #gameUI .actionBtns button { width: 64px; height: 64px; border-radius: 12px; border: 1px solid #555; background: rgba(40,46,58,0.88); color: #fff; font-size: 12px; font-weight: 700; }
      #gameUI .resultPanel { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); background: rgba(22,25,31,0.95); border: 1px solid #555; padding: 20px 24px; color: #fff; text-align: center; min-width: 280px; display: none; pointer-events: auto; }
      #gameUI .resultPanel.show { display: block; }
      #gameUI .resultPanel h2 { margin: 0 0 12px; font-size: 18px; }
      #gameUI .resultPanel .scores { font-size: 14px; line-height: 1.8; margin-bottom: 16px; color: #c9d1e0; }
      #gameUI .resultPanel button { background: linear-gradient(135deg, #3b82f6, #2563eb); color: #fff; border: none; padding: 10px 20px; font-size: 14px; font-weight: 700; cursor: pointer; }
      #gameUI .edgeArrow { position: absolute; width: 24px; height: 24px; background: rgba(255,80,80,0.9); color: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; pointer-events: none; opacity: 0; transition: opacity 0.2s; }
      #gameUI .edgeArrow.show { opacity: 1; }
      #gameUI .debugInfo { position: absolute; top: calc(50px + env(safe-area-inset-top, 0)); right: calc(8px + env(safe-area-inset-right, 0)); color: #8ab4f8; font-size: 10px; background: rgba(0,0,0,0.5); padding: 4px 6px; pointer-events: none; max-width: 55%; text-align: right; }
      #gameUI .inputPanel { position: absolute; top: calc(52px + env(safe-area-inset-top, 0)); left: calc(8px + env(safe-area-inset-left, 0)); background: rgba(22,25,31,0.88); border: 1px solid #555; padding: 8px 10px; color: #c9d1e0; font-size: 11px; pointer-events: auto; min-width: 180px; }
      #gameUI .inputPanel label { display: flex; align-items: center; justify-content: space-between; margin: 4px 0; gap: 8px; }
      #gameUI .inputPanel input[type=range] { width: 90px; }
      #gameUI .inputPanel .row { display: flex; gap: 6px; margin-top: 6px; }
      #gameUI .hiddenUI { opacity: 0 !important; pointer-events: none !important; }
    </style>
    <div class="topBar">
      <div>
        <button id="gameExitBtn">🚪 退出</button>
        <button id="gameModeBtn">模式: 沙盒</button>
        <button id="gameDebugBtn">碰撞调试</button>
        <button id="gameMuteBtn">🔊</button>
        <button id="gameResetViewBtn">视角归零</button>
      </div>
      <div class="stats">
        <span id="gameTime">⏱ 0.0s</span>
        <span id="gameScore">擦身×0</span>
        <span id="gameFps">FPS 0</span>
        <span id="gameObs">OBS 0</span>
        <span id="gameYawRate">yaw 0°/s</span>
      </div>
    </div>
    <div class="inputPanel" id="gameInputPanel">
      <div style="font-weight:700;color:#fff;margin-bottom:4px">输入灵敏度 v4.0</div>
      <label>水平 <input type="range" id="sensH" min="0.2" max="3.0" step="0.1" value="1.0"><span id="sensHVal">1.0</span></label>
      <label>垂直 <input type="range" id="sensV" min="0.2" max="3.0" step="0.1" value="1.0"><span id="sensVVal">1.0</span></label>
      <label>最大角速 <input type="range" id="maxRate" min="120" max="360" step="10" value="240"><span id="maxRateVal">240°/s</span></label>
      <label>惯性 <input type="range" id="inertia" min="0" max="1" step="0.05" value="0.15"><span id="inertiaVal">0.15</span></label>
      <div class="row"><button id="hideInputBtn" style="flex:1">隐藏</button></div>
    </div>
    <div class="centerAnnounce" id="gameAnnounce"></div>
    <div class="joystick" id="gameJoystick"><div class="knob" id="gameKnob"></div></div>
    <div class="lookZone" id="gameLookZone"></div>
    <div class="actionBtns">
      <button id="gameCrouchBtn">蹲</button>
      <button id="gameRollBtn">闪避</button>
      <button id="gameJumpBtn">跳</button>
    </div>
    <div class="resultPanel" id="gameResult">
      <h2>生存结束</h2>
      <div class="scores" id="gameResultScores"></div>
      <button id="gameRestartBtn">重开</button>
    </div>
    <div class="edgeArrow" id="gameEdgeArrow">▲</div>
    <div class="debugInfo" id="gameDebugInfo"></div>
  `;

  const announceEl = rootEl.querySelector("#gameAnnounce");
  const timeEl = rootEl.querySelector("#gameTime");
  const scoreEl = rootEl.querySelector("#gameScore");
  const fpsEl = rootEl.querySelector("#gameFps");
  const obsEl = rootEl.querySelector("#gameObs");
  const yawRateEl = rootEl.querySelector("#gameYawRate");
  const resultEl = rootEl.querySelector("#gameResult");
  const resultScoresEl = rootEl.querySelector("#gameResultScores");
  const edgeArrowEl = rootEl.querySelector("#gameEdgeArrow");
  const debugInfoEl = rootEl.querySelector("#gameDebugInfo");

  const topBarEl = rootEl.querySelector(".topBar");
  const exitBtn = rootEl.querySelector("#gameExitBtn");
  const modeBtn = rootEl.querySelector("#gameModeBtn");
  const debugBtn = rootEl.querySelector("#gameDebugBtn");
  const muteBtn = rootEl.querySelector("#gameMuteBtn");
  const resetViewBtn = rootEl.querySelector("#gameResetViewBtn");
  const crouchBtn = rootEl.querySelector("#gameCrouchBtn");
  const rollBtn = rootEl.querySelector("#gameRollBtn");
  const jumpBtn = rootEl.querySelector("#gameJumpBtn");
  const restartBtn = rootEl.querySelector("#gameRestartBtn");

  // 沉浸式：左上退出 3s 无操作淡到 25%
  let lastInteraction = performance.now();
  let fadeTimer = null;
  function resetFadeTimer() {
    lastInteraction = performance.now();
    if (topBarEl) topBarEl.style.opacity = "1";
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => {
      if (topBarEl) topBarEl.style.transition = "opacity 0.8s";
      if (topBarEl) topBarEl.style.opacity = "0.25";
    }, 3000);
  }
  ["touchstart","mousemove","click"].forEach(ev => {
    rootEl.addEventListener(ev, resetFadeTimer, { passive: true });
  });
  resetFadeTimer();

  // 输入面板
  const inputPanel = rootEl.querySelector("#gameInputPanel");
  const sensH = rootEl.querySelector("#sensH");
  const sensV = rootEl.querySelector("#sensV");
  const maxRate = rootEl.querySelector("#maxRate");
  const inertia = rootEl.querySelector("#inertia");
  const sensHVal = rootEl.querySelector("#sensHVal");
  const sensVVal = rootEl.querySelector("#sensVVal");
  const maxRateVal = rootEl.querySelector("#maxRateVal");
  const inertiaVal = rootEl.querySelector("#inertiaVal");
  const hideInputBtn = rootEl.querySelector("#hideInputBtn");

  let mode = "sandbox";
  let score = 0;
  let time = 0;
  let bestTime = 0;
  try { bestTime = parseFloat(localStorage.getItem("mmd_city_best") || "0") || 0; } catch (e) {}

  let announceQueue = [];
  let announceTimer = null;

  // 输入：v4.0 速度式
  const input = {
    moveX: 0, moveZ: 0,
    lookDX: 0, lookDY: 0,
    lookNormX: 0, lookNormY: 0,
    hasLook: false,
    clearLook: false,
    crouch: false, roll: false, jump: false, run: false,
    sensH: 1.0, sensV: 1.0, maxRate: 240, inertia: 0.15,
    resetView: false,
  };

  // 载入持久化
  try {
    const saved = JSON.parse(localStorage.getItem("game_input") || "null");
    if (saved) {
      if (typeof saved.sensH === "number") { input.sensH = saved.sensH; sensH.value = saved.sensH; }
      if (typeof saved.sensV === "number") { input.sensV = saved.sensV; sensV.value = saved.sensV; }
      if (typeof saved.maxRate === "number") { input.maxRate = saved.maxRate; maxRate.value = saved.maxRate; }
      if (typeof saved.inertia === "number") { input.inertia = saved.inertia; inertia.value = saved.inertia; }
    }
  } catch (e) {}
  function refreshLabels() {
    sensHVal.textContent = (+sensH.value).toFixed(1);
    sensVVal.textContent = (+sensV.value).toFixed(1);
    maxRateVal.textContent = maxRate.value + "°/s";
    inertiaVal.textContent = (+inertia.value).toFixed(2);
  }
  refreshLabels();
  function saveInput() {
    input.sensH = parseFloat(sensH.value);
    input.sensV = parseFloat(sensV.value);
    input.maxRate = parseFloat(maxRate.value);
    input.inertia = parseFloat(inertia.value);
    try { localStorage.setItem("game_input", JSON.stringify({ sensH: input.sensH, sensV: input.sensV, maxRate: input.maxRate, inertia: input.inertia })); } catch (e) {}
    refreshLabels();
  }
  sensH.addEventListener("input", saveInput);
  sensV.addEventListener("input", saveInput);
  maxRate.addEventListener("input", saveInput);
  inertia.addEventListener("input", saveInput);
  hideInputBtn.addEventListener("click", () => { inputPanel.style.display = "none"; });

  // 摇杆
  const joystickEl = rootEl.querySelector("#gameJoystick");
  const knobEl = rootEl.querySelector("#gameKnob");
  let joyActive = false;
  let joyId = null;
  function setJoystick(x, y) {
    const rect = joystickEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let dx = x - cx, dy = y - cy;
    const r = Math.hypot(dx, dy) || 1;
    const maxR = 55;
    if (r > maxR) { dx *= maxR / r; dy *= maxR / r; }
    knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    const nx = dx / maxR, ny = dy / maxR;
    input.moveX = nx;
    input.moveZ = -ny;
    input.run = Math.hypot(nx, ny) > 0.85;
  }
  joystickEl.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    joyId = t.identifier;
    joyActive = true;
    setJoystick(t.clientX, t.clientY);
    e.preventDefault();
  }, { passive: false });
  joystickEl.addEventListener("touchmove", (e) => {
    if (!joyActive) return;
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === joyId) { setJoystick(e.touches[i].clientX, e.touches[i].clientY); break; }
    }
    e.preventDefault();
  }, { passive: false });
  function endJoy(e) {
    let keep = false;
    for (let i = 0; i < e.touches.length; i++) if (e.touches[i].identifier === joyId) keep = true;
    if (!keep) {
      joyId = null; joyActive = false;
      input.moveX = 0; input.moveZ = 0; input.run = false;
      knobEl.style.transform = "translate(0,0)";
    }
  }
  joystickEl.addEventListener("touchend", endJoy);
  joystickEl.addEventListener("touchcancel", endJoy);

  // 视角区 — v4.0 速度式 + 死区 + 归零
  const lookZoneEl = rootEl.querySelector("#gameLookZone");
  let lookId = null, lastX = 0, lastY = 0;
  let accumulatedDX = 0, accumulatedDY = 0;
  lookZoneEl.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    // 多点互斥：若摇杆已激活且此触摸在左半屏，忽略
    if (joyActive) {
      // 检查是否在摇杆附近
      const joyRect = joystickEl.getBoundingClientRect();
      if (t.clientX < joyRect.right + 20 && t.clientY > joyRect.top - 20) return;
    }
    lookId = t.identifier;
    lastX = t.clientX; lastY = t.clientY;
    accumulatedDX = 0; accumulatedDY = 0;
    e.preventDefault();
  }, { passive: false });
  lookZoneEl.addEventListener("touchmove", (e) => {
    for (let i = 0; i < e.touches.length; i++) {
      const t = e.touches[i];
      if (t.identifier === lookId) {
        let dx = t.clientX - lastX, dy = t.clientY - lastY;
        lastX = t.clientX; lastY = t.clientY;
        // 死区 2px
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) { dx = 0; dy = 0; }
        if (dx === 0 && dy === 0) break;
        accumulatedDX += dx; accumulatedDY += dy;
        // 归一化：100px = 1.0，限幅 ±1
        const normX = Math.max(-1, Math.min(1, dx / 100));
        const normY = Math.max(-1, Math.min(1, dy / 100));
        input.lookNormX = normX;
        input.lookNormY = normY;
        input.hasLook = true;
        input.clearLook = false;
        break;
      }
    }
    e.preventDefault();
  }, { passive: false });
  function endLook(e) {
    let keep = false;
    for (let i = 0; i < e.touches.length; i++) if (e.touches[i].identifier === lookId) keep = true;
    if (!keep) {
      lookId = null;
      input.hasLook = false;
      input.clearLook = true;
      input.lookNormX = 0;
      input.lookNormY = 0;
      accumulatedDX = 0; accumulatedDY = 0;
    }
  }
  lookZoneEl.addEventListener("touchend", endLook);
  lookZoneEl.addEventListener("touchcancel", endLook);
  // pointercancel 也要
  lookZoneEl.addEventListener("pointercancel", endLook);

  // PC 鼠标 + 键盘：WASD/鼠标锁定/Shift跑/Space跳/Ctrl蹲/Q翻滚/Esc菜单
  let mouseDown = false;
  let pointerLocked = false;
  lookZoneEl.addEventListener("mousedown", (e) => {
    mouseDown = true; lastX = e.clientX; lastY = e.clientY;
    // 尝试 pointer lock
    try {
      if (lookZoneEl.requestPointerLock) lookZoneEl.requestPointerLock();
    } catch (err) {}
  });
  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === lookZoneEl;
  });
  window.addEventListener("mousemove", (e) => {
    let dx, dy;
    if (pointerLocked) {
      dx = e.movementX || 0; dy = e.movementY || 0;
    } else {
      if (!mouseDown) return;
      dx = e.clientX - lastX; dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
    }
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    // DPI 缩放
    const dpiScale = window.devicePixelRatio || 1;
    dx *= dpiScale; dy *= dpiScale;
    input.lookNormX = Math.max(-1, Math.min(1, dx / 100));
    input.lookNormY = Math.max(-1, Math.min(1, dy / 100));
    input.hasLook = true;
    input.clearLook = false;
    resetFadeTimer();
  });
  window.addEventListener("mouseup", () => {
    if (mouseDown) {
      mouseDown = false;
      if (!pointerLocked) {
        input.hasLook = false;
        input.clearLook = true;
      }
    }
  });
  // 键盘
  const keys = {};
  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    // 移动
    let mx = 0, mz = 0;
    if (keys["KeyW"]) mz += 1;
    if (keys["KeyS"]) mz -= 1;
    if (keys["KeyA"]) mx -= 1;
    if (keys["KeyD"]) mx += 1;
    const mag = Math.hypot(mx, mz) || 1;
    input.moveX = mx / mag;
    input.moveZ = mz / mag;
    if (keys["ShiftLeft"] || keys["ShiftRight"]) input.run = true;
    if (keys["ControlLeft"] || keys["ControlRight"]) input.crouch = true;
    if (e.code === "Space") { input.jump = true; setTimeout(() => input.jump = false, 100); }
    if (e.code === "KeyQ") { input.roll = true; setTimeout(() => input.roll = false, 100); }
    if (e.code === "Escape") {
      if (pointerLocked) { try { document.exitPointerLock(); } catch (err) {} }
      else { if (opts.onExit) opts.onExit(); }
    }
    resetFadeTimer();
  });
  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
    let mx = 0, mz = 0;
    if (keys["KeyW"]) mz += 1;
    if (keys["KeyS"]) mz -= 1;
    if (keys["KeyA"]) mx -= 1;
    if (keys["KeyD"]) mx += 1;
    const mag = Math.hypot(mx, mz) || 1;
    if (mx === 0 && mz === 0) { input.moveX = 0; input.moveZ = 0; }
    else { input.moveX = mx / mag; input.moveZ = mz / mag; }
    if (!keys["ShiftLeft"] && !keys["ShiftRight"]) input.run = false;
    if (!keys["ControlLeft"] && !keys["ControlRight"]) input.crouch = false;
  });

  // 按钮
  crouchBtn.addEventListener("touchstart", (e) => { input.crouch = true; e.preventDefault(); }, { passive: false });
  crouchBtn.addEventListener("touchend", (e) => { input.crouch = false; e.preventDefault(); }, { passive: false });
  crouchBtn.addEventListener("mousedown", () => { input.crouch = true; });
  crouchBtn.addEventListener("mouseup", () => { input.crouch = false; });
  rollBtn.addEventListener("click", () => { input.roll = true; setTimeout(() => input.roll = false, 100); });
  jumpBtn.addEventListener("click", () => { input.jump = true; setTimeout(() => input.jump = false, 100); });

  function say(text, duration = 2.2) {
    announceQueue.push({ text, duration });
    if (!announceTimer) processAnnounce();
  }
  function processAnnounce() {
    if (announceQueue.length === 0) { announceEl.classList.remove("show"); announceTimer = null; return; }
    const item = announceQueue.shift();
    announceEl.textContent = item.text;
    announceEl.classList.add("show");
    announceTimer = setTimeout(() => {
      announceEl.classList.remove("show");
      setTimeout(() => processAnnounce(), 150);
    }, item.duration * 1000);
  }

  function setMode(m) {
    mode = m;
    modeBtn.textContent = `模式: ${mode === "sandbox" ? "沙盒" : "生存"}`;
    if (opts.onModeChange) opts.onModeChange(mode);
  }
  modeBtn.addEventListener("click", () => { setMode(mode === "sandbox" ? "survival" : "sandbox"); });

  function showResult(survivalTime, nearCount) {
    if (mode !== "survival") return;
    const isNewBest = survivalTime > bestTime;
    if (isNewBest) { bestTime = survivalTime; try { localStorage.setItem("mmd_city_best", String(bestTime)); } catch (e) {} }
    resultScoresEl.innerHTML = `存活 ${survivalTime.toFixed(1)} 秒 · 擦身而过 ×${nearCount} · 最佳 ${bestTime.toFixed(1)} 秒${isNewBest ? " <b>新纪录!</b>" : ""}`;
    resultEl.classList.add("show");
  }
  function hideResult() { resultEl.classList.remove("show"); }
  restartBtn.addEventListener("click", () => { hideResult(); if (opts.onRestart) opts.onRestart(); });

  function updateDirectionIndicator(playerPos, giantPos, isSeeing) {
    if (!giantPos || !playerPos) { edgeArrowEl.classList.remove("show"); return; }
    const dx = giantPos.x - playerPos.x;
    const dz = giantPos.z - playerPos.z;
    const ang = Math.atan2(dx, dz);
    edgeArrowEl.style.left = "50%";
    edgeArrowEl.style.top = "60px";
    edgeArrowEl.style.transform = `translateX(-50%) rotate(${ang}rad)`;
    edgeArrowEl.classList.add("show");
    if (isSeeing) { edgeArrowEl.style.background = "rgba(255,30,30,0.95)"; edgeArrowEl.textContent = "!"; }
    else { edgeArrowEl.style.background = "rgba(255,80,80,0.7)"; edgeArrowEl.textContent = "▲"; }
  }

  function setScore(s) { score = s; scoreEl.textContent = `擦身×${score}`; }
  function setTime(t) { time = t; if (mode === "survival") timeEl.textContent = `⏱ ${t.toFixed(1)}s`; else timeEl.textContent = `沙盒`; }
  function addScore(delta) { score += delta; setScore(score); }
  function setDebugInfo(info) { debugInfoEl.textContent = info; }
  function setFps(fps) { fpsEl.textContent = `FPS ${fps.toFixed(0)}`; }
  function setObservers(n) { obsEl.textContent = `OBS ${n}`; }
  function setYawRate(rateDeg) { yawRateEl.textContent = `yaw ${rateDeg.toFixed(1)}°/s`; }

  exitBtn.addEventListener("click", () => { if (opts.onExit) opts.onExit(); });
  let muted = false;
  muteBtn.addEventListener("click", () => {
    muted = !muted; muteBtn.textContent = muted ? "🔇" : "🔊";
    if (opts.onMute) opts.onMute(muted);
  });
  let debugCollision = false;
  debugBtn.addEventListener("click", () => {
    debugCollision = !debugCollision;
    debugBtn.textContent = debugCollision ? "调试:开" : "碰撞调试";
    if (opts.onDebugToggle) opts.onDebugToggle(debugCollision);
  });
  resetViewBtn.addEventListener("click", () => { input.resetView = true; });

  return {
    get input() { return input; },
    get mode() { return mode; },
    say,
    setMode,
    setScore,
    setTime,
    addScore,
    showResult,
    hideResult,
    updateDirectionIndicator,
    setDebugInfo,
    setFps,
    setObservers,
    setYawRate,
    get debugCollision() { return debugCollision; },
    reset: () => { score = 0; time = 0; setScore(0); setTime(0); hideResult(); announceQueue.length = 0; },
  };
}

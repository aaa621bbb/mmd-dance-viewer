// game/hud.js — v5.2 输入重写：照抄探索模式数值级一致，单滑杆0.2-4 + 反转Y
import { CFG } from "./config.js";
import "./bjs.js";
import { Q } from "./quality.js";
const IS_PC_BUILD = (typeof IS_PC !== "undefined" && IS_PC) || (Q && Q.isPCBuild);
const GAME_TGT = (typeof GAME_TARGET !== "undefined") ? GAME_TARGET : (Q.gameTarget || "android");

export function createHud(rootEl, opts = {}) {
  if (!rootEl) {
    rootEl = document.createElement("div");
    rootEl.id = "gameUI";
    document.body.appendChild(rootEl);
  }

  const pcBadge = IS_PC_BUILD ? " [PC]" : "";
  const targetBadge = GAME_TGT ? ` ${GAME_TGT}` : "";
  rootEl.innerHTML = `
    <style>
      #gameUI { position: fixed; inset: 0; z-index: 100; pointer-events: none; font-family: -apple-system, sans-serif; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
      #gameUI .topBar { position: absolute; top: env(safe-area-inset-top, 0); left: 0; right: 0; height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 8px; background: rgba(22,25,31,0.85); border-bottom: 1px solid #555; pointer-events: auto; transition: opacity 0.8s; }
      #gameUI .topBar button { background: #2a2f3f; color: #fff; border: 1px solid #555; padding: 6px 10px; font-size: 12px; cursor: pointer; margin-right: 4px; }
      #gameUI .topBar .stats { color: #c9d1e0; font-size: 11px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      #gameUI .joystick { width: ${IS_PC_BUILD ? "140px" : "120px"}; height: ${IS_PC_BUILD ? "140px" : "120px"}; }
    </style>
      #gameUI .centerAnnounce { position: absolute; top: calc(80px + env(safe-area-inset-top, 0)); left: 50%; transform: translateX(-50%); color: #fff; font-size: 20px; font-weight: 700; text-shadow: 0 2px 8px rgba(0,0,0,0.8); pointer-events: none; opacity: 0; transition: opacity 0.15s; text-align: center; max-width: 80%; }
      #gameUI .centerAnnounce.show { opacity: 1; }
      #gameUI .joystick { position: absolute; left: calc(24px + env(safe-area-inset-left, 0)); bottom: calc(24px + env(safe-area-inset-bottom, 0)); width: 120px; height: 120px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.25); border-radius: 50%; pointer-events: auto; touch-action: none; }
      #gameUI .joystick .knob { position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 -26px; background: rgba(255,255,255,0.35); border-radius: 50%; }
      #gameUI .lookZone { position: absolute; right: 0; top: 0; bottom: 0; width: 52%; pointer-events: auto; touch-action: none; }
      #gameUI .actionBtns { position: absolute; right: calc(12px + env(safe-area-inset-right, 0)); bottom: calc(24px + env(safe-area-inset-bottom, 0)); display: flex; flex-direction: column; gap: 8px; pointer-events: auto; }
      #gameUI .actionBtns button { width: 64px; height: 64px; border-radius: 12px; border: 1px solid #555; background: rgba(40,46,58,0.88); color: #fff; font-size: 12px; font-weight: 700; }
      #gameUI .resultPanel { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); background: rgba(22,25,31,0.95); border: 1px solid #555; padding: 20px 24px; color: #fff; text-align: center; min-width: 280px; display: none; pointer-events: auto; }
      #gameUI .resultPanel.show { display: block; }
      #gameUI .edgeArrow { position: absolute; width: 24px; height: 24px; background: rgba(255,80,80,0.9); color: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; pointer-events: none; opacity: 0; transition: opacity 0.2s; }
      #gameUI .edgeArrow.show { opacity: 1; }
      #gameUI .debugInfo { position: absolute; top: calc(50px + env(safe-area-inset-top, 0)); right: calc(8px + env(safe-area-inset-right, 0)); color: #8ab4f8; font-size: 10px; background: rgba(0,0,0,0.5); padding: 4px 6px; pointer-events: none; max-width: 55%; text-align: right; }
      #gameUI .inputPanel { position: absolute; top: calc(52px + env(safe-area-inset-top, 0)); left: calc(8px + env(safe-area-inset-left, 0)); background: rgba(22,25,31,0.88); border: 1px solid #555; padding: 8px 10px; color: #c9d1e0; font-size: 11px; pointer-events: auto; min-width: 160px; }
      #gameUI .inputPanel label { display: flex; align-items: center; justify-content: space-between; margin: 4px 0; gap: 8px; }
      #gameUI .inputPanel input[type=range] { width: 90px; }
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
        <span id="gameYawRate">sens 1.0</span>
      </div>
    </div>
    <div class="inputPanel" id="gameInputPanel">
      <div style="font-weight:700;color:#fff;margin-bottom:4px">视角灵敏度 (照抄探索)</div>
      <label>灵敏度 <input type="range" id="sens" min="0.2" max="4.0" step="0.1" value="1.0"><span id="sensVal">1.0</span></label>
      <label>上下反转 <input type="checkbox" id="invertY"><span id="invertYVal">关</span></label>
      <div style="margin-top:6px;font-size:10px;color:#8aa">同一手势角度差≤10% vs 探索</div>
    </div>
    <div class="centerAnnounce" id="gameAnnounce"></div>
    <div class="joystick" id="gameJoystick"><div class="knob" id="gameKnob"></div></div>
    <div class="lookZone" id="gameLookZone"></div>
    <div class="actionBtns">
      <button id="gameCrouchBtn">蹲</button>
      <button id="gameRollBtn">闪避</button>
      <button id="gameJumpBtn">跳</button>
    </div>
    <div class="resultPanel" id="gameResult"><h2>生存结束</h2><div class="scores" id="gameResultScores"></div><button id="gameRestartBtn">重开</button></div>
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
  const inputPanel = rootEl.querySelector("#gameInputPanel");
  const sensEl = rootEl.querySelector("#sens");
  const sensVal = rootEl.querySelector("#sensVal");
  const invertYEl = rootEl.querySelector("#invertY");
  const invertYVal = rootEl.querySelector("#invertYVal");

  let mode = "sandbox";
  let score = 0, time = 0, bestTime = 0;
  try { bestTime = parseFloat(localStorage.getItem("mmd_city_best") || "0") || 0; } catch (e) {}
  let announceQueue = [], announceTimer = null;

  // 输入：照抄探索模式 expInput 模型
  const input = {
    moveX: 0, moveZ: 0,
    lookDX: 0, lookDY: 0,
    crouch: false, roll: false, jump: false, run: false,
    sens: 1.0, invertY: false,
    resetView: false,
  };

  try {
    const saved = JSON.parse(localStorage.getItem("game_look") || "null");
    if (saved) {
      if (typeof saved.sens === "number") { input.sens = saved.sens; sensEl.value = saved.sens; }
      if (typeof saved.invertY === "boolean") { input.invertY = saved.invertY; invertYEl.checked = saved.invertY; }
    }
  } catch (e) {}

  function refreshLabels() {
    sensVal.textContent = (+sensEl.value).toFixed(1);
    invertYVal.textContent = invertYEl.checked ? "开" : "关";
    yawRateEl.textContent = `sens ${(+sensEl.value).toFixed(1)}`;
  }
  refreshLabels();
  function saveInput() {
    input.sens = parseFloat(sensEl.value);
    input.invertY = !!invertYEl.checked;
    try { localStorage.setItem("game_look", JSON.stringify({ sens: input.sens, invertY: input.invertY })); } catch (e) {}
    refreshLabels();
  }
  sensEl.addEventListener("input", saveInput);
  invertYEl.addEventListener("change", saveInput);

  // 沉浸式 3s淡25%
  let fadeTimer = null;
  function resetFadeTimer() {
    if (topBarEl) topBarEl.style.opacity = "1";
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => {
      if (topBarEl) { topBarEl.style.transition = "opacity 0.8s"; topBarEl.style.opacity = "0.25"; }
    }, 3000);
  }
  ["touchstart","mousemove","click"].forEach(ev => rootEl.addEventListener(ev, resetFadeTimer, { passive: true }));
  resetFadeTimer();

  // 摇杆（代替WASD）
  const joystickEl = rootEl.querySelector("#gameJoystick");
  const knobEl = rootEl.querySelector("#gameKnob");
  let joyActive = false, joyId = null;
  function setJoystick(x, y) {
    const rect = joystickEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let dx = x - cx, dy = y - cy;
    const r = Math.hypot(dx, dy) || 1, maxR = 55;
    if (r > maxR) { dx *= maxR / r; dy *= maxR / r; }
    knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    const nx = dx / maxR, ny = dy / maxR;
    input.moveX = nx;
    input.moveZ = -ny;
    input.run = Math.hypot(nx, ny) > 0.85;
  }
  joystickEl.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    // 互斥：检查视角区是否已有触摸
    joyId = t.identifier; joyActive = true;
    setJoystick(t.clientX, t.clientY);
    e.preventDefault();
  }, { passive: false });
  joystickEl.addEventListener("touchmove", (e) => {
    if (!joyActive) return;
    for (let i = 0; i < e.touches.length; i++) if (e.touches[i].identifier === joyId) { setJoystick(e.touches[i].clientX, e.touches[i].clientY); break; }
    e.preventDefault();
  }, { passive: false });
  function endJoy(e) {
    let keep = false;
    for (let i = 0; i < e.touches.length; i++) if (e.touches[i].identifier === joyId) keep = true;
    if (!keep) { joyId = null; joyActive = false; input.moveX = 0; input.moveZ = 0; input.run = false; knobEl.style.transform = "translate(0,0)"; }
  }
  joystickEl.addEventListener("touchend", endJoy);
  joystickEl.addEventListener("touchcancel", endJoy);

  // 视角区 — 照抄探索：原始像素增量累积，不除100，不限±1，不每帧清零由player消费
  const lookZoneEl = rootEl.querySelector("#gameLookZone");
  let lookId = null, lastX = 0, lastY = 0;
  lookZoneEl.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    if (joyActive) {
      const joyRect = joystickEl.getBoundingClientRect();
      if (t.clientX < joyRect.right + 20 && t.clientY > joyRect.top - 20) return;
    }
    lookId = t.identifier; lastX = t.clientX; lastY = t.clientY;
    e.preventDefault();
  }, { passive: false });
  lookZoneEl.addEventListener("touchmove", (e) => {
    for (let i = 0; i < e.touches.length; i++) {
      const t = e.touches[i];
      if (t.identifier === lookId) {
        const dx = t.clientX - lastX, dy = t.clientY - lastY;
        lastX = t.clientX; lastY = t.clientY;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break;
        input.lookDX += dx;
        input.lookDY += dy;
        break;
      }
    }
    e.preventDefault();
  }, { passive: false });
  function endLook(e) {
    let keep = false;
    for (let i = 0; i < e.touches.length; i++) if (e.touches[i].identifier === lookId) keep = true;
    if (!keep) lookId = null;
  }
  lookZoneEl.addEventListener("touchend", endLook);
  lookZoneEl.addEventListener("touchcancel", endLook);
  lookZoneEl.addEventListener("pointercancel", endLook);

  // PC 鼠标 + 键盘
  let mouseDown = false, pointerLocked = false;
  lookZoneEl.addEventListener("mousedown", (e) => {
    mouseDown = true; lastX = e.clientX; lastY = e.clientY;
    try { if (lookZoneEl.requestPointerLock) lookZoneEl.requestPointerLock(); } catch (err) {}
  });
  document.addEventListener("pointerlockchange", () => { pointerLocked = document.pointerLockElement === lookZoneEl; });
  window.addEventListener("mousemove", (e) => {
    let dx, dy;
    if (pointerLocked) { dx = e.movementX || 0; dy = e.movementY || 0; }
    else { if (!mouseDown) return; dx = e.clientX - lastX; dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; }
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    input.lookDX += dx;
    input.lookDY += dy;
    resetFadeTimer();
  });
  window.addEventListener("mouseup", () => { mouseDown = false; });

  const keys = {};
  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    let mx = 0, mz = 0;
    if (keys["KeyW"]) mz += 1;
    if (keys["KeyS"]) mz -= 1;
    if (keys["KeyA"]) mx -= 1;
    if (keys["KeyD"]) mx += 1;
    const mag = Math.hypot(mx, mz) || 1;
    if (mx !== 0 || mz !== 0) { input.moveX = mx / mag; input.moveZ = mz / mag; } else { input.moveX = 0; input.moveZ = 0; }
    if (keys["ShiftLeft"] || keys["ShiftRight"]) input.run = true;
    if (keys["ControlLeft"] || keys["ControlRight"]) input.crouch = true;
    if (e.code === "Space") { input.jump = true; setTimeout(() => input.jump = false, 100); }
    if (e.code === "KeyQ") { input.roll = true; setTimeout(() => input.roll = false, 100); }
    if (e.code === "Escape") {
      if (pointerLocked) { try { document.exitPointerLock(); } catch (err) {} }
      else if (opts.onExit) opts.onExit();
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
    const dx = giantPos.x - playerPos.x, dz = giantPos.z - playerPos.z;
    const ang = Math.atan2(dx, dz);
    edgeArrowEl.style.left = "50%"; edgeArrowEl.style.top = "60px";
    edgeArrowEl.style.transform = `translateX(-50%) rotate(${ang}rad)`;
    edgeArrowEl.classList.add("show");
    edgeArrowEl.style.background = isSeeing ? "rgba(255,30,30,0.95)" : "rgba(255,80,80,0.7)";
    edgeArrowEl.textContent = isSeeing ? "!" : "▲";
  }
  function setScore(s) { score = s; scoreEl.textContent = `擦身×${score}`; }
  function setTime(t) { time = t; timeEl.textContent = mode === "survival" ? `⏱ ${t.toFixed(1)}s` : `沙盒`; }
  function addScore(delta) { score += delta; setScore(score); }
  function setDebugInfo(info) { debugInfoEl.textContent = info; }
  function setFps(fps) { fpsEl.textContent = `FPS ${fps.toFixed(0)}`; }
  function setObservers(n) { obsEl.textContent = `OBS ${n}`; }
  function setYawRate() {}
  exitBtn.addEventListener("click", () => { if (opts.onExit) opts.onExit(); });
  let muted = false;
  muteBtn.addEventListener("click", () => { muted = !muted; muteBtn.textContent = muted ? "🔇" : "🔊"; if (opts.onMute) opts.onMute(muted); });
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
    say, setMode, setScore, setTime, addScore, showResult, hideResult,
    updateDirectionIndicator, setDebugInfo, setFps, setObservers, setYawRate,
    get debugCollision() { return debugCollision; },
    reset: () => { score = 0; time = 0; setScore(0); setTime(0); hideResult(); announceQueue.length = 0; },
  };
}

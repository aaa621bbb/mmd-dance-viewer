import "./bjs.js";
// game/fx.js — 脚影/灰尘/震屏/慢动作/WebAudio 程序化合成
import { CFG, WORLD } from "./config.js";
import { u } from "./scale.js";
import { getAtlasRect } from "./atlas.js";

export function createFx(scene, opts = {}) {
  const BABYLON = (typeof window !== "undefined" && window.BABYLON) ? window.BABYLON : null;

  // 脚影贴片：一个 1×1 Plane 复用
  let footShadowMesh = null;
  let footShadowMat = null;

  if (BABYLON && scene) {
    try {
      const plane = BABYLON.MeshBuilder.CreatePlane("footShadow", { size: 1 }, scene);
      plane.rotation.x = Math.PI / 2;
      plane.isPickable = false;
      plane.renderingGroupId = 1;
      const mat = new BABYLON.StandardMaterial("footShadowMat", scene);
      mat.diffuseTexture = null;
      // 使用 atlas 软圆
      // 若 atlas 纹理已存在，用它；否则用程序化
      mat.diffuseColor = new BABYLON.Color3(0, 0, 0);
      mat.emissiveColor = new BABYLON.Color3(0, 0, 0);
      mat.specularColor = new BABYLON.Color3(0, 0, 0);
      mat.alpha = 0.5;
      mat.backFaceCulling = false;
      mat.useAlphaFromDiffuseTexture = true;
      plane.material = mat;
      plane.setEnabled(false);
      footShadowMesh = plane;
      footShadowMat = mat;
    } catch (e) {
      console.warn("[fx] footShadow failed", e);
    }
  }

  function updateFootShadow(footPos, sizeFactor, alpha, yaw) {
    if (!footShadowMesh) return;
    const footLen = WORLD.FOOT_A * 2;
    const size = footLen * sizeFactor;
    footShadowMesh.scaling.set(size, size, 1);
    footShadowMesh.position.set(footPos.x, 0.001, footPos.z);
    footShadowMesh.rotation.y = yaw;
    footShadowMat.alpha = alpha;
    footShadowMesh.setEnabled(true);
  }

  function hideFootShadow() {
    if (footShadowMesh) footShadowMesh.setEnabled(false);
  }

  // 灰尘：薄片 + 环
  const dustPool = [];
  function spawnDust(pos, intensity = 1) {
    if (!BABYLON || !scene) return;
    const count = Math.floor(CFG.DUST_N * intensity);
    for (let i = 0; i < count; i++) {
      try {
        const plane = BABYLON.MeshBuilder.CreatePlane(`dust_${Date.now()}_${i}`, { size: u(0.3) }, scene);
        plane.position.set(pos.x + (Math.random() - 0.5) * u(2), 0.01, pos.z + (Math.random() - 0.5) * u(2));
        plane.rotation.x = Math.PI / 2;
        plane.rotation.z = Math.random() * Math.PI * 2;
        const mat = new BABYLON.StandardMaterial(`dustMat_${i}`, scene);
        mat.diffuseColor = new BABYLON.Color3(0.6, 0.5, 0.4);
        mat.alpha = 0.6;
        mat.backFaceCulling = false;
        plane.material = mat;
        plane.isPickable = false;
        // 动画：0.6s 散开淡出
        const start = performance.now();
        const anim = () => {
          const elapsed = (performance.now() - start) / 1000;
          if (elapsed > 0.6) {
            plane.dispose();
            return;
          }
          const t = elapsed / 0.6;
          plane.position.x += (Math.random() - 0.5) * 0.01;
          plane.position.z += (Math.random() - 0.5) * 0.01;
          plane.scaling.set(1 + t * 2, 1 + t * 2, 1);
          mat.alpha = 0.6 * (1 - t);
          requestAnimationFrame(anim);
        };
        requestAnimationFrame(anim);
      } catch (e) {}
    }
    // 地面扩散环
    try {
      const ring = BABYLON.MeshBuilder.CreatePlane(`dustRing_${Date.now()}`, { size: u(1) }, scene);
      ring.position.set(pos.x, 0.002, pos.z);
      ring.rotation.x = Math.PI / 2;
      const mat = new BABYLON.StandardMaterial("ringMat", scene);
      mat.diffuseColor = new BABYLON.Color3(0.5, 0.45, 0.4);
      mat.alpha = 0.4;
      ring.material = mat;
      const start = performance.now();
      const anim = () => {
        const elapsed = (performance.now() - start) / 1000;
        if (elapsed > 0.6) { ring.dispose(); return; }
        const t = elapsed / 0.6;
        ring.scaling.set(1 + t * 5, 1 + t * 5, 1);
        mat.alpha = 0.4 * (1 - t);
        requestAnimationFrame(anim);
      };
      requestAnimationFrame(anim);
    } catch (e) {}
  }

  // 震屏
  let shakeTime = 0;
  let shakeAmp = 0;
  function shake(intensity, duration = CFG.SHAKE_T) {
    shakeTime = duration;
    shakeAmp = intensity * WORLD.SHAKE_A;
  }

  function updateShake(dt, camera) {
    if (shakeTime <= 0 || !camera) return;
    shakeTime -= dt;
    if (shakeTime <= 0) {
      shakeTime = 0;
      shakeAmp = 0;
      return;
    }
    const n = (Math.random() - 0.5) * 2;
    const m = (Math.random() - 0.5) * 2;
    camera.position.x += n * shakeAmp;
    camera.position.y += m * shakeAmp * 0.5;
    // 不动 rotation
  }

  // 慢动作
  let slowmoTime = 0;
  let slowmoScale = 1;
  function triggerSlowmo(scale = CFG.SLOWMO_SCALE, duration = CFG.SLOWMO_T) {
    slowmoTime = duration;
    slowmoScale = scale;
    if (opts.onSlowmo) opts.onSlowmo(scale);
  }
  function updateSlowmo(dt) {
    if (slowmoTime <= 0) return 1;
    slowmoTime -= dt;
    if (slowmoTime <= 0) {
      slowmoTime = 0;
      if (opts.onSlowmo) opts.onSlowmo(1);
      return 1;
    }
    return slowmoScale;
  }

  // 破坏视觉
  function crushBlock(bx, bz) {
    // 找到对应 tile 的建筑，进行 Y 缩放动画
    // 简化：直接隐藏或缩放
    // 实际应由 city.js 提供 mesh 引用，这里仅打日志
    console.log(`[fx] crush block ${bx},${bz}`);
  }

  function onStomp(footPos, hitType, d) {
    // 脚影闪白
    if (footShadowMesh) {
      footShadowMat.emissiveColor.set(1, 1, 1);
      setTimeout(() => {
        if (footShadowMat) footShadowMat.emissiveColor.set(0, 0, 0);
      }, 100);
    }
    // 灰尘
    spawnDust(footPos, hitType === "direct" ? 1.5 : 1);
    // 震屏
    const intensity = hitType === "direct" ? 1 : 0.5;
    shake(intensity);

    // 慢动作：擦身而过或近距离下落
    if (hitType === "near" || (d && d < 2)) {
      triggerSlowmo();
    }
  }

  function onDestruction(footPos, blocks) {
    // 额外特效：车压扁、消防栓喷水等
    spawnDust(footPos, 1.2);
  }

  // WebAudio 程序化合成
  let audioCtx = null;
  let masterGain = null;
  let compressor = null;
  let isMuted = false;

  function initAudio() {
    if (audioCtx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      masterGain = audioCtx.createGain();
      compressor = audioCtx.createDynamicsCompressor();
      masterGain.connect(compressor);
      compressor.connect(audioCtx.destination);
      masterGain.gain.value = 0.8;
      console.log("[fx] AudioContext created", audioCtx.sampleRate);
    } catch (e) {
      console.warn("[fx] AudioContext failed", e);
    }
  }

  function playFootstep(dist, isLeft, isFar = false) {
    if (!audioCtx || isMuted) return;
    try {
      const now = audioCtx.currentTime;
      // 距离衰减
      const att = 1 / (1 + dist / 300);
      if (att < 0.01) return;

      // 白噪声 → 低通 180Hz
      const bufferSize = Math.floor(audioCtx.sampleRate * 0.5);
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);

      const src = audioCtx.createBufferSource();
      src.buffer = buffer;
      const filter = audioCtx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 180;
      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(att * 0.5, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      // 低频冲击 45Hz
      const osc = audioCtx.createOscillator();
      osc.frequency.value = 45;
      const oscGain = audioCtx.createGain();
      oscGain.gain.setValueAtTime(0, now);
      oscGain.gain.linearRampToValueAtTime(att * 0.8, now + 0.02);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

      // 声像
      const panner = audioCtx.createStereoPanner();
      panner.pan.value = isLeft ? -0.3 : 0.3;

      src.connect(filter); filter.connect(gain); gain.connect(panner); panner.connect(masterGain);
      osc.connect(oscGain); oscGain.connect(panner);

      src.start(now);
      osc.start(now);
      osc.stop(now + 0.6);
    } catch (e) {}
  }

  function playHeartbeat(danger) {
    if (!audioCtx || isMuted) return;
    try {
      const now = audioCtx.currentTime;
      const interval = 1.4 - danger * 1.05; // 1.4s → 0.35s
      // 两下低频
      for (let k = 0; k < 2; k++) {
        const osc = audioCtx.createOscillator();
        osc.frequency.value = k === 0 ? 55 : 45;
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0, now + k * 0.18);
        gain.gain.linearRampToValueAtTime(0.6, now + k * 0.18 + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + k * 0.18 + 0.3);
        osc.connect(gain); gain.connect(masterGain);
        osc.start(now + k * 0.18);
        osc.stop(now + k * 0.18 + 0.3);
      }
    } catch (e) {}
  }

  function playGlassBreak(pos) {
    if (!audioCtx || isMuted) return;
    try {
      const now = audioCtx.currentTime;
      for (let i = 0; i < 3; i++) {
        const bufferSize = Math.floor(audioCtx.sampleRate * 0.2);
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let j = 0; j < bufferSize; j++) data[j] = (Math.random() * 2 - 1) * Math.exp(-j / (bufferSize * 0.2));
        const src = audioCtx.createBufferSource();
        src.buffer = buffer;
        const filter = audioCtx.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = 2000 + Math.random() * 4000;
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0, now + i * 0.05);
        gain.gain.linearRampToValueAtTime(0.3, now + i * 0.05 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.05 + 0.2);
        src.connect(filter); filter.connect(gain); gain.connect(masterGain);
        src.start(now + i * 0.05);
      }
    } catch (e) {}
  }

  function setMuted(m) {
    isMuted = !!m;
    if (masterGain) masterGain.gain.value = isMuted ? 0 : 0.8;
  }

  // 每帧更新
  function update(dt, camera, playerPos, giant) {
    updateShake(dt, camera);
    const scale = updateSlowmo(dt);
    // 心跳随危险度
    if (giant && playerPos) {
      const dist = Math.hypot(playerPos.x - giant.rootPos.x, playerPos.z - giant.rootPos.z);
      const danger = Math.max(0, 1 - dist / u(800));
      // 每隔 interval 播放心跳（由外部控制）
    }
    return { slowmoScale: scale };
  }

  return {
    update,
    updateFootShadow,
    hideFootShadow,
    onStomp,
    onDestruction,
    crushBlock,
    shake,
    triggerSlowmo,
    initAudio,
    playFootstep,
    playHeartbeat,
    playGlassBreak,
    setMuted,
    get audioCtx() { return audioCtx; },
  };
}

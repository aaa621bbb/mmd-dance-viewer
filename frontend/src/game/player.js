// game/player.js — 玩家控制器，PH尺度，速度式输入+指数衰减+限幅，v4.0 §1
import "./bjs.js";
import { CFG, WORLD } from "./config.js";
import { u } from "./scale.js";
import * as collide from "./collide.js";

export function createPlayer(scene, opts = {}) {
  const BABYLON = (typeof window !== "undefined" && window.BABYLON) ? window.BABYLON : null;

  const R = WORLD.RADIUS;
  const EYE = WORLD.EYE;
  const WALK = WORLD.WALK;
  const RUN = WORLD.RUN;
  const DASH = WORLD.DASH;
  const CROUCH = WORLD.CROUCH;
  const ACCEL = WORLD.ACCEL;
  const FRICTION = WORLD.FRICTION;
  const JUMP_V = WORLD.JUMP_V;

  let camera;
  if (BABYLON) {
    camera = new BABYLON.UniversalCamera("cityPlayerCam", new BABYLON.Vector3(0, EYE, 0), scene);
    camera.fov = 0.9;
    camera.minZ = 0.0005;
    camera.maxZ = 163;
    camera.inertia = 0;
  } else {
    camera = { position: { x: 0, y: EYE, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };
  }

  let pos = { x: 0, y: 0, z: 0 };
  let vel = { x: 0, y: 0, z: 0 };
  let vy = 0;
  let onGround = true;

  let yaw = 0;
  let pitch = 0;

  // 速度式相机：角速度
  let yawRate = 0; // rad/s
  let pitchRate = 0;
  let yawRateTarget = 0;
  let pitchRateTarget = 0;

  // 输入配置（可由HUD滑杆调节，localStorage持久化）
  let SENS_H = 1.0;
  let SENS_V = 1.0;
  let MAX_RATE_DEG = 240; // °/s
  let INERTIA = 0.15; // 0~1，0=跟手，1=很飘

  try {
    const saved = JSON.parse(localStorage.getItem("game_input") || "null");
    if (saved) {
      if (typeof saved.sensH === "number") SENS_H = saved.sensH;
      if (typeof saved.sensV === "number") SENS_V = saved.sensV;
      if (typeof saved.maxRate === "number") MAX_RATE_DEG = saved.maxRate;
      if (typeof saved.inertia === "number") INERTIA = saved.inertia;
    }
  } catch (e) {}

  function saveInputCfg() {
    try {
      localStorage.setItem("game_input", JSON.stringify({ sensH: SENS_H, sensV: SENS_V, maxRate: MAX_RATE_DEG, inertia: INERTIA }));
    } catch (e) {}
  }

  let isCrouching = false;
  let isRolling = false;
  let rollTime = 0;
  let rollDir = { x: 0, z: 0 };
  let rollCooldown = 0;
  let headBobPhase = 0;
  let landingShake = 0;

  let input = { moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0, lookNormX: 0, lookNormY: 0, hasLook: false, jump: false, crouch: false, roll: false, run: false };

  function findSpawn() {
    const rng = () => Math.random();
    for (let i = 0; i < 20; i++) {
      const ang = rng() * Math.PI * 2;
      const distPH = CFG.SPAWN_DIST_MIN + rng() * (CFG.SPAWN_DIST_MAX - CFG.SPAWN_DIST_MIN);
      const dist = u(distPH);
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      const y = collide.maxTopFace(x, z, R) || 0;
      const p = { x, y, z };
      if (!collide.insideAnyBox(p, u(1)) && !collide.hasCeiling(p, u(2)) && y !== null) return p;
    }
    return { x: 0, y: 0, z: u(10) };
  }

  function respawn() {
    const sp = findSpawn();
    pos = { ...sp };
    vel = { x: 0, y: 0, z: 0 };
    vy = 0;
    onGround = true;
    collide.setVy(0);
    collide.setOnGround(true);
    yaw = Math.atan2(-pos.x, -pos.z);
    pitch = 0;
    yawRate = 0; pitchRate = 0; yawRateTarget = 0; pitchRateTarget = 0;
    if (BABYLON && camera) {
      camera.position.set(pos.x, pos.y + (isCrouching ? EYE * 0.55 : EYE), pos.z);
      camera.rotation.set(pitch, yaw, 0);
    }
    return pos;
  }

  function resetView() {
    yawRate = 0; pitchRate = 0; yawRateTarget = 0; pitchRateTarget = 0;
    // 可选：视角归零到出生朝向
    yaw = Math.atan2(-pos.x, -pos.z);
    pitch = 0;
  }

  function update(dt, inp, giantPos = null, giantFeet = null) {
    dt = Math.min(0.05, dt);
    if (inp) {
      // 移动摇杆直接赋值
      if (typeof inp.moveX === "number") input.moveX = inp.moveX;
      if (typeof inp.moveZ === "number") input.moveZ = inp.moveZ;
      // 视角：支持两种输入——旧的 lookDX(像素累计) 和新的 lookNorm(归一化 -1..1)
      if (typeof inp.lookNormX === "number") {
        input.lookNormX = inp.lookNormX;
        input.lookNormY = inp.lookNormY || 0;
        input.hasLook = inp.hasLook !== undefined ? !!inp.hasLook : true;
      } else {
        // 兼容旧：像素增量转归一化
        if (inp.lookDX) {
          // 死区 2px
          if (Math.abs(inp.lookDX) >= 2) {
            input.lookNormX = Math.max(-1, Math.min(1, inp.lookDX / 100));
            input.hasLook = true;
          }
        }
        if (inp.lookDY) {
          if (Math.abs(inp.lookDY) >= 2) {
            input.lookNormY = Math.max(-1, Math.min(1, inp.lookDY / 100));
            input.hasLook = true;
          }
        }
      }
      if (typeof inp.crouch === "boolean") input.crouch = inp.crouch;
      if (inp.jump) input.jump = true;
      if (inp.roll) input.roll = true;
      if (typeof inp.run === "boolean") input.run = inp.run;
      if (typeof inp.sensH === "number") { SENS_H = inp.sensH; saveInputCfg(); }
      if (typeof inp.sensV === "number") { SENS_V = inp.sensV; saveInputCfg(); }
      if (typeof inp.maxRate === "number") { MAX_RATE_DEG = inp.maxRate; saveInputCfg(); }
      if (typeof inp.inertia === "number") { INERTIA = inp.inertia; saveInputCfg(); }
      if (inp.resetView) { resetView(); inp.resetView = false; }
      if (inp.clearLook) {
        // 松手：立即归零 target 与 rate，满足 v4.0 松手0.3s<1°/s 验收
        input.lookNormX = 0;
        input.lookNormY = 0;
        input.hasLook = false;
        yawRateTarget = 0;
        pitchRateTarget = 0;
        yawRate = 0;
        pitchRate = 0;
      }
    }

    // 速度式输入模型 §1.2
    const MAX_RATE_RAD = (MAX_RATE_DEG * Math.PI) / 180;
    const TAU = 0.05 + INERTIA * 0.25; // 跟手度：0.05~0.30
    const TAU_STOP = 0.04 + INERTIA * 0.08; // 松手后衰减：0.04~0.12，默认0.15→0.052s保证0.3s<1°/s

    if (input.hasLook) {
      yawRateTarget = input.lookNormX * SENS_H * MAX_RATE_RAD;
      pitchRateTarget = input.lookNormY * SENS_V * MAX_RATE_RAD;
    } else {
      yawRateTarget = 0;
      pitchRateTarget = 0;
    }

    // 指数平滑：rate += (target - rate) * (1 - exp(-dt/TAU))
    const alpha = 1 - Math.exp(-dt / Math.max(0.001, TAU));
    yawRate += (yawRateTarget - yawRate) * alpha;
    pitchRate += (pitchRateTarget - pitchRate) * alpha;

    // 松手后额外衰减
    if (!input.hasLook) {
      const decay = Math.exp(-dt / Math.max(0.001, TAU_STOP));
      yawRate *= decay;
      pitchRate *= decay;
      // 极小值归零，避免无限转
      if (Math.abs(yawRate) < 0.001) yawRate = 0;
      if (Math.abs(pitchRate) < 0.001) pitchRate = 0;
    }

    // 限幅
    yawRate = Math.max(-MAX_RATE_RAD, Math.min(MAX_RATE_RAD, yawRate));
    pitchRate = Math.max(-MAX_RATE_RAD, Math.min(MAX_RATE_RAD, pitchRate));

    yaw += yawRate * dt;
    pitch += pitchRate * dt;
    pitch = Math.max(-1.2, Math.min(1.2, pitch));

    // 清理本帧的 lookNorm（增量模型，下帧若无新输入则 hasLook=false）
    input.lookNormX = 0;
    input.lookNormY = 0;
    input.hasLook = false;

    if (giantFeet && giantPos) {
      const dist = Math.hypot(pos.x - giantPos.x, pos.z - giantPos.z);
      if (dist < u(400)) {
        const targetPitch = -0.15;
        pitch = pitch * 0.95 + targetPitch * 0.05;
      }
    }

    isCrouching = !!input.crouch;
    if (rollCooldown > 0) rollCooldown -= dt;
    if (input.roll && rollCooldown <= 0 && !isRolling) {
      isRolling = true;
      rollTime = CFG.ROLL_TIME;
      rollCooldown = CFG.ROLL_CD;
      const mag = Math.hypot(input.moveX, input.moveZ);
      if (mag > 0.1) {
        rollDir.x = input.moveX / mag;
        rollDir.z = input.moveZ / mag;
      } else {
        rollDir.x = Math.sin(yaw);
        rollDir.z = Math.cos(yaw);
      }
      input.roll = false;
    }

    let speed = WALK;
    if (input.run) speed = RUN;
    if (isCrouching) speed = CROUCH;
    if (isRolling) speed = DASH;

    let targetVX = 0, targetVZ = 0;
    if (isRolling) {
      targetVX = rollDir.x * speed;
      targetVZ = rollDir.z * speed;
    } else {
      const fwdX = Math.sin(yaw);
      const fwdZ = Math.cos(yaw);
      const rightX = Math.cos(yaw);
      const rightZ = -Math.sin(yaw);
      targetVX = (fwdX * input.moveZ + rightX * input.moveX) * speed;
      targetVZ = (fwdZ * input.moveZ + rightZ * input.moveX) * speed;
    }

    const accel = isRolling ? 100 : ACCEL;
    const friction = FRICTION;
    if (Math.abs(targetVX) > 0.01) vel.x += (targetVX - vel.x) * Math.min(1, accel * dt);
    else { vel.x *= Math.max(0, 1 - friction * dt); if (Math.abs(vel.x) < 0.001) vel.x = 0; }
    if (Math.abs(targetVZ) > 0.01) vel.z += (targetVZ - vel.z) * Math.min(1, accel * dt);
    else { vel.z *= Math.max(0, 1 - friction * dt); if (Math.abs(vel.z) < 0.001) vel.z = 0; }

    if (input.jump && onGround && !isCrouching && !isRolling) {
      vy = JUMP_V;
      onGround = false;
      collide.setVy(vy);
      collide.setOnGround(false);
      input.jump = false;
    }

    if (isRolling) {
      rollTime -= dt;
      if (rollTime <= 0) { isRolling = false; rollDir = { x: 0, z: 0 }; }
    }

    const disp = { x: vel.x * dt, z: vel.z * dt, y: 0 };
    if (!onGround) disp.y = vy;
    const newPos = collide.move(pos, disp, dt);
    vy = collide.getVy();
    onGround = collide.isOnGround();
    const prevY = pos.y;
    pos = newPos;
    if (prevY > pos.y + 0.01 && onGround) landingShake = 0.25;

    const moveMag = Math.hypot(vel.x, vel.z);
    if (moveMag > 0.01 && onGround && !isRolling) {
      const freq = moveMag > RUN * 0.8 ? 12 : 8;
      headBobPhase += dt * freq;
    } else {
      headBobPhase *= 0.9;
      if (Math.abs(headBobPhase) < 0.01) headBobPhase = 0;
    }

    const eyeH = isCrouching ? EYE * 0.55 : EYE;
    let camX = pos.x;
    let camY = pos.y + eyeH;
    let camZ = pos.z;
    if (headBobPhase !== 0) {
      const bobAmp = isCrouching ? u(0.01) : (moveMag > RUN * 0.8 ? u(0.04) : u(0.02));
      camY += Math.sin(headBobPhase) * bobAmp;
      camX += Math.cos(headBobPhase * 0.5) * bobAmp * 0.3;
    }
    if (landingShake > 0) {
      camY -= landingShake * u(0.05);
      landingShake -= dt * 2;
      if (landingShake < 0) landingShake = 0;
    }
    if (BABYLON && camera) {
      camera.position.set(camX, camY, camZ);
      camera.rotation.set(pitch, yaw, 0);
      const supportY = collide.maxTopFace(camX, camZ, R) || 0;
      if (camY < supportY + u(0.2)) camera.position.y = supportY + u(0.2);
    }

    return {
      pos: { ...pos },
      vel: { ...vel, y: vy },
      yaw, pitch,
      yawRate, pitchRate,
      yawRateDeg: (yawRate * 180) / Math.PI,
      onGround,
      isCrouching,
      isRolling,
      eyeH,
      camera,
    };
  }

  respawn();

  return {
    get pos() { return pos; },
    get vel() { return vel; },
    get camera() { return camera; },
    get yaw() { return yaw; },
    get pitch() { return pitch; },
    get yawRate() { return yawRate; },
    update,
    respawn,
    resetView,
    setInput: (inp) => { input = { ...input, ...inp }; },
    getState: () => ({ pos, vel, vy, onGround, isCrouching, isRolling, yaw, pitch, yawRate }),
    setSensitivity: (h, v, maxRate, inertia) => {
      if (typeof h === "number") SENS_H = h;
      if (typeof v === "number") SENS_V = v;
      if (typeof maxRate === "number") MAX_RATE_DEG = maxRate;
      if (typeof inertia === "number") INERTIA = inertia;
      saveInputCfg();
    },
    getInputCfg: () => ({ sensH: SENS_H, sensV: SENS_V, maxRate: MAX_RATE_DEG, inertia: INERTIA }),
  };
}

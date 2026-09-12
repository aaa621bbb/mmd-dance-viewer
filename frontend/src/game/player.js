// game/player.js — v5.2 输入模型：照抄探索模式 main.js:1210-1228 逐帧增量
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

  // 探索模式金标准：lookDX*0.006*sens clamp ±0.03*sens 逐帧累加，lookDY*0.004*sens
  let sens = 1.0;
  let invertY = false;
  try {
    const saved = JSON.parse(localStorage.getItem("game_look") || "null");
    if (saved) {
      if (typeof saved.sens === "number") sens = saved.sens;
      if (typeof saved.invertY === "boolean") invertY = saved.invertY;
    }
  } catch (e) {}
  function saveLook() {
    try { localStorage.setItem("game_look", JSON.stringify({ sens, invertY })); } catch (e) {}
  }

  let isCrouching = false;
  let isRolling = false;
  let rollTime = 0;
  let rollDir = { x: 0, z: 0 };
  let rollCooldown = 0;
  let headBobPhase = 0;
  let landingShake = 0;

  let input = { moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0, jump: false, crouch: false, roll: false, run: false };

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
    if (BABYLON && camera) {
      camera.position.set(pos.x, pos.y + (isCrouching ? EYE * 0.55 : EYE), pos.z);
      camera.rotation.set(pitch, yaw, 0);
    }
    return pos;
  }

  function resetView() {
    yaw = Math.atan2(-pos.x, -pos.z);
    pitch = 0;
  }

  // 供测试：同一手势角度差≤10% 验证
  function applyLookDelta(dx, dy, s = sens, inv = invertY) {
    const sensUse = s;
    let ddx = dx * 0.006 * sensUse;
    const lim = 0.03 * sensUse;
    if (ddx > lim) ddx = lim;
    if (ddx < -lim) ddx = -lim;
    yaw += ddx;
    if (dy !== 0) {
      let ddy = dy * 0.004 * sensUse;
      if (ddy > lim) ddy = lim;
      if (ddy < -lim) ddy = -lim;
      if (inv) ddy = -ddy;
      pitch += ddy;
      pitch = Math.max(-1.2, Math.min(1.2, pitch));
    }
    return { yaw, pitch, ddx };
  }

  function update(dt, inp, giantPos = null, giantFeet = null) {
    dt = Math.min(0.05, dt);
    let rawDX = 0, rawDY = 0;
    if (inp) {
      if (typeof inp.moveX === "number") input.moveX = inp.moveX;
      if (typeof inp.moveZ === "number") input.moveZ = inp.moveZ;
      if (typeof inp.lookDX === "number" && inp.lookDX !== 0) { input.lookDX += inp.lookDX; rawDX = inp.lookDX; inp.lookDX = 0; }
      if (typeof inp.lookDY === "number" && inp.lookDY !== 0) { input.lookDY += inp.lookDY; rawDY = inp.lookDY; inp.lookDY = 0; }
      // 兼容 HUD 直接传累计值：若 inp.lookDX 已是累计且我们刚已 +=，去重处理——HUD 新模型每次 touchmove +=dx 并把增量写入 input.lookDX，所以这里 inp.lookDX 本身就是增量
      // 另外支持 HUD input 对象整体替换
      if (typeof inp.crouch === "boolean") input.crouch = inp.crouch;
      if (inp.jump) input.jump = true;
      if (inp.roll) input.roll = true;
      if (typeof inp.run === "boolean") input.run = inp.run;
      if (typeof inp.sens === "number") { sens = inp.sens; saveLook(); }
      if (typeof inp.invertY === "boolean") { invertY = inp.invertY; saveLook(); }
      // 兼容旧字段 sensH/sensV/maxRate/inertia → 映射到 sens
      if (typeof inp.sensH === "number") { sens = inp.sensH; saveLook(); }
      if (inp.resetView) { resetView(); inp.resetView = false; }
    }

    // ——— 探索模式逐帧增量模型（main.js:1210-1228 照抄） ———
    // 每帧消费 input.lookDX/DY，然后清零，不做速度积分，不做归一化，不做惯性
    if (input.lookDX !== 0) {
      let ddx = input.lookDX * 0.006 * sens;
      const lim = 0.03 * sens;
      if (ddx > lim) ddx = lim;
      if (ddx < -lim) ddx = -lim;
      yaw += ddx;
    }
    if (input.lookDY !== 0) {
      let ddy = input.lookDY * 0.004 * sens;
      const lim = 0.03 * sens;
      if (ddy > lim) ddy = lim;
      if (ddy < -lim) ddy = -lim;
      if (invertY) ddy = -ddy;
      pitch += ddy;
      pitch = Math.max(-1.2, Math.min(1.2, pitch));
    }
    // 消费完毕清零，符合探索模式 expInput.lookDX=0 语义
    input.lookDX = 0;
    input.lookDY = 0;

    // 注意：v5.1 已删 pitch 被巨人距离<400PH拽回 -0.15 的恒真bug，此处不再回拉，满足“垂直拖0.5s松手1s pitch>0.3rad 且5s不回落”

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
      sens, invertY,
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
    update,
    respawn,
    resetView,
    applyLookDelta,
    setInput: (inp) => { input = { ...input, ...inp }; },
    getState: () => ({ pos, vel, vy, onGround, isCrouching, isRolling, yaw, pitch, sens, invertY }),
    setSensitivity: (s, inv) => {
      if (typeof s === "number") sens = s;
      if (typeof inv === "boolean") invertY = inv;
      saveLook();
    },
    getInputCfg: () => ({ sens, invertY }),
  };
}

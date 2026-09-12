import "./bjs.js";
// game/giant.js — 她的状态机 + 支撑脚接地驱动根位移 + 朝向
import { CFG, WORLD } from "./config.js";
import { u } from "./scale.js";

const BONE_NAMES = {
  head: ["頭", "首"],
  footL: ["左足首", "左足"],
  footR: ["右足首", "右足"],
  toeL: ["左つま先"],
  toeR: ["右つま先"],
  ikL: ["左足ＩＫ"],
  ikR: ["右足ＩＫ"],
  center: ["センター"],
  upper: ["上半身", "上半身2"],
  lower: ["下半身"],
  eyeL: ["左目"],
  eyeR: ["右目"],
  eyeBoth: ["両目"],
};

function findBone(skeleton, candidates) {
  if (!skeleton || !skeleton.bones) return null;
  for (const name of candidates) {
    const b = skeleton.bones.find(b => b.name === name);
    if (b) return b;
  }
  return null;
}

function getBoneWorldPos(bone) {
  if (!bone) return null;
  try {
    const mat = bone.getWorldMatrix ? bone.getWorldMatrix() : bone.getAbsoluteMatrix ? bone.getAbsoluteMatrix() : null;
    if (!mat) return null;
    return { x: mat.m[12], y: mat.m[13], z: mat.m[14] };
  } catch (e) {
    return null;
  }
}

export function createGiant(mmd, opts = {}) {
  const root = mmd.mesh || mmd.root || null;
  const skeleton = mmd.skeleton || (mmd.mmdModel && mmd.mmdModel.skeleton) || null;

  if (skeleton && skeleton.bones) {
    try { console.table(skeleton.bones.map(b => b.name)); } catch (e) {}
  }

  const bones = {
    head: findBone(skeleton, BONE_NAMES.head),
    footL: findBone(skeleton, BONE_NAMES.footL),
    footR: findBone(skeleton, BONE_NAMES.footR),
    toeL: findBone(skeleton, BONE_NAMES.toeL),
    toeR: findBone(skeleton, BONE_NAMES.toeR),
    ikL: findBone(skeleton, BONE_NAMES.ikL),
    ikR: findBone(skeleton, BONE_NAMES.ikR),
    center: findBone(skeleton, BONE_NAMES.center),
    upper: findBone(skeleton, BONE_NAMES.upper),
    lower: findBone(skeleton, BONE_NAMES.lower),
    eyeL: findBone(skeleton, BONE_NAMES.eyeL),
    eyeR: findBone(skeleton, BONE_NAMES.eyeR),
    eyeBoth: findBone(skeleton, BONE_NAMES.eyeBoth),
  };

  const missing = Object.entries(bones).filter(([k, v]) => !v).map(([k]) => k);
  if (missing.length) console.warn(`[giant] 缺少骨骼: ${missing.join(",")}，将降级`);

  let state = "idle";
  let stateTime = 0;
  let targetPos = null;

  // 支撑脚接地驱动：滚动最低点
  let prevFootL = null, prevFootR = null;
  let supportFoot = "left";
  let rootPos = { x: 0, y: 0, z: 0 };
  if (root && root.position) rootPos = { x: root.position.x, y: root.position.y, z: root.position.z };

  // 滚动窗口记录最近 2.5s 的最低 Y
  const footYHistory = []; // {t, yL, yR, min}
  const ROLL_WINDOW = 2.5; // s
  let currentMotion = "idle";

  let isSeeingPlayer = false;

  function feetWorld() {
    const fl = getBoneWorldPos(bones.footL) || getBoneWorldPos(bones.ikL);
    const fr = getBoneWorldPos(bones.footR) || getBoneWorldPos(bones.ikR);
    return { left: fl, right: fr };
  }

  function update(dt, playerPos, collide) {
    dt = Math.min(0.05, dt);
    stateTime += dt;

    const feet = feetWorld();
    const fl = feet.left, fr = feet.right;

    // 支撑脚接地驱动根位移（修复版：相对滚动最低点）
    if (fl && fr && root) {
      const now = performance.now() / 1000;
      footYHistory.push({ t: now, yL: fl.y, yR: fr.y, min: Math.min(fl.y, fr.y) });
      // 清理旧记录
      while (footYHistory.length && now - footYHistory[0].t > ROLL_WINDOW) footYHistory.shift();
      const rollingMin = footYHistory.length ? Math.min(...footYHistory.map(h => h.min)) : Math.min(fl.y, fr.y);
      const GROUND_TOL = u(0.5); // 0.5 PH 容差，允许脚在最低点附近算接地
      const isLNearGround = Math.abs(fl.y - rollingMin) < GROUND_TOL;
      const isRNearGround = Math.abs(fr.y - rollingMin) < GROUND_TOL;
      const airborne = !isLNearGround && !isRNearGround;

      // 只在走路时驱动根位移（避免 stomp 时乱动）
      const canDrive = currentMotion === "walk" || state === "approach";

      if (!airborne && canDrive) {
        const support = fl.y <= fr.y ? fl : fr;
        const supportPrev = fl.y <= fr.y ? prevFootL : prevFootR;
        const footName = fl.y <= fr.y ? "left" : "right";
        if (supportPrev) {
          const dx = support.x - supportPrev.x;
          const dz = support.z - supportPrev.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 3 && dist > 0.001) {
            const isSwitch = footName !== supportFoot;
            const factor = isSwitch ? 0.3 : 1;
            root.position.x -= dx * factor;
            root.position.z -= dz * factor;
            root.position.y = 0;
            rootPos.x = root.position.x;
            rootPos.z = root.position.z;
          }
        }
        supportFoot = footName;
      }
      prevFootL = fl ? { ...fl } : null;
      prevFootR = fr ? { ...fr } : null;
    }

    // 感知（v3 视锥，v4 全知在后续块重写，这里先保留但确保不会卡死）
    if (playerPos) {
      const eyePos = getBoneWorldPos(bones.head) || rootPos;
      const toPlayer = { x: playerPos.x - rootPos.x, y: playerPos.y - (eyePos ? eyePos.y : 10), z: playerPos.z - rootPos.z };
      const distPH = Math.hypot(toPlayer.x, toPlayer.z) / u(1);
      const forward = { x: Math.sin(root.rotation ? root.rotation.y : 0), z: Math.cos(root.rotation ? root.rotation.y : 0) };
      const dot = (toPlayer.x * forward.x + toPlayer.z * forward.z) / (Math.hypot(toPlayer.x, toPlayer.z) * Math.hypot(forward.x, forward.z) + 1e-6);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
      const effectiveRange = CFG.SENSE_RANGE;
      let blocked = false;
      if (collide && eyePos && collide.lineOfSightBlocked) {
        try { blocked = collide.lineOfSightBlocked(eyePos, playerPos, 2); } catch (e) {}
      }
      const canSee = distPH < effectiveRange && angle < CFG.SENSE_ANGLE && !blocked;
      isSeeingPlayer = canSee;
      if (canSee) targetPos = { ...playerPos };

      switch (state) {
        case "idle":
          if (canSee) { state = "approach"; stateTime = 0; setMotion("walk"); }
          break;
        case "approach":
          if (distPH < 300) { state = "stomp"; stateTime = 0; setMotion("stomp"); }
          else if (stateTime > 3 && !canSee) { state = "scan"; stateTime = 0; setMotion("idle"); }
          break;
        case "stomp":
          if (stateTime > 3) { state = "recover"; stateTime = 0; setMotion("walk"); }
          break;
        case "recover":
          if (stateTime > 0.6) {
            if (blocked) { state = "scan"; stateTime = 0; setMotion("idle"); }
            else { state = "approach"; stateTime = 0; setMotion("walk"); }
          }
          break;
        case "scan":
          if (canSee) { state = "approach"; stateTime = 0; setMotion("walk"); }
          else if (stateTime > 3) { state = "idle"; stateTime = 0; setMotion("idle"); }
          break;
      }

      if (state === "approach" || state === "stomp") {
        const desiredYaw = Math.atan2(toPlayer.x, toPlayer.z);
        let currentYaw = root.rotation ? root.rotation.y : 0;
        let diff = desiredYaw - currentYaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const maxTurn = degToRad(CFG.TURN_RATE) * dt;
        diff = Math.max(-maxTurn, Math.min(maxTurn, diff));
        if (root.rotation) root.rotation.y += diff;
      }
    }

    return { state, stateTime, rootPos: { ...rootPos }, feet: feetWorld(), isSeeingPlayer, targetPos };
  }

  function setMotion(slot) {
    currentMotion = slot;
    if (opts.onMotionChange) opts.onMotionChange(slot);
  }

  function getBones() { return bones; }
  function getRoot() { return root; }
  function degToRad(d) { return d * Math.PI / 180; }

  return {
    update,
    setMotion,
    getBones,
    getRoot,
    get state() { return state; },
    get rootPos() { return rootPos; },
    feet: feetWorld,
  };
}

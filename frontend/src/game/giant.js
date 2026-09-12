import "./bjs.js";
// game/giant.js — v4.0 全知追踪 + 姿态叠加 + 眼骨 + 视线调度 + 表情
// 规范 §5 全章

import { CFG, WORLD } from "./config.js";
import { u } from "./scale.js";

const BONE_NAMES = {
  head: ["頭", "首"],
  neck: ["首"],
  upper: ["上半身", "上半身2", "上半身1"],
  lower: ["下半身"],
  footL: ["左足首", "左足"],
  footR: ["右足首", "右足"],
  toeL: ["左つま先"],
  toeR: ["右つま先"],
  ikL: ["左足ＩＫ"],
  ikR: ["右足ＩＫ"],
  center: ["センター"],
  armL: ["左腕"],
  armR: ["右腕"],
  shoulderL: ["左肩"],
  shoulderR: ["右肩"],
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
  } catch (e) { return null; }
}

function degToRad(d) { return d * Math.PI / 180; }

export function createGiant(mmd, opts = {}) {
  const root = mmd.mesh || mmd.root || null;
  const skeleton = mmd.skeleton || (mmd.mmdModel && mmd.mmdModel.skeleton) || null;
  const mmdModel = mmd.mmdModel || null;

  const bones = {
    head: findBone(skeleton, BONE_NAMES.head),
    neck: findBone(skeleton, ["首"]),
    upper: findBone(skeleton, BONE_NAMES.upper),
    lower: findBone(skeleton, BONE_NAMES.lower),
    footL: findBone(skeleton, BONE_NAMES.footL),
    footR: findBone(skeleton, BONE_NAMES.footR),
    ikL: findBone(skeleton, BONE_NAMES.ikL),
    ikR: findBone(skeleton, BONE_NAMES.ikR),
    center: findBone(skeleton, BONE_NAMES.center),
    armL: findBone(skeleton, BONE_NAMES.armL),
    armR: findBone(skeleton, BONE_NAMES.armR),
    shoulderL: findBone(skeleton, BONE_NAMES.shoulderL),
    shoulderR: findBone(skeleton, BONE_NAMES.shoulderR),
    eyeL: findBone(skeleton, BONE_NAMES.eyeL),
    eyeR: findBone(skeleton, BONE_NAMES.eyeR),
    eyeBoth: findBone(skeleton, BONE_NAMES.eyeBoth),
  };

  const missing = Object.entries(bones).filter(([k, v]) => !v).map(([k]) => k);
  if (missing.length) console.warn(`[giant] 缺少骨骼: ${missing.join(",")}，降级`);

  // 状态机 v4.0：approach → stompNear(0.8s 100%锁定) → stomp → recover → approach
  let state = "approach";
  let stateTime = 0;
  let targetPos = null;

  // 支撑脚接地驱动
  let prevFootL = null, prevFootR = null;
  let supportFoot = "left";
  let rootPos = { x: 0, y: 0, z: 0 };
  if (root && root.position) rootPos = { x: root.position.x, y: root.position.y, z: root.position.z };
  const footYHistory = [];
  const ROLL_WINDOW = 2.5;
  let currentMotion = "idle";

  // v4.0 全知
  const knowsPlayer = true;
  let isSeeingPlayer = true; // 恒定知道，但表演上 isSeeing 用于 HUD

  // 低头姿态叠加：目标角度
  let targetHeadPitch = 0, targetNeckPitch = 0, targetUpperPitch = 0;
  let curHeadPitch = 0, curNeckPitch = 0, curUpperPitch = 0;
  const SMOOTH_TAU = 0.25; // 0.25s 平滑

  // 眼骨
  let eyeYaw = 0, eyePitch = 0;
  let targetEyeYaw = 0, targetEyePitch = 0;

  // 眨眼
  let blinkTimer = 0;
  let nextBlink = 3 + Math.random() * 2; // 3-5s
  let isBlinking = false;
  let blinkPhase = 0;

  // 视线调度
  let gazeState = "player"; // player, forward, side, feet
  let gazeTimer = 0;
  let gazeDuration = 1.5;
  let lastGazeSwitch = 0;

  // 表情 morph
  let morphTimer = 0;
  const morphNames = {
    blink: ["まばたき", "blink", "Blink"],
    smile: ["にこり", "笑い", "smile"],
    angry: ["怒り", "angry", "口角下げ"],
    troubled: ["困る", "troubled"],
  };

  function findMorph(nameList) {
    if (!mmdModel) return null;
    // babylon-mmd morph 存储在 mmdModel.morph? 尝试多种
    try {
      const morphs = mmdModel.morph?.morphs || mmdModel._morph?.morphs || [];
      for (const n of nameList) {
        const m = morphs.find(mm => mm.name === n || mm.morphName === n);
        if (m) return m;
      }
    } catch (e) {}
    return null;
  }

  function setMorphWeight(nameList, weight) {
    try {
      const morph = findMorph(nameList);
      if (morph && typeof morph.weight === "number") morph.weight = weight;
      else if (mmdModel && mmdModel.setMorphWeight) {
        for (const n of nameList) { try { mmdModel.setMorphWeight(n, weight); break; } catch (e) {} }
      }
    } catch (e) {}
  }

  function feetWorld() {
    const fl = getBoneWorldPos(bones.footL) || getBoneWorldPos(bones.ikL);
    const fr = getBoneWorldPos(bones.footR) || getBoneWorldPos(bones.ikR);
    return { left: fl, right: fr };
  }

  // 距离 → 低头角度表 §5.2
  function calcLookDown(distPH) {
    // 返回 {neck, head, upper} 度数
    if (distPH > 800) return { neck: 0, head: 0, upper: 0 };
    if (distPH > 400) return { neck: 3, head: 5, upper: 1 };
    if (distPH > 200) return { neck: 8, head: 14, upper: 3 };
    return { neck: 12, head: 22, upper: 6 };
  }

  // 视线调度表 §5.4
  function pickNextGaze(stateName, rng) {
    const r = rng();
    if (stateName === "stompNear") return "player"; // 100%锁定
    if (stateName === "stomp") return "feet";
    if (stateName === "recover") return r < 0.5 ? "side" : "player";
    if (stateName === "idle") return r < 0.3 ? "player" : "side";
    // approach: 45% player, 20% forward, 20% side, 15% feet
    if (r < 0.45) return "player";
    if (r < 0.65) return "forward";
    if (r < 0.85) return "side";
    return "feet";
  }

  function update(dt, playerPos, collide) {
    dt = Math.min(0.05, dt);
    stateTime += dt;
    gazeTimer += dt;
    blinkTimer += dt;
    morphTimer += dt;

    const feet = feetWorld();
    const fl = feet.left, fr = feet.right;

    // 支撑脚接地驱动根位移
    if (fl && fr && root) {
      const now = performance.now() / 1000;
      footYHistory.push({ t: now, yL: fl.y, yR: fr.y, min: Math.min(fl.y, fr.y) });
      while (footYHistory.length && now - footYHistory[0].t > ROLL_WINDOW) footYHistory.shift();
      const rollingMin = footYHistory.length ? Math.min(...footYHistory.map(h => h.min)) : Math.min(fl.y, fr.y);
      const GROUND_TOL = u(0.5);
      const isLNearGround = Math.abs(fl.y - rollingMin) < GROUND_TOL;
      const isRNearGround = Math.abs(fr.y - rollingMin) < GROUND_TOL;
      const airborne = !isLNearGround && !isRNearGround;
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

    // 全知追踪：永远知道玩家位置，无视遮挡
    if (playerPos) {
      targetPos = { ...playerPos };
      const toPlayer = { x: playerPos.x - rootPos.x, z: playerPos.z - rootPos.z };
      const distPH = Math.hypot(toPlayer.x, toPlayer.z) / u(1);
      const distWorld = Math.hypot(toPlayer.x, toPlayer.z);

      // 状态机 v4.0 循环
      switch (state) {
        case "approach":
          if (distPH < 200) {
            state = "stompNear";
            stateTime = 0;
            setMorphWeight(morphNames.angry, 0.5);
            // 视线 100%锁定
            gazeState = "player";
            gazeTimer = 0;
            gazeDuration = 0.8;
          }
          break;
        case "stompNear":
          if (stateTime >= 0.8) {
            state = "stomp";
            stateTime = 0;
            setMotion("stomp");
            setMorphWeight(morphNames.smile, 0.6);
          }
          break;
        case "stomp":
          if (stateTime > 2.5) {
            state = "recover";
            stateTime = 0;
            setMotion("walk");
            setMorphWeight(morphNames.troubled, 0.3);
          }
          break;
        case "recover":
          if (stateTime > 0.6) {
            state = "approach";
            stateTime = 0;
            setMotion("walk");
            setMorphWeight(morphNames.smile, 0.35);
            // 表情脉冲 0.6s 后清
            setTimeout(() => setMorphWeight(morphNames.smile, 0), 600);
          }
          break;
        default:
          state = "approach";
          stateTime = 0;
          setMotion("walk");
      }

      // 朝向：20°/s
      if (state === "approach" || state === "stompNear" || state === "stomp") {
        const desiredYaw = Math.atan2(toPlayer.x, toPlayer.z);
        let currentYaw = root.rotation ? root.rotation.y : 0;
        let diff = desiredYaw - currentYaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const maxTurn = degToRad(20) * dt;
        diff = Math.max(-maxTurn, Math.min(maxTurn, diff));
        if (root.rotation) root.rotation.y += diff;
      }

      // 低头角度计算
      const lookDown = calcLookDown(distPH);
      targetNeckPitch = degToRad(lookDown.neck);
      targetHeadPitch = degToRad(lookDown.head);
      targetUpperPitch = degToRad(lookDown.upper);

      // 视线调度：最小间隔 1.2s
      if (gazeTimer >= gazeDuration && stateTime - lastGazeSwitch >= 1.2) {
        const rng = () => Math.random();
        const next = pickNextGaze(state, rng);
        gazeState = next;
        gazeTimer = 0;
        gazeDuration = 1.0 + Math.random() * 1.5;
        lastGazeSwitch = stateTime;
      }

      // 眼球目标：根据 gazeState 计算
      let eyeTargetX = 0, eyeTargetZ = 0, eyeTargetY = 0;
      if (gazeState === "player") {
        eyeTargetX = toPlayer.x;
        eyeTargetZ = toPlayer.z;
        eyeTargetY = playerPos.y - (getBoneWorldPos(bones.head)?.y || 10);
      } else if (gazeState === "forward") {
        eyeTargetX = Math.sin(root.rotation ? root.rotation.y : 0) * 10;
        eyeTargetZ = Math.cos(root.rotation ? root.rotation.y : 0) * 10;
      } else if (gazeState === "side") {
        const sideAng = (Math.random() - 0.5) * Math.PI * 0.6;
        const fwdYaw = root.rotation ? root.rotation.y : 0;
        eyeTargetX = Math.sin(fwdYaw + sideAng) * 10;
        eyeTargetZ = Math.cos(fwdYaw + sideAng) * 10;
      } else if (gazeState === "feet") {
        eyeTargetX = toPlayer.x * 0.2;
        eyeTargetZ = toPlayer.z * 0.2;
        eyeTargetY = -5;
      }

      // 眼球角度：±15°水平，±10°垂直
      if (distWorld > 0.01) {
        const yawToTarget = Math.atan2(eyeTargetX, eyeTargetZ) - (root.rotation ? root.rotation.y : 0);
        let normYaw = yawToTarget;
        while (normYaw > Math.PI) normYaw -= Math.PI * 2;
        while (normYaw < -Math.PI) normYaw += Math.PI * 2;
        targetEyeYaw = Math.max(degToRad(-15), Math.min(degToRad(15), normYaw));
        targetEyePitch = Math.max(degToRad(-10), Math.min(degToRad(10), Math.atan2(eyeTargetY, distWorld)));
      }
    }

    // 平滑插值：四元数叠加 0.25s
    const alpha = 1 - Math.exp(-dt / SMOOTH_TAU);
    curNeckPitch += (targetNeckPitch - curNeckPitch) * alpha;
    curHeadPitch += (targetHeadPitch - curHeadPitch) * alpha;
    curUpperPitch += (targetUpperPitch - curUpperPitch) * alpha;

    // 眼球平滑：眼 0.15s，头 0.4s 已在上面用 TAU=0.25 统一，实际分开
    const eyeAlpha = 1 - Math.exp(-dt / 0.15);
    const headAlpha = 1 - Math.exp(-dt / 0.4);
    eyeYaw += (targetEyeYaw - eyeYaw) * eyeAlpha;
    eyePitch += (targetEyePitch - eyePitch) * eyeAlpha;

    // 应用到骨骼：用 rotationQuaternion 左乘增量，避免被动画覆盖
    try {
      const BABYLON = window.BABYLON;
      if (BABYLON) {
        // 头
        if (bones.head) {
          // 保存原始旋转？这里直接叠加 pitch
          // 由于 MMD 每帧会重算，我们每帧在 after 阶段叠加相对值
          // 简化：直接修改 rotation.x
          if (bones.head.rotation) {
            bones.head.rotation.x += (curHeadPitch - (bones.head._lastAddedPitch || 0));
            bones.head._lastAddedPitch = curHeadPitch;
          } else if (bones.head.rotationQuaternion) {
            // 四元数叠加
            const q = BABYLON.Quaternion.RotationYawPitchRoll(0, curHeadPitch - (bones.head._lastAddedPitch || 0), 0);
            bones.head.rotationQuaternion = bones.head.rotationQuaternion.multiply(q);
            bones.head._lastAddedPitch = curHeadPitch;
          }
        }
        if (bones.neck) {
          if (bones.neck.rotation) {
            bones.neck.rotation.x += (curNeckPitch - (bones.neck._lastAddedPitch || 0));
            bones.neck._lastAddedPitch = curNeckPitch;
          }
        }
        if (bones.upper) {
          if (bones.upper.rotation) {
            bones.upper.rotation.x += (curUpperPitch - (bones.upper._lastAddedPitch || 0));
            bones.upper._lastAddedPitch = curUpperPitch;
          }
        }
        // 眼骨
        if (bones.eyeL) {
          if (bones.eyeL.rotation) {
            bones.eyeL.rotation.y = eyeYaw;
            bones.eyeL.rotation.x = eyePitch;
          }
        }
        if (bones.eyeR) {
          if (bones.eyeR.rotation) {
            bones.eyeR.rotation.y = eyeYaw;
            bones.eyeR.rotation.x = eyePitch;
          }
        }
        if (bones.eyeBoth && !bones.eyeL) {
          if (bones.eyeBoth.rotation) {
            bones.eyeBoth.rotation.y = eyeYaw;
            bones.eyeBoth.rotation.x = eyePitch;
          }
        }
      }
    } catch (e) {
      // 忽略骨骼叠加失败
    }

    // 眨眼：まばたき 3-5s 一次，0.1s 闭合
    if (blinkTimer >= nextBlink) {
      isBlinking = true;
      blinkPhase = 0;
      blinkTimer = 0;
      nextBlink = 3 + Math.random() * 2;
    }
    if (isBlinking) {
      blinkPhase += dt / 0.1;
      if (blinkPhase >= 1) {
        isBlinking = false;
        blinkPhase = 0;
        setMorphWeight(morphNames.blink, 0);
      } else {
        const w = blinkPhase < 0.5 ? blinkPhase * 2 : (1 - blinkPhase) * 2;
        setMorphWeight(morphNames.blink, w);
      }
    }

    // 表情脉冲清理
    if (state === "stompNear" && stateTime > 0.8) {
      setMorphWeight(morphNames.angry, 0);
    }

    return {
      state,
      stateTime,
      rootPos: { ...rootPos },
      feet: feetWorld(),
      isSeeingPlayer,
      knowsPlayer,
      targetPos,
      gazeState,
      headPitchDeg: curHeadPitch * 180 / Math.PI,
      eyeYawDeg: eyeYaw * 180 / Math.PI,
      eyePitchDeg: eyePitch * 180 / Math.PI,
    };
  }

  function setMotion(slot) {
    currentMotion = slot;
    if (opts.onMotionChange) opts.onMotionChange(slot);
  }

  function getBones() { return bones; }
  function getRoot() { return root; }

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

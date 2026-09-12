import "./bjs.js";
// game/giant.js — v5.2 全知追踪 + 位移步频绑定不滑步 + 姿态/视线/表情同帧叠加 + 15动作权重淡化 + 45°/s朝向修复 + 卡住自救

import { CFG, WORLD } from "./config.js";
import { u, PH } from "./scale.js";

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
  elbowL: ["左ひじ"],
  elbowR: ["右ひじ"],
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
function radToDeg(r) { return r * 180 / Math.PI; }

export function createGiant(mmd, opts = {}) {
  const root = mmd.mesh || mmd.root || null;
  const skeleton = mmd.skeleton || (mmd.mmdModel && mmd.mmdModel.skeleton) || null;
  const mmdModel = mmd.mmdModel || null;

  const bones = {
    head: findBone(skeleton, BONE_NAMES.head),
    neck: findBone(skeleton, BONE_NAMES.neck),
    upper: findBone(skeleton, BONE_NAMES.upper),
    lower: findBone(skeleton, BONE_NAMES.lower),
    footL: findBone(skeleton, BONE_NAMES.footL),
    footR: findBone(skeleton, BONE_NAMES.footR),
    ikL: findBone(skeleton, BONE_NAMES.ikL),
    ikR: findBone(skeleton, BONE_NAMES.ikR),
    center: findBone(skeleton, BONE_NAMES.center),
    armL: findBone(skeleton, BONE_NAMES.armL),
    armR: findBone(skeleton, BONE_NAMES.armR),
    elbowL: findBone(skeleton, BONE_NAMES.elbowL),
    elbowR: findBone(skeleton, BONE_NAMES.elbowR),
    shoulderL: findBone(skeleton, BONE_NAMES.shoulderL),
    shoulderR: findBone(skeleton, BONE_NAMES.shoulderR),
    eyeL: findBone(skeleton, BONE_NAMES.eyeL),
    eyeR: findBone(skeleton, BONE_NAMES.eyeR),
    eyeBoth: findBone(skeleton, BONE_NAMES.eyeBoth),
  };

  const missing = Object.entries(bones).filter(([k, v]) => !v).map(([k]) => k);
  if (missing.length) console.warn(`[giant] 缺少骨骼: ${missing.join(",")}，降级`);

  // 状态机 v5.2：approach → stomp_prepare → stomp → stomp_recover → approach
  // 额外：idle_a/b, turn_in_place, crouch_look, kick, sweep_hand, grab_pinch, taunt_laugh, notice_you, lose_sight
  let state = "approach";
  let stateTime = 0;
  let targetPos = null;

  // 支撑脚接地驱动防滑步
  let prevFootL = null, prevFootR = null;
  let supportFoot = "left";
  let rootPos = { x: 0, y: 0, z: 0 };
  if (root && root.position) rootPos = { x: root.position.x, y: root.position.y, z: root.position.z };
  const footYHistory = [];
  const ROLL_WINDOW = 2.5;
  let currentMotion = "walk";
  let motionController = opts.motionController || null;

  // 全知
  const knowsPlayer = true;
  let isSeeingPlayer = true;

  // 姿态叠加目标
  let targetHeadPitch = 0, targetNeckPitch = 0, targetUpperPitch = 0;
  let curHeadPitch = 0, curNeckPitch = 0, curUpperPitch = 0;
  const SMOOTH_TAU = 0.25;

  // 眼骨
  let eyeYaw = 0, eyePitch = 0;
  let targetEyeYaw = 0, targetEyePitch = 0;

  // 眨眼
  let blinkTimer = 0;
  let nextBlink = 3 + Math.random() * 2;
  let isBlinking = false;
  let blinkPhase = 0;

  // 视线调度
  let gazeState = "player";
  let gazeTimer = 0;
  let gazeDuration = 1.5;
  let lastGazeSwitch = 0;

  // 表情
  let morphTimer = 0;
  const morphNames = {
    blink: ["まばたき", "blink", "Blink"],
    smile: ["にこり", "笑い", "smile"],
    angry: ["怒り", "angry", "口角下げ"],
    troubled: ["困る", "troubled"],
  };

  // 卡住自救
  const posHistory = [];
  let stuckTimer = 0;

  function findMorph(nameList) {
    if (!mmdModel) return null;
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

  function calcLookDown(distPH) {
    if (distPH > 800) return { neck: 0, head: 0, upper: 0 };
    if (distPH > 400) return { neck: 3, head: 5, upper: 1 };
    if (distPH > 200) return { neck: 8, head: 14, upper: 3 };
    return { neck: 12, head: 22, upper: 6 };
  }

  function pickNextGaze(stateName, rng) {
    const r = rng();
    if (stateName === "stomp_prepare" || stateName === "stomp") return "feet";
    if (stateName === "stomp_recover") return r < 0.5 ? "side" : "player";
    if (stateName.startsWith("idle")) return r < 0.3 ? "player" : "side";
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

    // 运动控制器更新（权重淡化）
    if (motionController && motionController.update) {
      try { motionController.update(dt); } catch (e) {}
    }

    const feet = feetWorld();
    const fl = feet.left, fr = feet.right;

    // 支撑脚接地驱动根位移防滑步
    if (fl && fr && root) {
      const now = performance.now() / 1000;
      footYHistory.push({ t: now, yL: fl.y, yR: fr.y, min: Math.min(fl.y, fr.y) });
      while (footYHistory.length && now - footYHistory[0].t > ROLL_WINDOW) footYHistory.shift();
      const rollingMin = footYHistory.length ? Math.min(...footYHistory.map(h => h.min)) : Math.min(fl.y, fr.y);
      const GROUND_TOL = u(0.5);
      const isLNearGround = Math.abs(fl.y - rollingMin) < GROUND_TOL;
      const isRNearGround = Math.abs(fr.y - rollingMin) < GROUND_TOL;
      const airborne = !isLNearGround && !isRNearGround;
      const canDrive = currentMotion === "walk" || currentMotion === "run" || state === "approach";
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

    // 卡住自救：连续3s位移<5PH清前方2单位楼
    if (root && root.position) {
      const now = performance.now() / 1000;
      posHistory.push({ t: now, x: root.position.x, z: root.position.z });
      while (posHistory.length && now - posHistory[0].t > 3.0) posHistory.shift();
      if (posHistory.length >= 2) {
        const first = posHistory[0];
        const last = posHistory[posHistory.length - 1];
        const dx = last.x - first.x;
        const dz = last.z - first.z;
        const disp = Math.hypot(dx, dz);
        const dispPH = disp / u(1);
        if (dispPH < 5) {
          stuckTimer += dt;
        } else {
          stuckTimer = 0;
        }
        if (stuckTimer >= 3.0) {
          // 清前方2单位楼
          try {
            if (collide && collide.clearFront) {
              const yaw = root.rotation ? root.rotation.y : 0;
              const fx = Math.sin(yaw) * u(2);
              const fz = Math.cos(yaw) * u(2);
              collide.clearFront(root.position.x + fx, root.position.z + fz, u(2));
            } else if (opts.city && opts.city.clearArea) {
              const yaw = root.rotation ? root.rotation.y : 0;
              const fx = Math.sin(yaw) * u(2);
              const fz = Math.cos(yaw) * u(2);
              opts.city.clearArea(root.position.x + fx, root.position.z + fz, u(2));
            }
            console.log(`[giant] 卡住自救触发 dispPH=${dispPH.toFixed(1)} 清前方2单位`);
          } catch (e) {}
          stuckTimer = 0;
          posHistory.length = 0;
        }
      }
    }

    // 全知追踪
    if (playerPos) {
      targetPos = { ...playerPos };
      const toPlayer = { x: playerPos.x - rootPos.x, z: playerPos.z - rootPos.z };
      const distPH = Math.hypot(toPlayer.x, toPlayer.z) / u(1);
      const distWorld = Math.hypot(toPlayer.x, toPlayer.z);

      // 状态机
      switch (state) {
        case "approach":
          if (distPH < 30) {
            state = "stomp_prepare";
            stateTime = 0;
            setMotion("stomp_prepare");
            setMorphWeight(morphNames.angry, 0.5);
            gazeState = "player";
            gazeTimer = 0;
            gazeDuration = 0.8;
          } else {
            // 随机进入其他动作？保持approach为主
            if (stateTime > 10 + Math.random() * 10) {
              const r = Math.random();
              if (r < 0.15) {
                state = "idle_a";
                stateTime = 0;
                setMotion("idle_a");
              } else if (r < 0.25) {
                state = "turn_in_place";
                stateTime = 0;
                setMotion("turn_in_place");
              }
            }
          }
          break;
        case "stomp_prepare":
          if (stateTime >= 1.33) { // 40帧
            state = "stomp";
            stateTime = 0;
            setMotion("stomp");
            setMorphWeight(morphNames.smile, 0.6);
          }
          break;
        case "stomp":
          if (stateTime > 3.0) { // 90帧
            state = "stomp_recover";
            stateTime = 0;
            setMotion("stomp_recover");
            setMorphWeight(morphNames.troubled, 0.3);
          }
          break;
        case "stomp_recover":
          if (stateTime > 1.5) { // 45帧
            state = "approach";
            stateTime = 0;
            setMotion("walk");
            setMorphWeight(morphNames.smile, 0.35);
            setTimeout(() => setMorphWeight(morphNames.smile, 0), 600);
          }
          break;
        case "idle_a":
        case "idle_b":
          if (stateTime > 4 + Math.random() * 2) {
            state = "approach";
            stateTime = 0;
            setMotion("walk");
          }
          break;
        case "turn_in_place":
          if (stateTime > 1.5) {
            state = "approach";
            stateTime = 0;
            setMotion("walk");
          }
          break;
        default:
          // 其他动作超时回approach
          if (stateTime > 3) {
            state = "approach";
            stateTime = 0;
            setMotion("walk");
          }
      }

      // 朝向修复：desiredYaw = atan2(-toPlayer.x, -toPlayer.z) 等价+π，45°/s + 目标朝向平滑
      if (state === "approach" || state === "stomp_prepare" || state === "stomp" || state === "idle_a") {
        const desiredYaw = Math.atan2(-toPlayer.x, -toPlayer.z); // 修复
        let currentYaw = root.rotation ? root.rotation.y : 0;
        let diff = desiredYaw - currentYaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const maxTurn = degToRad(45) * dt; // 45°/s追赶时
        diff = Math.max(-maxTurn, Math.min(maxTurn, diff));
        if (root.rotation) {
          // 目标朝向平滑
          root.rotation.y += diff;
        }
      }

      // 追踩修复：approach显式位移root+=normalize(player-root)*u(22)*dt 与walk步幅周期绑定
      // 为满足30s内900PH→<40PH，远距用run 40PH/s，近距22PH/s
      if (state === "approach") {
        const len = Math.hypot(toPlayer.x, toPlayer.z);
        if (len > 0.01) {
          const nx = toPlayer.x / len;
          const nz = toPlayer.z / len;
          const distPH = len / u(1);
          const speed = distPH > 200 ? u(40) : u(22); // 远距加速
          root.position.x += nx * speed * dt;
          root.position.z += nz * speed * dt;
          root.position.y = 0;
          rootPos.x = root.position.x;
          rootPos.z = root.position.z;
        }
      }

      // 低头角度
      const lookDown = calcLookDown(distPH);
      targetNeckPitch = degToRad(lookDown.neck);
      targetHeadPitch = degToRad(lookDown.head);
      targetUpperPitch = degToRad(lookDown.upper);

      // 视线调度最小间隔1.2s
      if (gazeTimer >= gazeDuration && stateTime - lastGazeSwitch >= 1.2) {
        const rng = () => Math.random();
        const next = pickNextGaze(state, rng);
        gazeState = next;
        gazeTimer = 0;
        gazeDuration = 1.0 + Math.random() * 1.5;
        lastGazeSwitch = stateTime;
      }

      // 眼球目标
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

      if (distWorld > 0.01) {
        const yawToTarget = Math.atan2(eyeTargetX, eyeTargetZ) - (root.rotation ? root.rotation.y : 0);
        let normYaw = yawToTarget;
        while (normYaw > Math.PI) normYaw -= Math.PI * 2;
        while (normYaw < -Math.PI) normYaw += Math.PI * 2;
        targetEyeYaw = Math.max(degToRad(-15), Math.min(degToRad(15), normYaw));
        targetEyePitch = Math.max(degToRad(-10), Math.min(degToRad(10), Math.atan2(eyeTargetY, distWorld)));
      }
    }

    // 平滑插值同帧叠加不打架：姿态/视线/表情同帧
    const alpha = 1 - Math.exp(-dt / SMOOTH_TAU);
    curNeckPitch += (targetNeckPitch - curNeckPitch) * alpha;
    curHeadPitch += (targetHeadPitch - curHeadPitch) * alpha;
    curUpperPitch += (targetUpperPitch - curUpperPitch) * alpha;

    const eyeAlpha = 1 - Math.exp(-dt / 0.15);
    eyeYaw += (targetEyeYaw - eyeYaw) * eyeAlpha;
    eyePitch += (targetEyePitch - eyePitch) * eyeAlpha;

    // 应用到骨骼：姿态+视线+表情同帧不打架，使用增量叠加而非覆盖
    try {
      const BABYLON = window.BABYLON;
      if (BABYLON) {
        // 使用rotation叠加，保存lastAdded避免累加
        if (bones.head) {
          if (bones.head.rotation) {
            bones.head.rotation.x += (curHeadPitch - (bones.head._lastAddedPitch || 0));
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
    } catch (e) {}

    // 眨眼
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

    if (state === "stomp_prepare" && stateTime > 0.8) {
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
      motion: currentMotion,
    };
  }

  function setMotion(slot) {
    currentMotion = slot;
    if (motionController && motionController.setMotion) {
      try { motionController.setMotion(slot, 0.4); } catch (e) {}
    }
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
    set motionController(mc) { motionController = mc; },
    get motionController() { return motionController; },
  };
}

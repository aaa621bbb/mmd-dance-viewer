import "./bjs.js";
// game/motions.js — v5.2 15支动作，运行时权重交叉淡化，不dispose重建

const MOTION_FILES = [
  "idle_a.vmd",
  "idle_b.vmd",
  "walk.vmd",
  "run.vmd",
  "turn_in_place.vmd",
  "stomp_prepare.vmd",
  "stomp.vmd",
  "stomp_recover.vmd",
  "crouch_look.vmd",
  "kick.vmd",
  "sweep_hand.vmd",
  "grab_pinch.vmd",
  "taunt_laugh.vmd",
  "notice_you.vmd",
  "lose_sight.vmd",
];

const MOTION_ALIAS = {
  idle: "idle_a",
  walk: "walk",
  run: "run",
  stomp: "stomp",
};

export async function loadDefaultMotions(scene) {
  const motions = {};
  for (const f of MOTION_FILES) {
    const key = f.replace(".vmd", "");
    motions[key] = null;
  }
  // 兼容旧名
  motions["idle"] = null;
  motions["walk"] = null;
  motions["stomp"] = null;

  const BABYLON = (typeof window !== "undefined" && window.BABYLON) ? window.BABYLON : null;
  if (!BABYLON) {
    console.warn("[motions] BABYLON not found");
    return motions;
  }

  let VmdLoader;
  try {
    const { VmdLoader: VL } = await import("babylon-mmd/esm/Loader/vmdLoader.js");
    VmdLoader = VL;
  } catch (e) {
    if (BABYLON.MMD && BABYLON.MMD.VmdLoader) VmdLoader = BABYLON.MMD.VmdLoader;
  }
  if (!VmdLoader) {
    console.warn("[motions] VmdLoader unavailable");
    return motions;
  }

  const loader = new VmdLoader(scene);
  const candidates = ["./game/motions/", "./motions/", "./dist/motions/", "/game/motions/"];

  for (const file of MOTION_FILES) {
    const key = file.replace(".vmd", "");
    let loaded = null;
    for (const base of candidates) {
      const url = base + file;
      try {
        const anim = await loader.loadAsync("motion", url);
        console.log(`[motions] loaded ${url} tracks=${anim.boneTracks?.length}`);
        loaded = anim;
        break;
      } catch (e) {}
    }
    motions[key] = loaded;
  }
  // 兼容
  motions["idle"] = motions["idle_a"] || motions["idle_b"];
  motions["walk"] = motions["walk"];
  motions["stomp"] = motions["stomp"];
  motions["run"] = motions["run"];

  return motions;
}

// v5.2 运行时权重交叉淡化控制器，不dispose重建
export function createMotionController(mmdModel, motions) {
  let composite = null;
  let runtime = null;
  let globalTime = 0;
  const active = new Map(); // slot -> {span, localTime, weight, targetWeight}
  let currentSlot = null;
  let fadeDuration = 0.4;
  let fadeTimer = 0;
  let fading = false;
  let fromSlot = null;
  let toSlot = null;

  let MCA, MAS, MCRMA;
  let ready = false;

  async function init() {
    if (ready) return;
    try {
      const mod1 = await import("babylon-mmd/esm/Runtime/Animation/mmdCompositeAnimation.js");
      const mod2 = await import("babylon-mmd/esm/Runtime/Animation/mmdCompositeRuntimeModelAnimation.js");
      MCA = mod1.MmdCompositeAnimation;
      MAS = mod1.MmdAnimationSpan;
      MCRMA = mod2.MmdCompositeRuntimeModelAnimation;
      composite = new MCA("giant-composite");
      runtime = MCRMA.Create(composite, mmdModel);
      mmdModel.setRuntimeAnimation(runtime);
      ready = true;
      console.log("[motions] composite runtime created");
    } catch (e) {
      console.warn("[motions] composite init failed, fallback single", e);
      ready = false;
    }
  }

  // 同步初始化尝试
  init();

  function ensureSlot(slot) {
    if (!ready || !composite || !MAS) return null;
    const anim = motions[slot] || motions[MOTION_ALIAS[slot]] || motions["idle_a"];
    if (!anim) return null;
    if (active.has(slot)) return active.get(slot);
    // 创建span，weight 0初始
    const span = new MAS(anim, undefined, undefined, 0, 0);
    composite.addSpan(span);
    const entry = { span, localTime: 0, weight: 0, targetWeight: 0, anim };
    active.set(slot, entry);
    return entry;
  }

  function setMotion(slot, fade = 0.4) {
    if (!slot) return;
    // 兼容旧名
    if (MOTION_ALIAS[slot]) slot = MOTION_ALIAS[slot];
    if (!motions[slot] && motions[MOTION_ALIAS[slot]]) slot = MOTION_ALIAS[slot];
    if (currentSlot === slot && !fading) return;

    fadeDuration = fade;
    fadeTimer = 0;
    fromSlot = currentSlot;
    toSlot = slot;
    fading = true;

    // 确保目标存在
    const toEntry = ensureSlot(slot);
    if (toEntry) {
      toEntry.targetWeight = 1;
      // localTime从0开始
      toEntry.localTime = 0;
      toEntry.span.offset = globalTime - toEntry.localTime;
      toEntry.span.weight = 0;
    }
    if (fromSlot) {
      const fromEntry = active.get(fromSlot);
      if (fromEntry) fromEntry.targetWeight = 0;
    } else {
      // 首次直接设1
      if (toEntry) {
        toEntry.weight = 1;
        toEntry.targetWeight = 1;
        toEntry.span.weight = 1;
        fading = false;
        currentSlot = slot;
        fromSlot = null;
        toSlot = null;
      }
    }

    // 兜底：若composite未就绪，用单动画
    if (!ready) {
      try {
        const anim = motions[slot] || motions["idle_a"];
        if (anim && mmdModel) {
          const handle = mmdModel.createRuntimeAnimation(anim);
          mmdModel.setRuntimeAnimation(handle);
          currentSlot = slot;
          fading = false;
        }
      } catch (e) {
        console.warn("[motions] fallback setMotion failed", e);
      }
    }
  }

  function update(dt) {
    if (!ready || !composite) return;
    globalTime += dt * 30; // MMD 30fps
    fadeTimer += dt;

    // 更新每个active的localTime和offset
    for (const [slot, entry] of active) {
      // 循环动作本地时间递增
      const isLoop = slot.startsWith("idle") || slot === "walk" || slot === "run" || slot === "taunt_laugh" || slot === "crouch_look";
      entry.localTime += dt * 30;
      const len = entry.anim ? (entry.anim.endFrame - entry.anim.startFrame) : 120;
      if (isLoop && len > 0) {
        if (entry.localTime >= len) entry.localTime %= len;
      } else {
        if (entry.localTime > len) entry.localTime = len;
      }
      entry.span.offset = globalTime - entry.localTime;
    }

    if (fading) {
      const t = Math.min(1, fadeTimer / fadeDuration);
      // ease: sin
      const ease = 0.5 - 0.5 * Math.cos(Math.PI * t);
      for (const [slot, entry] of active) {
        if (slot === fromSlot) {
          entry.weight = (1 - ease) * 1;
          entry.span.weight = entry.weight;
        } else if (slot === toSlot) {
          entry.weight = ease * 1;
          entry.span.weight = entry.weight;
        } else {
          // 其他渐出
          entry.weight = Math.max(0, entry.weight - dt * 2);
          entry.span.weight = entry.weight;
        }
      }
      if (t >= 1) {
        fading = false;
        // 清理权重为0的非当前
        for (const [slot, entry] of Array.from(active.entries())) {
          if (slot !== toSlot && entry.weight <= 0.01) {
            try { composite.removeSpan(entry.span); } catch (e) {}
            active.delete(slot);
          }
        }
        currentSlot = toSlot;
        fromSlot = null;
        toSlot = null;
        // 确保当前权重1
        const cur = active.get(currentSlot);
        if (cur) { cur.weight = 1; cur.span.weight = 1; cur.targetWeight = 1; }
      }
    } else {
      // 非淡化时保持当前权重1，其他0
      for (const [slot, entry] of active) {
        if (slot === currentSlot) {
          entry.weight = 1;
          entry.span.weight = 1;
        } else {
          entry.weight = 0;
          entry.span.weight = 0;
        }
      }
    }
  }

  return {
    setMotion,
    update,
    get current() { return currentSlot; },
    get composite() { return composite; },
    get runtime() { return runtime; },
  };
}

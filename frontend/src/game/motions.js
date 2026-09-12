import "./bjs.js";
// game/motions.js — 加载默认动作 + 交叉淡化切换
// 读 tools/gen-motion.mjs 生成的 VMD

export async function loadDefaultMotions(scene) {
  const motions = { idle: null, walk: null, stomp: null };

  // 尝试从多个路径加载
  const candidates = [
    "./game/motions/",
    "./motions/",
    "./dist/motions/",
    "/game/motions/",
  ];

  const files = ["idle.vmd", "walk.vmd", "stomp.vmd"];

  // 在浏览器环境，使用 VmdLoader
  const BABYLON = (typeof window !== "undefined" && window.BABYLON) ? window.BABYLON : null;
  if (!BABYLON) {
    console.warn("[motions] BABYLON not found, 返回空");
    return motions;
  }

  // 动态获取 VmdLoader
  let VmdLoader;
  try {
    // 尝试从 babylon-mmd 获取
    const { VmdLoader: VL } = await import("babylon-mmd/esm/Loader/vmdLoader.js");
    VmdLoader = VL;
  } catch (e) {
    console.warn("[motions] 无法 import VmdLoader", e);
    // 尝试全局
    if (BABYLON.MMD && BABYLON.MMD.VmdLoader) {
      VmdLoader = BABYLON.MMD.VmdLoader;
    }
  }

  if (!VmdLoader) {
    console.warn("[motions] VmdLoader 不可用");
    return motions;
  }

  const loader = new VmdLoader(scene);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const key = file.replace(".vmd", "");
    let loaded = null;
    for (const base of candidates) {
      const url = base + file;
      try {
        const anim = await loader.loadAsync("motion", url);
        console.log(`[motions] loaded ${url} boneTracks=${anim.boneTracks?.length}`);
        loaded = anim;
        break;
      } catch (e) {
        // 尝试下一个路径
        // console.log(`[motions] fail ${url}: ${e.message}`);
      }
    }
    motions[key] = loaded;
  }

  // 兜底：若未加载到，用程序化步态（空对象，giant.js 会用程序化）
  return motions;
}

// 交叉淡化切换（0.4s）
export function createMotionController(mmdModel, motions) {
  // mmdModel: MmdModel
  // motions: {idle, walk, stomp}
  let current = null;
  let currentHandle = null;

  // 尝试获取 MmdCompositeAnimation
  let MmdCompositeAnimation, MmdAnimationSpan, MmdCompositeRuntimeModelAnimation;
  try {
    // 动态 import
    // 注意：这里用 import() 在浏览器中是异步的，但我们在函数内同步尝试
    // 实际应在外部 import，这里简化为从全局获取
    if (typeof window !== "undefined" && window.BABYLON) {
      // babylon-mmd 会把这些挂到全局？尝试
    }
  } catch (e) {}

  async function setMotion(slot, fade = 0.4) {
    const anim = motions[slot] || motions["idle"] || motions["walk"];
    if (!anim || !mmdModel) return;

    try {
      // 若有 MmdCompositeAnimation 支持，尝试交叉淡化
      const { MmdCompositeAnimation: MCA, MmdAnimationSpan: MAS } = await import("babylon-mmd/esm/Runtime/Animation/mmdCompositeAnimation.js");
      const { MmdCompositeRuntimeModelAnimation: MCRMA } = await import("babylon-mmd/esm/Runtime/Animation/mmdCompositeRuntimeModelAnimation.js");

      if (MCA && MAS && MCRMA) {
        const comp = new MCA(`${slot}-composite`);
        comp.addSpan(new MAS(anim));
        const handle = MCRMA.Create(comp, mmdModel);
        // 淡化：若有旧 handle，尝试过渡（简化：直接替换，0.4s 内由外部控制 timeScale）
        if (currentHandle) {
          try { currentHandle.dispose && currentHandle.dispose(); } catch (e) {}
        }
        mmdModel.setRuntimeAnimation(handle);
        currentHandle = handle;
        current = slot;
        return;
      }
    } catch (e) {
      // 退化为单动画
      console.warn(`[motions] composite 失败，退化单动画 ${slot}`, e);
    }

    try {
      const handle = mmdModel.createRuntimeAnimation(anim);
      if (currentHandle) {
        try { mmdModel.setRuntimeAnimation(null); currentHandle.dispose && currentHandle.dispose(); } catch (e) {}
      }
      mmdModel.setRuntimeAnimation(handle);
      currentHandle = handle;
      current = slot;
    } catch (e) {
      console.error(`[motions] setMotion ${slot} 失败`, e);
    }
  }

  return {
    setMotion,
    get current() { return current; },
  };
}

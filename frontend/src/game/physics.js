import "./bjs.js";
// game/physics.js — 每模型物理标定 + 超长裙半物理档 v4.0 §7.2
// p99/median<3 判定，无尖峰

// 默认物理
const DEFAULT_PHYS = {
  substeps: 4,
  gravity: 9.8,
  damping: 0.25,
  maxLinearVel: 8,
  maxAngularVel: 6,
  iterations: 8,
};

// 每模型覆盖（可选，缺省用全局默认）
// 实际项目中可放在 assets/physics/<模型名>.json
const MODEL_OVERRIDES = {
  // 示例：长裙模型需要更高阻尼
  "三月七": { substeps: 4, damping: 0.35, iterations: 10, maxLinearVel: 6 },
  "流萤": { substeps: 4, damping: 0.3, iterations: 8 },
  "昔涟": { substeps: 6, damping: 0.4, iterations: 12, maxLinearVel: 5, halfPhysics: true }, // 超长礼服半物理
};

export function getPhysicsForModel(modelName) {
  if (!modelName) return DEFAULT_PHYS;
  for (const key in MODEL_OVERRIDES) {
    if (modelName.includes(key)) return { ...DEFAULT_PHYS, ...MODEL_OVERRIDES[key] };
  }
  return DEFAULT_PHYS;
}

// 自动采样裙摆骨骼相邻帧速度，判定抽搐 p99/median<3
export function checkClothStability(samples) {
  // samples: number[] 相邻帧速度
  if (!samples || samples.length < 10) return { ok: true, p99: 0, median: 0, ratio: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p99Idx = Math.floor(sorted.length * 0.99);
  const p99 = sorted[p99Idx] || sorted[sorted.length - 1];
  const ratio = median > 1e-6 ? p99 / median : 0;
  return { ok: ratio < 3, p99, median, ratio };
}

// 超长裙半物理：只保留贴身2-3条物理链，外面几层用跟随骨骼+阻尼平滑
export function applyHalfPhysics(skeleton) {
  if (!skeleton || !skeleton.bones) return;
  // 识别裙摆骨骼：名称含 裙/スカート/skirt/dress
  const skirtBones = skeleton.bones.filter(b => /裙|スカート|skirt|dress|裾/i.test(b.name));
  if (skirtBones.length > 6) {
    // 只保留前 2-3 条链有物理，其余禁用物理或提高阻尼
    // 这里简化：标记为 halfPhysics，后续在 setPhysics 中处理
    console.log(`[physics] 检测到超长裙 ${skirtBones.length} 根骨骼，启用半物理`);
    skirtBones.slice(3).forEach(b => {
      // 尝试禁用该骨骼的物理（通过刚体 mass=0 或 damping 极高）
      if (b._rigidBody) {
        try { b._rigidBody.mass = 0; } catch (e) {}
      }
    });
  }
}

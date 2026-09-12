import "./bjs.js";

// quality.js — 画质分级，唯一的开关是 Q.level
// v4.0 §3.1 三档 + PC 档
// L0 手机低配, L1 手机默认, L2 PC标准, L3 PC极致

const LEVELS = {
  L0: {
    level: "L0",
    triBudget: 120000,
    drawCallBudget: 60,
    shadowSize: 1024,
    shadowCascade: 1,
    atlasSize: 1024,
    atlasPadding: 4,
    tileScale: { asphalt: 8, sidewalk: 2, grass: 6 },
    buildingDetail: 0,
    streetFurnitureTypes: 4,
    carDetail: false,
    groundDetail: 0,
    enableBloom: false,
    enableSSAO: false,
    enableSSR: false,
    enableDoF: false,
    enableVolumetric: false,
    enableMotionBlur: false,
    substeps: 4,
  },
  L1: {
    level: "L1",
    triBudget: 250000,
    drawCallBudget: 110,
    shadowSize: 2048,
    shadowCascade: 1,
    atlasSize: 2048,
    atlasPadding: 4,
    tileScale: { asphalt: 8, sidewalk: 2, grass: 6 },
    buildingDetail: 1,
    streetFurnitureTypes: 12,
    carDetail: false,
    groundDetail: 1,
    enableBloom: true,
    enableSSAO: false,
    enableSSR: false,
    enableDoF: false,
    enableVolumetric: false,
    enableMotionBlur: false,
    substeps: 4,
  },
  L2: {
    level: "L2",
    triBudget: 800000,
    drawCallBudget: 300,
    shadowSize: 4096,
    shadowCascade: 2,
    atlasSize: 2048,
    atlasPadding: 4,
    tileScale: { asphalt: 8, sidewalk: 2, grass: 6 },
    buildingDetail: 2,
    streetFurnitureTypes: 12,
    carDetail: true,
    groundDetail: 2,
    enableBloom: true,
    enableSSAO: true,
    enableSSR: false,
    enableBloomACES: true,
    enableDoF: true,
    enableVolumetric: false,
    enableMotionBlur: false,
    substeps: 6,
  },
  L3: {
    level: "L3",
    triBudget: 2500000,
    drawCallBudget: 700,
    shadowSize: 4096,
    shadowCascade: 4,
    atlasSize: 4096,
    atlasPadding: 8,
    tileScale: { asphalt: 8, sidewalk: 2, grass: 6 },
    buildingDetail: 3,
    streetFurnitureTypes: 12,
    carDetail: true,
    groundDetail: 3,
    enableBloom: true,
    enableSSAO: true,
    enableSSR: true,
    enableBloomACES: true,
    enableDoF: true,
    enableVolumetric: true,
    enableMotionBlur: true,
    substeps: 8,
  },
};

function detectDefaultLevel() {
  try {
    // PC 检测：有鼠标+大屏
    const isPC = typeof navigator !== "undefined" && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && window.innerWidth > 1024;
    if (isPC) return "L2";
  } catch (e) {}
  return "L1";
}

let currentLevel = detectDefaultLevel();
try {
  const saved = localStorage.getItem("game_quality");
  if (saved && LEVELS[saved]) currentLevel = saved;
} catch (e) {}

export const Q = LEVELS[currentLevel];

export function setQuality(level) {
  if (!LEVELS[level]) return false;
  currentLevel = level;
  try { localStorage.setItem("game_quality", level); } catch (e) {}
  // 需要刷新才能完全生效（城市需重建）
  Object.assign(Q, LEVELS[level]);
  return true;
}

export function getQuality() { return Q; }
export function getLevel() { return currentLevel; }
export { LEVELS };

import "./bjs.js";
// quality.js — v5.2 画质分级，IS_PC/GAME_TARGET 真使用，L1≤300k L2≤800k，地面uvScale=24
const LEVELS = {
  L0: {
    level: "L0",
    triBudget: 200000,
    drawCallBudget: 60,
    shadowSize: 1024,
    shadowCascade: 1,
    atlasSize: 1024,
    atlasPadding: 4,
    tileScale: { asphalt: 24, sidewalk: 8, grass: 12 },
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
    triBudget: 300000,
    drawCallBudget: 110,
    shadowSize: 2048,
    shadowCascade: 1,
    atlasSize: 2048,
    atlasPadding: 4,
    tileScale: { asphalt: 24, sidewalk: 8, grass: 12 },
    buildingDetail: 1,
    streetFurnitureTypes: 6,
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
    tileScale: { asphalt: 24, sidewalk: 12, grass: 16 },
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
    tileScale: { asphalt: 24, sidewalk: 16, grass: 24 },
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
    // IS_PC 真使用：若构建时 IS_PC=true，强制 L2/L3，否则按屏幕判断
    if (typeof IS_PC !== "undefined" && IS_PC) {
      // PC 构建
      if (typeof GAME_TARGET !== "undefined" && GAME_TARGET === "pc") return "L2";
      return "L2";
    }
    if (typeof GAME_TARGET !== "undefined") {
      if (GAME_TARGET === "pc") return "L2";
      if (GAME_TARGET === "android") return "L1";
    }
    const isPC = typeof navigator !== "undefined" && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && typeof window !== "undefined" && window.innerWidth > 1024;
    if (isPC) return "L2";
  } catch (e) {}
  return "L1";
}

let currentLevel = detectDefaultLevel();
try {
  const saved = typeof localStorage !== "undefined" ? localStorage.getItem("game_quality") : null;
  if (saved && LEVELS[saved]) {
    // 若 IS_PC 构建，不允许降到 L0/L1 以下？允许用户覆盖，但记录
    currentLevel = saved;
  }
} catch (e) {}

export const Q = LEVELS[currentLevel] ? { ...LEVELS[currentLevel] } : { ...LEVELS.L1 };
// 保留 level 字段
Q.level = currentLevel;
// 额外暴露构建目标，供后处理/输入分支真使用
try {
  Q.isPCBuild = (typeof IS_PC !== "undefined") ? !!IS_PC : false;
  Q.gameTarget = (typeof GAME_TARGET !== "undefined") ? GAME_TARGET : "android";
} catch (e) {
  Q.isPCBuild = false;
  Q.gameTarget = "android";
}

export function setQuality(level) {
  if (!LEVELS[level]) return false;
  currentLevel = level;
  try { if (typeof localStorage !== "undefined") localStorage.setItem("game_quality", level); } catch (e) {}
  Object.assign(Q, LEVELS[level]);
  Q.level = level;
  return true;
}

export function getQuality() { return Q; }
export function getLevel() { return currentLevel; }
export { LEVELS };

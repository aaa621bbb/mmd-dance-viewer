import "./bjs.js";
// game/scale.js — 全项目唯一尺度入口, 禁裸数字
// PH = 玩家身高 (世界单位) = 现状 expEyeH 0.05 / 0.92 = 0.0543 锁定
export const PH = 0.0543;
export const u = (ph) => ph * PH;          // PH → 世界单位
export const inv = (units) => units / PH;  // 世界单位 → PH

export const PH_WALK = 3.0;
export const PH_RUN = 9.0;
export const PH_DASH = 20.0;

// 为了兼容旧 import 风格，也导出常用换算后的世界单位
export const SHE_UNITS = 20; // 她的模型高度世界单位
export const SHE_IN_PH = SHE_UNITS / PH; // ≈368

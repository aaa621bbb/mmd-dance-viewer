import "./bjs.js";
// game/config.js — 全部可调数值，全部用 PH 书写，经 u() 换算在运行时使用
// 规范 §13.1 常量总表 + §2.3 扩展
import { PH } from "./scale.js";

export const CFG = {
  // 尺度
  PH,
  SHE_UNITS: 20,
  SHE_IN_PH: 20 / PH, // ≈368

  // 玩家
  EYE: 0.92,          // PH
  RADIUS: 0.3,        // PH
  HEIGHT: 1.0,        // PH
  WALK: 3,            // PH/s
  RUN: 9,
  DASH: 20,
  CROUCH: 1.5,
  ACCEL: 40,          // PH/s²
  FRICTION: 60,       // PH/s²
  JUMP_V: 9,          // PH/s
  GRAVITY: 40,        // PH/s²
  ROLL_TIME: 0.3,     // s
  ROLL_IFRAME: 0.25,  // s
  ROLL_CD: 1.2,       // s
  STEP_MAX: 0.25,     // PH — 能一步踏上的最大高差
  SKIN: 0.02,         // PH — 皮肤厚度防抖

  // 城市
  CITY_SEED: 20260912,
  CITY_GRID: 28,          // 街区数 (每边)
  BLOCK_PITCH: 66,        // PH — 含街道
  ROAD_MAIN: 9,           // PH — 主干道车行道
  ROAD_SUB: 5.5,          // PH — 次干道车行道
  SIDEWALK: 1.6,          // PH — 人行道宽
  CURB_H: 0.094,          // PH — 路缘高差
  TILE_BLOCKS: 7,         // 每 tile 包含街区数 (7×7)
  CULL_DIST: 1400,        // PH — 手动剔除距离
  BUDGET_FAR: 25,         // PH — 远景相关
  BUDGET_NEAR: 12.5,
  FOG_DENSITY: 0.01,
  SKYLINE_R: 70,          // 世界单位 — 远景剪影环半径

  // 额外城市参数（施工图 §3.2 / §2.3）
  CITY_RADIUS: 62.5,      // 世界单位 — 城市半径 (由 GRID*PITCH/2 推导，写死便于剔除)
  TILE_SIZE_PH: 7 * 66,   // 462 PH = 25.08 世界单位
  // 路面
  ROAD_MAIN_TOTAL: 9 + 1.6 * 2,   // 含人行道总宽 PH
  ROAD_SUB_TOTAL: 5.5 + 1.6 * 2,

  // 她
  ANIM_SCALE: 0.35,
  TURN_RATE: 35,          // °/s
  SENSE_RANGE: 800,       // PH
  SENSE_ANGLE: 35,        // °
  LOSE_RANGE: 900,        // PH
  CROUCH_SENSE: 400,      // PH — 蹲下时检测距离
  FOOT_A: 28,             // PH — 脚掌椭圆半长
  FOOT_B: 11,             // PH — 半宽
  LAND_Y: 0.05,           // 世界单位 — 触地阈值
  LAND_V: 2.0,            // 世界单位/帧？ 规范写 2.0，取世界单位
  STOMP_CD: 0.8,          // s — 单脚冷却

  // 反馈
  SHAKE_A: 0.08,          // PH
  SHAKE_T: 0.25,          // s
  SLOWMO_SCALE: 0.25,
  SLOWMO_T: 0.5,

  // 性能
  DUST_N: 12,
  BLOOM: 0.5,
  SSAO: false,

  // 额外
  CENTER_SAFE_RADIUS: 2, // PH — 中心广场安全区
  SPAWN_DIST_MIN: 200,   // PH
  SPAWN_DIST_MAX: 300,   // PH
  GROUND_EPS: 0.1,       // PH — 双脚离地判定
  FOOT_LIFT: 1.2,        // PH — 摆动相抬脚高度
  FOOT_STEP: 4.4,        // 世界单位？原地走前后幅度 — 按规范用世界单位 4.4
};

// 辅助：把 CFG 里 PH 单位的数值换算成世界单位的表（运行时用）
import { u } from "./scale.js";
export const WORLD = {
  EYE: u(CFG.EYE),
  RADIUS: u(CFG.RADIUS),
  HEIGHT: u(CFG.HEIGHT),
  WALK: u(CFG.WALK),
  RUN: u(CFG.RUN),
  DASH: u(CFG.DASH),
  CROUCH: u(CFG.CROUCH),
  STEP_MAX: u(CFG.STEP_MAX),
  SKIN: u(CFG.SKIN),
  BLOCK_PITCH: u(CFG.BLOCK_PITCH),
  ROAD_MAIN: u(CFG.ROAD_MAIN),
  ROAD_SUB: u(CFG.ROAD_SUB),
  SIDEWALK: u(CFG.SIDEWALK),
  CURB_H: u(CFG.CURB_H),
  TILE_SIZE: u(CFG.TILE_SIZE_PH),
  CULL_DIST: u(CFG.CULL_DIST),
  FOOT_A: u(CFG.FOOT_A),
  FOOT_B: u(CFG.FOOT_B),
  SHAKE_A: u(CFG.SHAKE_A),
  GRAVITY: u(CFG.GRAVITY),
  JUMP_V: u(CFG.JUMP_V),
  ACCEL: u(CFG.ACCEL),
  FRICTION: u(CFG.FRICTION),
  EYE_PH: CFG.EYE,
  RADIUS_PH: CFG.RADIUS,
  HEIGHT_PH: CFG.HEIGHT,
  STEP_MAX_PH: CFG.STEP_MAX,
  SKIN_PH: CFG.SKIN,
};

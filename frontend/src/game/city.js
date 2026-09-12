import "./bjs.js";
// game/city.js — 城市生成器 v4.0 同源几何/碰撞 + 贴地统一
// 规范 §2 全章 + §4 atlas + §8 密度

import { CFG, WORLD } from "./config.js";
import { PH, u } from "./scale.js";
import { mulberry32, seedFor, randRange, randInt, choice } from "./rng.js";
import { GeoBatch } from "./geo.js";
import { buildAtlas, getAtlasRect } from "./atlas.js";
import { addBox as collideAddBox, clearWorld as collideClear, getBoxes as collideGetBoxes } from "./collide.js";
import { Q } from "./quality.js";

// hex 转 rgb 0-1
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}
function jitterColor(rgb, rng, amount = 0.06) {
  return rgb.map(c => {
    const j = (rng() - 0.5) * amount * 2;
    return Math.max(0, Math.min(1, c + j));
  });
}

// 分区色板 — 必须 .map(hexToRgb)
const ZONE_COLORS = {
  commercial: ["#6b7280", "#7c8794", "#4b5563"].map(hexToRgb),
  residential: ["#cbb79b", "#d8c7ae", "#b9a488"].map(hexToRgb),
  oldtown: ["#a98a63", "#9c7f5a", "#b99a72"].map(hexToRgb),
  park: ["#4f7d4a", "#5a8a55", "#3d6a38"].map(hexToRgb),
  construction: ["#8d8d8d", "#9a9a9a", "#7a7a7a"].map(hexToRgb),
  waterfront: ["#8a9aaa", "#7a8a9a", "#6b7a8a"].map(hexToRgb),
  plaza: ["#c2b8a8", "#d1c4b2", "#b8aa98"].map(hexToRgb),
};

const ZONE_PARAMS = {
  commercial: { hMin: 12, hMax: 25, density: 0.9, window: [0, 3], lightDensity: 0.8 },
  residential: { hMin: 7.5, hMax: 14, density: 0.6, window: [1, 2], lightDensity: 0.5 },
  oldtown: { hMin: 7.5, hMax: 12, density: 0.7, window: [2, 1], lightDensity: 0.5 },
  park: { hMin: 0, hMax: 0, density: 0, window: [], lightDensity: 0.1 },
  construction: { hMin: 3, hMax: 8, density: 0.3, window: [8, 11], lightDensity: 0.1 },
  waterfront: { hMin: 6, hMax: 15, density: 0.5, window: [0, 1], lightDensity: 0.4 },
  plaza: { hMin: 0, hMax: 0, density: 0, window: [], lightDensity: 0.6 },
};

function getZoneByAngle(angleDeg, rng) {
  const jitter = (rng() - 0.5) * 12;
  let a = angleDeg + jitter;
  while (a > 180) a -= 360;
  while (a <= -180) a += 360;
  if (a >= -90 && a < 10) return "commercial";
  if (a >= 10 && a < 110) return "residential";
  if (a >= 110 && a < 170) return "park";
  if (a >= 170 || a < -130) return "construction";
  if (a >= -130 && a < -90) return "waterfront";
  return "commercial";
}
function isMainRoad(index) { return index % 4 === 0; }

function generateBlocks(seed) {
  const blocks = [];
  const grid = CFG.CITY_GRID;
  const pitch = CFG.BLOCK_PITCH;
  for (let bx = 0; bx < grid; bx++) {
    for (let bz = 0; bz < grid; bz++) {
      const cxPH = (bx - grid / 2 + 0.5) * pitch;
      const czPH = (bz - grid / 2 + 0.5) * pitch;
      const cx = u(cxPH);
      const cz = u(czPH);
      const isCenterPlaza = (bx >= 13 && bx <= 14 && bz >= 13 && bz <= 14);
      const leftW = isMainRoad(bx) ? CFG.ROAD_MAIN_TOTAL : CFG.ROAD_SUB_TOTAL;
      const rightW = isMainRoad(bx + 1) ? CFG.ROAD_MAIN_TOTAL : CFG.ROAD_SUB_TOTAL;
      const bottomW = isMainRoad(bz) ? CFG.ROAD_MAIN_TOTAL : CFG.ROAD_SUB_TOTAL;
      const topW = isMainRoad(bz + 1) ? CFG.ROAD_MAIN_TOTAL : CFG.ROAD_SUB_TOTAL;
      const netWPH = pitch - (leftW + rightW) / 2;
      const netDPH = pitch - (bottomW + topW) / 2;
      const angle = Math.atan2(czPH, cxPH) * 180 / Math.PI;
      const blockRng = mulberry32(seedFor("block", bx, bz));
      let zone = getZoneByAngle(angle, blockRng);
      if (isCenterPlaza) zone = "plaza";
      if (zone === "residential" && blockRng() < 0.2) zone = "oldtown";
      blocks.push({
        bx, bz, cx, cz, cxPH, czPH,
        netW: u(netWPH), netD: u(netDPH), netWPH, netDPH,
        zone, isCenterPlaza,
        isMain: isMainRoad(bx) || isMainRoad(bz),
        leftW: u(leftW), rightW: u(rightW), bottomW: u(bottomW), topW: u(topW),
      });
    }
  }
  return blocks;
}

function createCityMaterial(scene, atlasTex, name = "cityMat") {
  try {
    const BABYLON = (typeof window !== "undefined" && window.BABYLON) ? window.BABYLON : null;
    if (!BABYLON) return null;
    const mat = new BABYLON.StandardMaterial(name, scene);
    if (atlasTex) {
      mat.diffuseTexture = atlasTex;
      mat.emissiveTexture = atlasTex;
      mat.emissiveColor = new BABYLON.Color3(0.6, 0.55, 0.45);
      mat.emissiveTexture.level = 0.5;
    }
    mat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    mat.backFaceCulling = false;
    mat.useVertexColor = true;
    return mat;
  } catch (e) { console.warn("[city] mat fail", e); return null; }
}

// ── 同源几何/碰撞核心 ──
// 旋转后 AABB
function rotatedAABB(x, z, W, D, yaw) {
  const hx = W / 2, hz = D / 2;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const corners = [
    [hx, hz], [-hx, hz], [-hx, -hz], [hx, -hz]
  ].map(([cx, cz]) => ({
    x: cx * cos - cz * sin,
    z: cx * sin + cz * cos,
  }));
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.z < minZ) minZ = c.z;
    if (c.z > maxZ) maxZ = c.z;
  }
  return { minX: x + minX, maxX: x + maxX, minZ: z + minZ, maxZ: z + maxZ };
}

// 统一贴地高度函数
function groundHeightAt(x, z, kind) {
  // kind 决定支撑面
  // 地面: 0, 人行道: CURB_H, 广场: 0.001, 屋顶: 传入的屋顶高度（外部决定）
  if (kind === "curb" || kind === "sidewalk") return 0; // curb 自身是地面上的盒子，底面0
  if (kind === "furn" || kind === "bench" || kind === "flower" || kind === "lamp" || kind === "tree" || kind === "trash" || kind === "hydrant" || kind === "busSign" || kind === "billboard" || kind === "guard" || kind === "pole" || kind === "signal" || kind === "sign") {
    return WORLD.CURB_H; // 街具在人行道上
  }
  if (kind === "car" || kind === "card") return WORLD.CURB_H; // 车在路面? 实际路面0，但为了贴地，我们让车底贴路面0，这里返回0更准确，车单独处理
  if (kind === "plaza") return 0.001;
  return 0;
}

// 单一权威：同时产出几何与碰撞
function addSolid(batch, x, z, W, D, H, yBase, yaw, rect, tint, kind, auditList, opts = {}) {
  // 几何：中心 y = yBase + H/2
  const cy = yBase + H / 2;
  batch.addBox(x, cy, z, W, H, D, yaw, rect, tint, opts);
  // 碰撞：旋转后包围盒
  const aabb2d = rotatedAABB(x, z, W, D, yaw);
  const box = {
    minX: aabb2d.minX, maxX: aabb2d.maxX,
    minY: yBase, maxY: yBase + H,
    minZ: aabb2d.minZ, maxZ: aabb2d.maxZ,
    kind: kind || "build",
    x, z, W, D, H, yBase, yaw,
  };
  collideAddBox(box);
  if (auditList) {
    auditList.push({
      type: kind, x, z, W, D, H, yBase, yaw,
      minX: box.minX, maxX: box.maxX, minY: box.minY, maxY: box.maxY, minZ: box.minZ, maxZ: box.maxZ,
      expectedYBase: yBase,
      diff: box.minY - yBase,
    });
  }
  return box;
}

function addBoxOnGround(batch, x, z, W, D, H, yBase, yaw, rect, tint, kind, auditList, opts) {
  return addSolid(batch, x, z, W, D, H, yBase, yaw, rect, tint, kind, auditList, opts);
}

// 圆柱类：几何圆柱 + 盒子碰撞（同源）
function addSolidCylinder(batch, x, z, r, H, yBase, seg, rect, tint, kind, auditList) {
  const cy = yBase;
  batch.addCylinder(x, cy, z, r, H, seg, rect, tint);
  const W = r * 2, D = r * 2;
  const box = {
    minX: x - r, maxX: x + r,
    minY: yBase, maxY: yBase + H,
    minZ: z - r, maxZ: z + r,
    kind: kind || "furn",
    x, z, W, D, H, yBase, yaw: 0,
  };
  collideAddBox(box);
  if (auditList) auditList.push({
    type: kind, x, z, W, D, H, yBase, yaw: 0,
    minX: box.minX, maxX: box.maxX, minY: box.minY, maxY: box.maxY, minZ: box.minZ, maxZ: box.maxZ,
    expectedYBase: yBase, diff: 0,
  });
  return box;
}

// 街具定义 — 12种+ (v4 §3.3)
const FURNITURE_DEFS = [
  { type: "lamp", spacing: 60, dist: 0.4, coll: true },
  { type: "tree", spacing: 45, dist: 0.5, coll: true },
  { type: "bench", spacing: 80, dist: 1.0, coll: true },
  { type: "trash", spacing: 90, dist: 0.9, coll: true },
  { type: "hydrant", spacing: 120, dist: 0.8, coll: true },
  { type: "busSign", spacing: 150, dist: 1.2, coll: true },
  { type: "flower", spacing: 100, dist: 1.0, coll: true },
  { type: "billboard", spacing: 110, dist: 0.9, coll: true },
  { type: "guard", spacing: 30, dist: 0.15, coll: true },
  { type: "pole", spacing: 70, dist: 0.7, coll: true },
  { type: "vending", spacing: 180, dist: 0.8, coll: true },
  { type: "mailbox", spacing: 200, dist: 0.7, coll: true },
];

function addFurniture(batch, def, x, z, yaw, rng, auditList) {
  const baseY = WORLD.CURB_H;
  const metalRect = getAtlasRect(8);
  const brickRect = getAtlasRect(6);
  const signRect = getAtlasRect(10);
  const grassRect = getAtlasRect(7);
  switch (def.type) {
    case "lamp": {
      const poleH = u(5), poleR = u(0.08);
      batch.addCylinder(x, baseY, z, poleR, poleH, 6, metalRect, [0.7, 0.7, 0.75]);
      const armLen = u(0.6);
      const armH = baseY + poleH - u(0.2);
      const armX = x + Math.cos(yaw) * armLen * 0.5;
      const armZ = z + Math.sin(yaw) * armLen * 0.5;
      batch.addBox(armX, armH, armZ, armLen, u(0.08), u(0.08), yaw, metalRect, [0.7, 0.7, 0.75]);
      const headX = x + Math.cos(yaw) * armLen;
      const headZ = z + Math.sin(yaw) * armLen;
      batch.addBox(headX, armH - u(0.1), headZ, u(0.6), u(0.2), u(0.3), yaw, signRect, [1, 0.9, 0.6]);
      addSolidCylinder(batch, x, z, poleR, poleH, baseY, 6, metalRect, [0.7, 0.7, 0.75], "furn", auditList);
      break;
    }
    case "tree": {
      const trunkH = u(2.4), trunkR = u(0.12);
      batch.addCylinder(x, baseY, z, trunkR, trunkH, 6, metalRect, [0.4, 0.25, 0.15]);
      const crownR = u(1.2);
      const tints = [[0.2, 0.5, 0.25], [0.25, 0.6, 0.3], [0.3, 0.55, 0.28]];
      for (let i = 0; i < 3; i++) {
        const cy = baseY + trunkH + u(0.3) + i * u(0.5);
        const r = crownR * (1 - i * 0.15);
        batch.addBox(x, cy, z, r * 2, r * 1.2, r * 2, 0, grassRect, tints[i]);
      }
      addSolidCylinder(batch, x, z, trunkR, trunkH, baseY, 6, metalRect, [0.4, 0.25, 0.15], "furn", auditList);
      break;
    }
    case "bench": {
      const sx = u(1.2), sy = u(0.45), sz = u(0.4);
      addSolid(batch, x, z, sx, sz, sy, baseY, yaw, brickRect, [0.6, 0.4, 0.3], "furn", auditList);
      break;
    }
    case "trash": {
      const r = u(0.25), h = u(0.7);
      addSolidCylinder(batch, x, z, r, h, baseY, 8, metalRect, [0.3, 0.3, 0.35], "furn", auditList);
      break;
    }
    case "hydrant": {
      const r = u(0.15), h = u(0.6);
      addSolidCylinder(batch, x, z, r, h, baseY, 6, metalRect, [0.9, 0.1, 0.1], "furn", auditList);
      break;
    }
    case "busSign": {
      const poleH = u(2.6);
      batch.addCylinder(x, baseY, z, u(0.05), poleH, 6, metalRect, [0.5, 0.5, 0.5]);
      batch.addBox(x, baseY + poleH - u(0.25), z, u(1.4), u(0.5), u(0.05), yaw, signRect, [0.2, 0.5, 0.9]);
      addSolidCylinder(batch, x, z, u(0.05), poleH, baseY, 6, metalRect, [0.5, 0.5, 0.5], "furn", auditList);
      break;
    }
    case "flower": {
      const sx = u(1.5), sy = u(0.4), sz = u(1.5);
      addSolid(batch, x, z, sx, sz, sy, baseY, 0, brickRect, [0.6, 0.5, 0.4], "furn", auditList);
      batch.addBox(x, baseY + sy + u(0.15), z, u(0.8), u(0.3), u(0.8), 0, grassRect, [0.3, 0.7, 0.4]);
      break;
    }
    case "billboard": {
      const sx = u(1.2), sy = u(2.0), sz = u(0.3);
      // 根据 yaw 决定 W/D
      const W = (Math.abs(Math.cos(yaw)) > Math.abs(Math.sin(yaw))) ? sx : sz;
      const D = (Math.abs(Math.cos(yaw)) > Math.abs(Math.sin(yaw))) ? sz : sx;
      // 实际盒子：长度 sx，厚度 sz，yaw 旋转
      addSolid(batch, x, z, sx, sz, sy, baseY, yaw, signRect, [1, 1, 1], "furn", auditList);
      break;
    }
    case "guard": {
      const len = u(1.5), h = u(0.5), thick = u(0.1);
      // guard 沿 yaw 方向长 len，厚 thick
      const W = Math.abs(Math.cos(yaw)) * len + Math.abs(Math.sin(yaw)) * thick;
      const D = Math.abs(Math.sin(yaw)) * len + Math.abs(Math.cos(yaw)) * thick;
      // 用 addSolid 旋转
      addSolid(batch, x, z, len, thick, h, baseY, yaw, metalRect, [0.8, 0.8, 0.85], "furn", auditList);
      break;
    }
    case "pole": {
      const poleH = u(6), r = u(0.15);
      addSolidCylinder(batch, x, z, r, poleH, baseY, 6, metalRect, [0.5, 0.5, 0.5], "furn", auditList);
      break;
    }
    case "vending": {
      const w = u(0.8), d = u(0.6), h = u(1.6);
      addSolid(batch, x, z, w, d, h, baseY, yaw, signRect, [0.9, 0.2, 0.2], "furn", auditList);
      break;
    }
    case "mailbox": {
      const w = u(0.5), d = u(0.4), h = u(1.0);
      addSolid(batch, x, z, w, d, h, baseY, yaw, metalRect, [0.2, 0.4, 0.9], "furn", auditList);
      break;
    }
    default: break;
  }
}

// 车型 6种分件
const CAR_TYPES = [
  { name: "sedan", len: 2.8, wid: 1.1, h: 0.9, color: [0.8, 0.1, 0.1] },
  { name: "taxi", len: 2.8, wid: 1.1, h: 0.9, color: [0.95, 0.85, 0.1] },
  { name: "bus", len: 6.0, wid: 1.6, h: 1.8, color: [0.9, 0.9, 0.9] },
  { name: "truck", len: 4.5, wid: 1.5, h: 1.5, color: [0.3, 0.3, 0.35] },
  { name: "ambulance", len: 3.2, wid: 1.2, h: 1.2, color: [1, 1, 1] },
  { name: "police", len: 2.9, wid: 1.15, h: 0.95, color: [0.1, 0.1, 0.8] },
];

function addCar(batch, x, z, yaw, rng, auditList) {
  const carDef = choice(rng, CAR_TYPES);
  const len = u(carDef.len), wid = u(carDef.wid), h = u(carDef.h);
  const tint = carDef.color;
  const metalRect = getAtlasRect(8);
  const glassRect = getAtlasRect(9);
  const signRect = getAtlasRect(10);
  const baseY = 0;
  addSolid(batch, x, z, len, wid, h, baseY, yaw, metalRect, tint, "car", auditList);
  // 分件：车顶/车窗/灯/轮子/后视镜/门把手
  const detail = Q.carDetail || Q.level === "L2" || Q.level === "L3";
  if (detail) {
    // 车窗
    const topLen = len * 0.6, topWid = wid * 0.85, topH = u(0.45);
    const cyTop = baseY + h + topH / 2 + u(0.05);
    batch.addBox(x, cyTop, z, topLen, topH, topWid, yaw, glassRect, [0.7, 0.8, 0.9]);
    // 轮子 4个
    const wheelR = u(0.25), wheelW = u(0.15);
    const wheelY = baseY + wheelR;
    const offsets = [
      [len * 0.35, wid * 0.5], [len * 0.35, -wid * 0.5],
      [-len * 0.35, wid * 0.5], [-len * 0.35, -wid * 0.5],
    ];
    for (const [ox, oz] of offsets) {
      const rx = ox * Math.cos(yaw) - oz * Math.sin(yaw);
      const rz = ox * Math.sin(yaw) + oz * Math.cos(yaw);
      batch.addCylinder(x + rx, wheelY - wheelR, z + rz, wheelR, wheelW, 8, metalRect, [0.15, 0.15, 0.15]);
    }
    // 车灯
    const lightSize = u(0.2);
    const frontX = len / 2 - u(0.05);
    const fx1 = frontX * Math.cos(yaw) - (wid * 0.35) * Math.sin(yaw);
    const fz1 = frontX * Math.sin(yaw) + (wid * 0.35) * Math.cos(yaw);
    const fx2 = frontX * Math.cos(yaw) - (-wid * 0.35) * Math.sin(yaw);
    const fz2 = frontX * Math.sin(yaw) + (-wid * 0.35) * Math.cos(yaw);
    batch.addBox(x + fx1, baseY + h * 0.5, z + fz1, lightSize, lightSize, lightSize, yaw, signRect, [1, 1, 0.8]);
    batch.addBox(x + fx2, baseY + h * 0.5, z + fz2, lightSize, lightSize, lightSize, yaw, signRect, [1, 1, 0.8]);
    // 后视镜
    if (carDef.name !== "bus") {
      const mirX = len * 0.2;
      const mirZ = wid * 0.6;
      const mx1 = mirX * Math.cos(yaw) - mirZ * Math.sin(yaw);
      const mz1 = mirX * Math.sin(yaw) + mirZ * Math.cos(yaw);
      batch.addBox(x + mx1, baseY + h * 0.7, z + mz1, u(0.1), u(0.1), u(0.08), yaw, metalRect, [0.2, 0.2, 0.2]);
    }
    // 车牌
    const plateW = u(0.4), plateH = u(0.15);
    const backX = -len / 2 + u(0.05);
    const bx = backX * Math.cos(yaw), bz = backX * Math.sin(yaw);
    batch.addBox(x + bx, baseY + h * 0.3, z + bz, u(0.02), plateH, plateW, yaw, signRect, [1, 1, 1]);
  } else {
    // 简化版车顶
    const topLen = len * 0.6, topWid = wid * 0.8, topH = u(0.5);
    const cyTop = baseY + h + topH / 2 + u(0.05);
    batch.addBox(x, cyTop, z, topLen, topH, topWid, yaw, metalRect, tint);
  }
}

// 建筑生成 — 统一贴地 yBase=0，旋转后碰撞，v4 精致度按 Q.buildingDetail
function addBuilding(batch, block, edge, cursor, WPH, DPH, HPH, zone, rng, auditList, isMainRoad) {
  const W = u(WPH), D = u(DPH), H = u(HPH);
  const cx = cursor.x, cz = cursor.z;
  const zoneCol = choice(rng, ZONE_COLORS[zone] || ZONE_COLORS.residential);
  const tint = jitterColor(zoneCol, rng, 0.06);
  const windowChoices = ZONE_PARAMS[zone]?.window || [0, 1];
  const winId = choice(rng, windowChoices);
  const winRect = getAtlasRect(winId);
  const doorRect = getAtlasRect(9);
  const roofRect = getAtlasRect(12);
  const metalRect = getAtlasRect(8);
  const signRect = getAtlasRect(10);
  const brickRect = getAtlasRect(6);

  const isHorizontal = edge === "north" || edge === "south";
  const yaw = isHorizontal ? 0 : Math.PI / 2;
  const actualW = isHorizontal ? W : D;
  const actualD = isHorizontal ? D : W;
  const detailLevel = (typeof Q !== "undefined" && typeof Q.buildingDetail === "number") ? Q.buildingDetail : 1;

  const floors = rng() < 0.5 ? 1 : 2;
  const baseH = u(floors * 2.2);

  const hasSetback = rng() < 0.35;
  let segments = [{ h: H, inset: 0, y: 0 }];
  if (hasSetback) {
    const numSeg = rng() < 0.5 ? 2 : 3;
    const segH = H / numSeg;
    segments = [];
    for (let i = 0; i < numSeg; i++) {
      const insetPH = i === 0 ? 0 : randRange(rng, 0.5, 2);
      const inset = u(insetPH);
      segments.push({ h: segH, inset, y: i * segH });
    }
  }

  const hasDouble = rng() < 0.25 && !hasSetback;
  if (hasDouble) {
    const split = randRange(rng, 0.4, 0.6);
    const W1 = actualW * split, W2 = actualW * (1 - split);
    const H1 = H, H2 = H * randRange(rng, 0.6, 1.0);
    const x1 = isHorizontal ? cx - W2 / 2 : cx;
    const z1 = isHorizontal ? cz : cz - W2 / 2;
    addSolid(batch, x1, z1, W1, actualD, H1, 0, yaw, winRect, tint, "build", auditList, { uScale: WPH / 2.5, vScale: HPH / 2.2 });
    const x2 = isHorizontal ? cx + W1 / 2 : cx;
    const z2 = isHorizontal ? cz : cz + W1 / 2;
    addSolid(batch, x2, z2, W2, actualD, H2, 0, yaw, winRect, tint, "build", auditList, { uScale: W2 / u(1) / 2.5, vScale: H2 / u(1) / 2.2 });
    const parapetH = u(0.4);
    batch.addBox(cx, H + parapetH / 2, cz, actualW + u(0.2), parapetH, actualD + u(0.2), yaw, roofRect, tint);
    // 门：双体量也加门
    if (detailLevel >= 1) {
      const doorW = u(0.9), doorH = u(1.9);
      const frontOffset = actualD / 2 + u(0.02);
      const dx = isHorizontal ? 0 : (edge === "east" ? frontOffset : -frontOffset);
      const dz = isHorizontal ? (edge === "north" ? frontOffset : -frontOffset) : 0;
      batch.addBox(cx + dx, doorH / 2, cz + dz, isHorizontal ? doorW : u(0.05), doorH, isHorizontal ? u(0.05) : doorW, yaw, doorRect, [1, 1, 1]);
      // 门把手
      batch.addBox(cx + dx + (isHorizontal ? doorW * 0.35 : 0), doorH * 0.5, cz + dz + (isHorizontal ? 0 : doorW * 0.35), u(0.05), u(0.05), u(0.02), yaw, metalRect, [0.9, 0.8, 0.3]);
      // 台阶
      batch.addBox(cx + dx * 1.1, u(0.05), cz + dz * 1.1, isHorizontal ? doorW + u(0.2) : u(0.6), u(0.1), isHorizontal ? u(0.6) : doorW + u(0.2), yaw, brickRect, [0.8, 0.8, 0.8]);
    }
    return;
  }

  for (const seg of segments) {
    const segW = actualW - seg.inset * 2;
    const segD = actualD - seg.inset * 2;
    if (segW <= u(1) || segD <= u(1)) continue;
    const segY = seg.y;
    if (seg.y < baseH) {
      const hInBase = Math.min(seg.h, baseH - seg.y);
      addSolid(batch, cx, cz, segW, segD, hInBase, seg.y, yaw, doorRect, tint, "build", auditList);
      if (seg.h > hInBase) {
        const upperSegH = seg.h - hInBase;
        addSolid(batch, cx, cz, segW, segD, upperSegH, seg.y + hInBase, yaw, winRect, tint, "build", auditList, { uScale: WPH / 2.5, vScale: HPH / 2.2 });
      }
    } else {
      addSolid(batch, cx, cz, segW, segD, seg.h, seg.y, yaw, winRect, tint, "build", auditList, { uScale: WPH / 2.5, vScale: HPH / 2.2 });
    }
  }

  const parapetH = u(0.4);
  batch.addBox(cx, H + parapetH / 2, cz, actualW + u(0.1), parapetH, actualD + u(0.1), yaw, roofRect, tint);

  // ── 门（L1+ 必有，满足验收） ──
  if (detailLevel >= 1) {
    const doorW = u(0.9), doorH = u(1.9);
    const frontOffset = actualD / 2 + u(0.02);
    const dx = isHorizontal ? 0 : (edge === "east" ? frontOffset : -frontOffset);
    const dz = isHorizontal ? (edge === "north" ? frontOffset : -frontOffset) : 0;
    // 门框+玻璃
    batch.addBox(cx + dx, doorH / 2, cz + dz, isHorizontal ? doorW : u(0.05), doorH, isHorizontal ? u(0.05) : doorW, yaw, doorRect, [1, 1, 1]);
    batch.addBox(cx + dx + (isHorizontal ? doorW * 0.35 : 0), doorH * 0.5, cz + dz + (isHorizontal ? 0 : doorW * 0.35), u(0.05), u(0.05), u(0.02), yaw, metalRect, [0.9, 0.8, 0.3]);
    batch.addBox(cx + dx * 1.1, u(0.05), cz + dz * 1.1, isHorizontal ? doorW + u(0.2) : u(0.6), u(0.1), isHorizontal ? u(0.6) : doorW + u(0.2), yaw, brickRect, [0.8, 0.8, 0.8]);
  }

  // ── 基座商铺/招牌/雨棚（L0+） ──
  if (zone === "commercial" || rng() < 0.6) {
    const awningW = actualW * 0.8, awningD = u(0.5);
    const awningX = cx, awningZ = cz + (isHorizontal ? (edge === "north" ? actualD / 2 + awningD / 2 : -actualD / 2 - awningD / 2) : 0);
    const awningX2 = isHorizontal ? awningX : cx + (edge === "east" ? actualW / 2 + awningD / 2 : -actualW / 2 - awningD / 2);
    const awningZ2 = isHorizontal ? awningZ : cz;
    batch.addBox(awningX2, baseH + u(0.1), awningZ2, isHorizontal ? awningW : awningD, u(0.05), isHorizontal ? awningD : awningW, yaw, metalRect, [0.9, 0.9, 0.9]);
    // 支撑杆
    if (detailLevel >= 1) {
      const rodH = baseH;
      const rodR = u(0.03);
      const rodX1 = awningX2 + (isHorizontal ? awningW * 0.4 : awningD * 0.4);
      const rodZ1 = awningZ2;
      batch.addCylinder(rodX1, 0, rodZ1, rodR, rodH, 4, metalRect, [0.7, 0.7, 0.75]);
    }
    // 招牌
    if (detailLevel >= 0) {
      const signW = actualW * 0.6, signH = u(0.5);
      const frontOffset = actualD / 2 + u(0.06);
      const sx = isHorizontal ? cx : cx + (edge === "east" ? frontOffset : -frontOffset);
      const sz = isHorizontal ? cz + (edge === "north" ? frontOffset : -frontOffset) : cz;
      batch.addBox(sx, baseH + u(0.6), sz, isHorizontal ? signW : u(0.05), signH, isHorizontal ? u(0.05) : signW, yaw, signRect, [1, 1, 1]);
    }
  }

  // ── 阳台（L2+） ──
  if (detailLevel >= 2 && H > u(4) && rng() < 0.7) {
    const balFloors = Math.floor((H - baseH) / u(2.8));
    for (let f = 0; f < Math.min(balFloors, 3); f++) {
      if (rng() < 0.4) continue;
      const by = baseH + u(2.8) * f + u(1.2);
      const balW = actualW * 0.4, balD = u(0.6), balH = u(0.08);
      const frontOffset = actualD / 2 + balD / 2;
      const bx = isHorizontal ? cx + (rng() - 0.5) * actualW * 0.5 : cx + (edge === "east" ? frontOffset : -frontOffset);
      const bz = isHorizontal ? cz + (edge === "north" ? frontOffset : -frontOffset) : cz + (rng() - 0.5) * actualW * 0.5;
      batch.addBox(bx, by, bz, isHorizontal ? balW : balD, balH, isHorizontal ? balD : balW, yaw, brickRect, [0.9, 0.85, 0.8]);
      batch.addBox(bx, by + u(0.5), bz + (isHorizontal ? balD * 0.4 : 0), isHorizontal ? balW : u(0.05), u(0.8), isHorizontal ? u(0.05) : balW, yaw, metalRect, [0.7, 0.7, 0.75]);
      if (rng() < 0.5) {
        batch.addBox(bx, by + u(0.6), bz, u(0.6), u(0.02), u(0.02), yaw, metalRect, [0.8, 0.8, 0.8]);
        batch.addBox(bx, by + u(0.45), bz, u(0.3), u(0.25), u(0.01), yaw, signRect, [0.2, 0.6, 0.9]);
      }
    }
  }

  // ── 空调外机（L2+） ──
  if (detailLevel >= 2 && rng() < 0.8) {
    const acCount = randInt(rng, 1, 2);
    for (let i = 0; i < acCount; i++) {
      const ay = baseH + u(1.5) + rng() * (H - baseH - u(2));
      const sideOffset = actualW / 2 + u(0.15);
      const ax = isHorizontal ? cx + (rng() < 0.5 ? sideOffset : -sideOffset) : cx;
      const az = isHorizontal ? cz : cz + (rng() < 0.5 ? sideOffset : -sideOffset);
      const acW = u(0.4), acH = u(0.3), acD = u(0.25);
      batch.addBox(ax, ay, az, acW, acH, acD, yaw, metalRect, [0.85, 0.85, 0.88]);
      batch.addBox(ax, ay, az + u(0.13), acW * 0.8, acH * 0.6, u(0.02), yaw, metalRect, [0.3, 0.3, 0.35]);
      batch.addBox(ax, ay - u(0.2), az, u(0.04), u(0.6), u(0.04), 0, metalRect, [0.6, 0.6, 0.6]);
    }
  }

  // ── 防盗窗/花架（L2+） ──
  if (detailLevel >= 2 && rng() < 0.5) {
    const winY = baseH + u(1.0);
    const frontOffset = actualD / 2 + u(0.05);
    const fx = isHorizontal ? cx : cx + (edge === "east" ? frontOffset : -frontOffset);
    const fz = isHorizontal ? cz + (edge === "north" ? frontOffset : -frontOffset) : cz;
    batch.addBox(fx, winY, fz, isHorizontal ? u(1.0) : u(0.05), u(1.0), isHorizontal ? u(0.05) : u(1.0), yaw, metalRect, [0.5, 0.5, 0.55]);
  }

  // ── 屋顶设备（L1+ 女儿墙已做，L1+ 水箱/通风/天线，L3 检修门爬梯） ──
  const distPH = Math.hypot(block.cxPH, block.czPH);
  if (distPH < 600 && isMainRoad && rng() < (detailLevel >= 2 ? 0.7 : 0.45)) {
    const propCount = randInt(rng, 1, detailLevel >= 2 ? 5 : 3);
    for (let i = 0; i < propCount; i++) {
      const px = cx + (rng() - 0.5) * actualW * 0.6;
      const pz = cz + (rng() - 0.5) * actualD * 0.6;
      const pw = u(randRange(rng, 0.4, 1.2));
      const ph = u(randRange(rng, 0.4, 1.5));
      const pd = u(randRange(rng, 0.4, 1.0));
      const isTank = rng() < 0.3;
      if (isTank) {
        batch.addCylinder(px, H, pz, pw * 0.5, ph, 8, metalRect, [0.6, 0.6, 0.65]);
      } else {
        batch.addBox(px, H + ph / 2, pz, pw, ph, pd, 0, metalRect, [0.5, 0.5, 0.55]);
      }
      if (detailLevel >= 3 && i === 0) {
        // 检修门+爬梯
        batch.addBox(px + pw * 0.6, H + u(0.5), pz, u(0.6), u(1.0), u(0.05), 0, metalRect, [0.4, 0.4, 0.45]);
        batch.addBox(px - pw * 0.6, H * 0.5, pz, u(0.3), H, u(0.05), 0, metalRect, [0.5, 0.5, 0.55]);
      }
    }
  }

  // ── 消防梯/落水管（L2+） ──
  if (detailLevel >= 2 && rng() < 0.6) {
    const ladderH = H * 0.8;
    const sideX = cx + actualW / 2 + u(0.1);
    const sideZ = cz;
    const lx = isHorizontal ? sideX : cx;
    const lz = isHorizontal ? cz : sideZ + actualW / 2 + u(0.1);
    batch.addBox(lx, ladderH / 2, lz, u(0.05), ladderH, u(0.4), yaw, metalRect, [0.55, 0.1, 0.1]);
    // 落水管
    batch.addCylinder(cx + actualW * 0.45, 0, cz + actualD * 0.45, u(0.04), H, 4, metalRect, [0.4, 0.4, 0.45]);
  }

  // ── 涂鸦/海报（L2+） ──
  if (detailLevel >= 2 && rng() < 0.4) {
    const graffitiY = u(1.0);
    const frontOffset = actualD / 2 + u(0.01);
    const gx = isHorizontal ? cx + (rng() - 0.5) * actualW * 0.6 : cx + (edge === "east" ? frontOffset : -frontOffset);
    const gz = isHorizontal ? cz + (edge === "north" ? frontOffset : -frontOffset) : cz + (rng() - 0.5) * actualW * 0.6;
    batch.addBox(gx, graffitiY, gz, isHorizontal ? u(1.2) : u(0.02), u(0.8), isHorizontal ? u(0.02) : u(1.2), yaw, signRect, [1, 0.3, 0.6]);
  }
}

// 主函数
export function buildCity(scene, opts = {}) {
  const startTime = performance.now();
  const seed = opts.seed || CFG.CITY_SEED;
  const blocks = generateBlocks(seed);
  const tileBlocks = CFG.TILE_BLOCKS;
  const grid = CFG.CITY_GRID;
  const tilesPerSide = Math.ceil(grid / tileBlocks);
  const atlas = buildAtlas(scene);
  const atlasTex = atlas.texture;
  const cityMat = createCityMaterial(scene, atlasTex, "cityMat");

  // 清空碰撞世界
  collideClear();

  const cityHalf = u(grid * CFG.BLOCK_PITCH / 2);
  // 地面 AABB
  collideAddBox({ minX: -cityHalf - 10, maxX: cityHalf + 10, minY: -1, maxY: 0, minZ: -cityHalf - 10, maxZ: cityHalf + 10, kind: "ground" });
  // 边界墙
  const wallH = u(10), wallThick = u(2);
  collideAddBox({ minX: -cityHalf - wallThick, maxX: -cityHalf, minY: 0, maxY: wallH, minZ: -cityHalf - 10, maxZ: cityHalf + 10, kind: "wall" });
  collideAddBox({ minX: cityHalf, maxX: cityHalf + wallThick, minY: 0, maxY: wallH, minZ: -cityHalf - 10, maxZ: cityHalf + 10, kind: "wall" });
  collideAddBox({ minX: -cityHalf - 10, maxX: cityHalf + 10, minY: 0, maxY: wallH, minZ: -cityHalf - wallThick, maxZ: -cityHalf, kind: "wall" });
  collideAddBox({ minX: -cityHalf - 10, maxX: cityHalf + 10, minY: 0, maxY: wallH, minZ: cityHalf, maxZ: cityHalf + wallThick, kind: "wall" });

  const tiles = [];
  let totalTris = 0, totalVerts = 0, buildingCount = 0;
  const auditRecords = [];

  for (let tx = 0; tx < tilesPerSide; tx++) {
    for (let tz = 0; tz < tilesPerSide; tz++) {
      const batch = new GeoBatch();
      const tileMinBX = tx * tileBlocks;
      const tileMaxBX = Math.min((tx + 1) * tileBlocks - 1, grid - 1);
      const tileMinBZ = tz * tileBlocks;
      const tileMaxBZ = Math.min((tz + 1) * tileBlocks - 1, grid - 1);
      const tileMinX = u((tileMinBX - grid / 2) * CFG.BLOCK_PITCH);
      const tileMaxX = u((tileMaxBX - grid / 2 + 1) * CFG.BLOCK_PITCH);
      const tileMinZ = u((tileMinBZ - grid / 2) * CFG.BLOCK_PITCH);
      const tileMaxZ = u((tileMaxBZ - grid / 2 + 1) * CFG.BLOCK_PITCH);
      const tileCenterX = (tileMinX + tileMaxX) / 2;
      const tileCenterZ = (tileMinZ + tileMaxZ) / 2;

      const asphaltRect = getAtlasRect(4);
      const sidewalkRect = getAtlasRect(6);
      const grassRect = getAtlasRect(7);
      const metalRect = getAtlasRect(8);
      const blobRect = getAtlasRect(15);
      batch.addQuad({ x: tileMinX, y: 0, z: tileMinZ }, { x: tileMaxX, y: 0, z: tileMinZ }, { x: tileMaxX, y: 0, z: tileMaxZ }, { x: tileMinX, y: 0, z: tileMaxZ }, asphaltRect, [0.9, 0.9, 0.9]);
      // 地面细节：井盖/水洼/补丁 (按 Q.groundDetail)
      {
        const tileRng = mulberry32(seedFor(`ground-${tx}-${tz}`, tx, tz));
        const gd = (typeof Q !== "undefined" && typeof Q.groundDetail === "number") ? Q.groundDetail : 1;
        if (gd >= 1) {
          const manholeCount = gd >= 2 ? randInt(tileRng, 3, 6) : randInt(tileRng, 1, 3);
          for (let m = 0; m < manholeCount; m++) {
            const mx = tileMinX + tileRng() * (tileMaxX - tileMinX);
            const mz = tileMinZ + tileRng() * (tileMaxZ - tileMinZ);
            const r = u(0.35);
            batch.addCylinder(mx, 0.002, mz, r, u(0.02), 8, metalRect, [0.35, 0.35, 0.38]);
          }
        }
        if (gd >= 2) {
          const puddleCount = randInt(tileRng, 1, 3);
          for (let p = 0; p < puddleCount; p++) {
            const px = tileMinX + tileRng() * (tileMaxX - tileMinX);
            const pz = tileMinZ + tileRng() * (tileMaxZ - tileMinZ);
            const pw = u(randRange(tileRng, 1.5, 3.5));
            const pd = u(randRange(tileRng, 1.0, 2.5));
            batch.addQuad({ x: px - pw / 2, y: 0.003, z: pz - pd / 2 }, { x: px + pw / 2, y: 0.003, z: pz - pd / 2 }, { x: px + pw / 2, y: 0.003, z: pz + pd / 2 }, { x: px - pw / 2, y: 0.003, z: pz + pd / 2 }, blobRect, [0.6, 0.7, 0.85]);
          }
        }
      }

      for (let bx = tileMinBX; bx <= tileMaxBX; bx++) {
        for (let bz = tileMinBZ; bz <= tileMaxBZ; bz++) {
          const block = blocks.find(b => b.bx === bx && b.bz === bz);
          if (!block) continue;
          const rng = mulberry32(seedFor(`b-${bx}-${bz}`, bx, bz));

          if (block.isCenterPlaza) {
            const brickRect = getAtlasRect(6);
            batch.addQuad({ x: block.cx - block.netW / 2, y: 0.001, z: block.cz - block.netD / 2 }, { x: block.cx + block.netW / 2, y: 0.001, z: block.cz - block.netD / 2 }, { x: block.cx + block.netW / 2, y: 0.001, z: block.cz + block.netD / 2 }, { x: block.cx - block.netW / 2, y: 0.001, z: block.cz + block.netD / 2 }, brickRect, [1, 1, 1]);
            const fountainR = u(2);
            batch.addCylinder(block.cx, 0.001, block.cz, fountainR, u(0.5), 12, brickRect, [0.8, 0.8, 0.9]);
            for (let f = 0; f < 4; f++) {
              const ang = (f / 4) * Math.PI * 2;
              const fx = block.cx + Math.cos(ang) * u(8);
              const fz = block.cz + Math.sin(ang) * u(8);
              addSolid(batch, fx, fz, u(1.5), u(1.5), u(0.4), 0, 0, brickRect, [0.6, 0.5, 0.4], "furn", auditRecords);
            }
            continue;
          }

          if (block.zone === "park") {
            const grassRect = getAtlasRect(7);
            batch.addQuad({ x: block.cx - block.netW / 2, y: 0.001, z: block.cz - block.netD / 2 }, { x: block.cx + block.netW / 2, y: 0.001, z: block.cz - block.netD / 2 }, { x: block.cx + block.netW / 2, y: 0.001, z: block.cz + block.netD / 2 }, { x: block.cx - block.netW / 2, y: 0.001, z: block.cz + block.netD / 2 }, grassRect, [1, 1, 1]);
            const treeCount = randInt(rng, 5, 12);
            for (let t = 0; t < treeCount; t++) {
              const tx = block.cx + (rng() - 0.5) * block.netW * 0.8;
              const tz = block.cz + (rng() - 0.5) * block.netD * 0.8;
              addFurniture(batch, { type: "tree" }, tx, tz, 0, rng, auditRecords);
            }
            for (let b = 0; b < 3; b++) {
              const bx2 = block.cx + (rng() - 0.5) * block.netW * 0.6;
              const bz2 = block.cz + (rng() - 0.5) * block.netD * 0.6;
              addFurniture(batch, { type: "bench" }, bx2, bz2, rng() * Math.PI * 2, rng, auditRecords);
            }
            continue;
          }

          const sidewalkW = WORLD.SIDEWALK;
          const curbH = WORLD.CURB_H;
          const brickRect = getAtlasRect(6);
          // 人行道 — 用 addSolid 保证同源
          addSolid(batch, block.cx, block.cz + block.netD / 2 + sidewalkW / 2, block.netW + sidewalkW * 2, sidewalkW, curbH, 0, 0, brickRect, [1, 1, 1], "curb", auditRecords);
          addSolid(batch, block.cx, block.cz - block.netD / 2 - sidewalkW / 2, block.netW + sidewalkW * 2, sidewalkW, curbH, 0, 0, brickRect, [1, 1, 1], "curb", auditRecords);
          addSolid(batch, block.cx + block.netW / 2 + sidewalkW / 2, block.cz, sidewalkW, block.netD, curbH, 0, 0, brickRect, [1, 1, 1], "curb", auditRecords);
          addSolid(batch, block.cx - block.netW / 2 - sidewalkW / 2, block.cz, sidewalkW, block.netD, curbH, 0, 0, brickRect, [1, 1, 1], "curb", auditRecords);

          const zoneParam = ZONE_PARAMS[block.zone] || ZONE_PARAMS.residential;
          const bDetail = (typeof Q !== "undefined" && typeof Q.buildingDetail === "number") ? Q.buildingDetail : 1;
          const buildingRange = bDetail === 0 ? [1, 1] : bDetail === 1 ? [1, 3] : (bDetail === 2 ? [2, 4] : [3, 6]);
          const totalBuildings = randInt(rng, buildingRange[0], buildingRange[1]);
          const edges = ["north", "south", "east", "west"];
          const perEdge = [0, 0, 0, 0];
          for (let i = 0; i < totalBuildings; i++) perEdge[i % 4]++;

          for (let e = 0; e < 4; e++) {
            const count = perEdge[e];
            if (count === 0) continue;
            const edge = edges[e];
            const isHorizontal = edge === "north" || edge === "south";
            const edgeLen = isHorizontal ? block.netW : block.netD;
            let cursorPos = -edgeLen / 2 + u(1);
            for (let b = 0; b < count; b++) {
              const WPH = randRange(rng, 5, 12.5);
              const DPH = randRange(rng, 5, 12.5);
              const HPH = randRange(rng, zoneParam.hMin, zoneParam.hMax);
              const gapPH = randRange(rng, 1, 2);
              if (cursorPos + u(WPH) > edgeLen / 2) break;
              let bxPos, bzPos;
              if (edge === "north") {
                bxPos = block.cx + cursorPos + u(WPH) / 2;
                bzPos = block.cz + block.netD / 2 - u(DPH) / 2;
              } else if (edge === "south") {
                bxPos = block.cx + cursorPos + u(WPH) / 2;
                bzPos = block.cz - block.netD / 2 + u(DPH) / 2;
              } else if (edge === "east") {
                bxPos = block.cx + block.netW / 2 - u(DPH) / 2;
                bzPos = block.cz + cursorPos + u(WPH) / 2;
              } else {
                bxPos = block.cx - block.netW / 2 + u(DPH) / 2;
                bzPos = block.cz + cursorPos + u(WPH) / 2;
              }
              addBuilding(batch, block, edge, { x: bxPos, z: bzPos }, WPH, DPH, HPH, block.zone, rng, auditRecords, block.isMain);
              buildingCount++;
              cursorPos += u(WPH + gapPH);
            }
          }

          const furnLimit = (typeof Q !== "undefined" && typeof Q.streetFurnitureTypes === "number") ? Q.streetFurnitureTypes : 12;
          const furnDefs = FURNITURE_DEFS.slice(0, furnLimit);
          const spacingMult = (typeof Q !== "undefined" && Q.level === "L0") ? 4.0 : (Q.level === "L1" ? 2.5 : (Q.level === "L2" ? 1.2 : 1.0));
          for (const def of furnDefs) {
            if (block.zone === "park") continue;
            if (def.type === "guard" && !block.isMain) continue;
            if (def.type === "pole" && block.zone !== "oldtown" && rng() > 0.3) continue;
            const spacingWorld = u(def.spacing * spacingMult);
            const jitter = 0.15;
            const phase = rng() * spacingWorld;
            for (const edge of edges) {
              const isHorizontal = edge === "north" || edge === "south";
              const edgeLen = isHorizontal ? block.netW : block.netD;
              const steps = Math.floor(edgeLen / spacingWorld);
              for (let s = 0; s < steps; s++) {
                if (rng() < 0.3) continue;
                const offset = (s * spacingWorld + phase + (rng() - 0.5) * spacingWorld * jitter);
                if (Math.abs(offset) > edgeLen / 2 - u(1)) continue;
                let fx, fz, yaw = 0;
                const dist = u(def.dist);
                if (edge === "north") { fx = block.cx + offset; fz = block.cz + block.netD / 2 + sidewalkW / 2; yaw = 0; }
                else if (edge === "south") { fx = block.cx + offset; fz = block.cz - block.netD / 2 - sidewalkW / 2; yaw = Math.PI; }
                else if (edge === "east") { fx = block.cx + block.netW / 2 + sidewalkW / 2; fz = block.cz + offset; yaw = Math.PI / 2; }
                else { fx = block.cx - block.netW / 2 - sidewalkW / 2; fz = block.cz + offset; yaw = -Math.PI / 2; }
                fx += Math.cos(yaw) * dist * 0.2;
                fz += Math.sin(yaw) * dist * 0.2;
                addFurniture(batch, def, fx, fz, yaw, rng, auditRecords);
              }
            }
          }

          if (block.zone !== "park" && rng() < 0.7) {
            const carRange = (typeof Q !== "undefined" && Q.level === "L0") ? [0, 1] : (Q.level === "L1" ? [1, 2] : [1, 3]);
            const carCount = randInt(rng, carRange[0], carRange[1]);
            for (let c = 0; c < carCount; c++) {
              const side = choice(rng, ["north", "south", "east", "west"]);
              const offset = (rng() - 0.5) * (side === "north" || side === "south" ? block.netW : block.netD) * 0.6;
              let cx, cz, yaw;
              if (side === "north") { cx = block.cx + offset; cz = block.cz + block.netD / 2 + sidewalkW + u(1.5); yaw = 0; }
              else if (side === "south") { cx = block.cx + offset; cz = block.cz - block.netD / 2 - sidewalkW - u(1.5); yaw = Math.PI; }
              else if (side === "east") { cx = block.cx + block.netW / 2 + sidewalkW + u(1.5); cz = block.cz + offset; yaw = Math.PI / 2; }
              else { cx = block.cx - block.netW / 2 - sidewalkW - u(1.5); cz = block.cz + offset; yaw = -Math.PI / 2; }
              addCar(batch, cx, cz, yaw, rng, auditRecords);
            }
          }

          if (isMainRoad(bx) && isMainRoad(bz)) {
            const zebraRect = getAtlasRect(13);
            const ix = u((bx - grid / 2) * CFG.BLOCK_PITCH);
            const iz = u((bz - grid / 2) * CFG.BLOCK_PITCH);
            const zw = u(3), zl = u(1);
            for (let dir = 0; dir < 4; dir++) {
              const ang = dir * Math.PI / 2;
              const px = ix + Math.cos(ang) * u(4);
              const pz = iz + Math.sin(ang) * u(4);
              batch.addQuad({ x: px - zw / 2, y: 0.002, z: pz - zl / 2 }, { x: px + zw / 2, y: 0.002, z: pz - zl / 2 }, { x: px + zw / 2, y: 0.002, z: pz + zl / 2 }, { x: px - zw / 2, y: 0.002, z: pz + zl / 2 }, zebraRect, [1, 1, 1], [0, 1, 0]);
            }
          }
        }
      }

      const stats = batch.getStats();
      totalTris += stats.triangles;
      totalVerts += stats.vertices;

      let mesh = null;
      if (scene) {
        try {
          const { Mesh, VertexData } = window.BABYLON || {};
          if (Mesh && VertexData) {
            mesh = new Mesh(`cityTile_${tx}_${tz}`, scene);
            const vd = new VertexData();
            vd.positions = batch.pos;
            vd.normals = batch.nrm;
            vd.uvs = batch.uv;
            vd.colors = batch.col;
            vd.indices = batch.idx;
            vd.applyToMesh(mesh, false);
            mesh.material = cityMat;
            mesh.isPickable = false;
            mesh.receiveShadows = true;
          }
        } catch (e) { console.warn("[city] tile mesh failed", e); }
      }

      tiles.push({
        tx, tz,
        minX: tileMinX, maxX: tileMaxX, minZ: tileMinZ, maxZ: tileMaxZ,
        centerX: tileCenterX, centerZ: tileCenterZ,
        mesh, batch,
        stats,
      });
    }
  }

  // 地标
  const landmarks = [];
  {
    const towerH = u(120), towerR = u(0.5);
    const tx = u(30), tz = u(10);
    const batch = new GeoBatch();
    const metalRect = getAtlasRect(8);
    batch.addCylinder(tx, 0, tz, towerR, towerH * 0.8, 8, metalRect, [0.7, 0.7, 0.75]);
    batch.addCylinder(tx, towerH * 0.7, tz, u(3), u(0.5), 12, metalRect, [0.8, 0.8, 0.85]);
    batch.addCylinder(tx, towerH * 0.8, tz, u(0.1), towerH * 0.2, 6, metalRect, [0.6, 0.6, 0.65]);
    addSolidCylinder(batch, tx, tz, towerR, towerH, 0, 8, metalRect, [0.7, 0.7, 0.75], "build", auditRecords);
    landmarks.push({ type: "tvTower", x: tx, z: tz, h: towerH, batch });
  }
  {
    const towerH = u(45);
    const cx = u(5), cz = u(5);
    const batch = new GeoBatch();
    const brickRect = getAtlasRect(6);
    addSolid(batch, cx, cz, u(4), u(4), towerH, 0, 0, brickRect, [0.8, 0.75, 0.7], "build", auditRecords);
    const signRect = getAtlasRect(10);
    batch.addBox(cx, towerH * 0.8, cz + u(2.1), u(1.5), u(1.5), u(0.1), 0, signRect, [1, 1, 1]);
    batch.addCylinder(cx, towerH, cz, u(0.1), u(3), 4, brickRect, [0.6, 0.3, 0.2]);
    landmarks.push({ type: "clockTower", x: cx, z: cz, h: towerH, batch });
  }

  let skylineMesh = null;
  if (scene && typeof window !== "undefined" && window.BABYLON) {
    try {
      const BABYLON = window.BABYLON;
      const skylineR = CFG.SKYLINE_R;
      const skylineBatch = new GeoBatch();
      const silhouetteRect = getAtlasRect(14);
      const silhouetteColor = hexToRgb("#5a6a86");
      const rng = mulberry32(seed + 999);
      const count = 80;
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.1;
        const r = skylineR + (rng() - 0.5) * 5;
        const x = Math.cos(ang) * r;
        const z = Math.sin(ang) * r;
        const w = u(randRange(rng, 3, 8));
        const h = u(randRange(rng, 8, 20));
        const d = u(randRange(rng, 3, 6));
        skylineBatch.addBox(x, h / 2, z, w, h, d, -ang, silhouetteRect, silhouetteColor);
      }
      const mesh = new BABYLON.Mesh("skylineRing", scene);
      const vd = new BABYLON.VertexData();
      vd.positions = skylineBatch.pos;
      vd.normals = skylineBatch.nrm;
      vd.uvs = skylineBatch.uv;
      vd.colors = skylineBatch.col;
      vd.indices = skylineBatch.idx;
      vd.applyToMesh(mesh, false);
      const mat = new BABYLON.StandardMaterial("skylineMat", scene);
      mat.diffuseColor = new BABYLON.Color3(0.35, 0.42, 0.52);
      mat.emissiveColor = new BABYLON.Color3(0.1, 0.12, 0.15);
      mat.backFaceCulling = false;
      mesh.material = mat;
      mesh.isPickable = false;
      skylineMesh = mesh;
    } catch (e) { console.warn("[city] skyline failed", e); }
  }

  const endTime = performance.now();
  const genTime = endTime - startTime;

  // 审计：悬空/陷地
  let floating = [], sinking = [];
  for (const rec of auditRecords) {
    const diff = rec.minY - rec.expectedYBase;
    if (diff > 0.01) floating.push(rec);
    if (diff < -0.01) sinking.push(rec);
  }

  const stats = {
    tileCount: tiles.length,
    buildingCount,
    triCount: totalTris,
    vertCount: totalVerts,
    aabbCount: collideGetBoxes().length,
    genTime,
    atlasSize: Q.atlasSize,
    floatingCount: floating.length,
    sinkingCount: sinking.length,
  };

  return {
    tiles, blocks, landmarks, skylineMesh, atlas, material: cityMat,
    stats, auditRecords, floating, sinking,
    center: { x: 0, z: 0 },
  };
}

export function updateCityCulling(playerPos, city) {
  if (!city || !city.tiles) return;
  const cullDist = WORLD.CULL_DIST;
  const cull2 = cullDist * cullDist;
  for (const tile of city.tiles) {
    if (!tile.mesh) continue;
    const dx = tile.centerX - playerPos.x;
    const dz = tile.centerZ - playerPos.z;
    const d2 = dx * dx + dz * dz;
    const shouldShow = d2 <= cull2;
    if (tile.mesh.isEnabled() !== shouldShow) tile.mesh.setEnabled(shouldShow);
  }
}

export function setupSkyAndLights(scene, opts = {}) {
  if (!scene) return null;
  try {
    const BABYLON = window.BABYLON;
    if (!BABYLON) return null;
    const skySize = 256;
    const skyCanvas = document.createElement("canvas");
    skyCanvas.width = 16; skyCanvas.height = skySize;
    const sctx = skyCanvas.getContext("2d");
    const grad = sctx.createLinearGradient(0, 0, 0, skySize);
    grad.addColorStop(0, "#1b2a4a");
    grad.addColorStop(0.5, "#6b5b7a");
    grad.addColorStop(1, "#e0a878");
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 16, skySize);
    sctx.fillStyle = "rgba(255,255,255,0.15)";
    sctx.fillRect(0, skySize * 0.7, 16, 20);
    const skyTex = new BABYLON.DynamicTexture("skyGrad", skyCanvas, scene, false);
    skyTex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    skyTex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    const skyMat = new BABYLON.StandardMaterial("skyMat", scene);
    skyMat.diffuseTexture = skyTex;
    skyMat.emissiveTexture = skyTex;
    skyMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    skyMat.backFaceCulling = false;
    skyMat.disableLighting = true;
    const skyMesh = BABYLON.MeshBuilder.CreateSphere("skySphere", { diameter: 200, segments: 16 }, scene);
    skyMesh.material = skyMat;
    skyMesh.isPickable = false;
    skyMesh.infiniteDistance = true;

    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogColor = new BABYLON.Color3(0.79, 0.64, 0.48);
    scene.fogDensity = CFG.FOG_DENSITY;

    const sunDir = new BABYLON.Vector3(Math.cos(200 * Math.PI / 180) * Math.cos(8 * Math.PI / 180), -Math.sin(8 * Math.PI / 180), Math.sin(200 * Math.PI / 180) * Math.cos(8 * Math.PI / 180));
    let dirLight = scene.lights ? scene.lights.find(l => l.name === "dir") : null;
    if (!dirLight) dirLight = new BABYLON.DirectionalLight("sun", sunDir, scene);
    else dirLight.direction = sunDir;
    dirLight.intensity = 2.2;
    dirLight.diffuse = new BABYLON.Color3(1, 0.84, 0.66);
    if (dirLight) { dirLight.shadowMinZ = 0.5; dirLight.shadowMaxZ = 60; }

    let hemi = scene.lights ? scene.lights.find(l => l.name === "hemi") : null;
    if (!hemi) hemi = new BABYLON.HemisphericLight("hemiSky", new BABYLON.Vector3(0, 1, 0), scene);
    hemi.intensity = 0.35;
    hemi.diffuse = new BABYLON.Color3(0.42, 0.49, 0.66);
    hemi.groundColor = new BABYLON.Color3(0.23, 0.23, 0.27);

    const fillDir = sunDir.scale(-1);
    let fill = scene.lights ? scene.lights.find(l => l.name === "fill") : null;
    if (!fill) fill = new BABYLON.DirectionalLight("fillLight", fillDir, scene);
    fill.intensity = 0.25;
    fill.diffuse = new BABYLON.Color3(0.8, 0.8, 0.9);

    scene.clearColor = new BABYLON.Color4(0.13, 0.14, 0.17, 1);
    scene.ambientColor = new BABYLON.Color3(0.35, 0.35, 0.38);
    return { skyMesh, dirLight, hemiLight: hemi, fillLight: fill };
  } catch (e) { console.warn("[city] sky/lights failed", e); return null; }
}

// 导出工具函数供 audit 使用
export { addSolid, rotatedAABB, groundHeightAt };

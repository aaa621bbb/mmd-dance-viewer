import "./bjs.js";
// game/city.js — 城市生成器，精致版
// 负责：分区/街区/楼/路面/街具/车/天空/雾 + 分块合并 + 碰撞AABB
// 规范 §3 全章

import { CFG, WORLD } from "./config.js";
import { PH, u } from "./scale.js";
import { mulberry32, seedFor, randRange, randInt, choice } from "./rng.js";
import { GeoBatch } from "./geo.js";
import { buildAtlas, getAtlasRect } from "./atlas.js";
import { addBox as collideAddBox } from "./collide.js";

// 工具：hex 转 rgb 0-1
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

// 分区色板 — 全部必须 .map(hexToRgb)，否则 jitterColor 收到字符串会崩
const ZONE_COLORS = {
  commercial: ["#6b7280", "#7c8794", "#4b5563"].map(hexToRgb),
  residential: ["#cbb79b", "#d8c7ae", "#b9a488"].map(hexToRgb),
  oldtown: ["#a98a63", "#9c7f5a", "#b99a72"].map(hexToRgb),
  park: ["#4f7d4a", "#5a8a55", "#3d6a38"].map(hexToRgb),
  construction: ["#8d8d8d", "#9a9a9a", "#7a7a7a"].map(hexToRgb),
  waterfront: ["#8a9aaa", "#7a8a9a", "#6b7a8a"].map(hexToRgb),
  plaza: ["#c2b8a8", "#d1c4b2", "#b8aa98"].map(hexToRgb),
};

// 分区参数
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
  // angleDeg: -180~180 from atan2(z,x)
  // 规范扇区：commercial -90~10, residential 10~110, park 110~170, construction 170~230, waterfront 230~270 (-90)
  // 加入 ±6° 抖动
  const jitter = (rng() - 0.5) * 12; // ±6°
  let a = angleDeg + jitter;
  // 归一到 -180~180
  while (a > 180) a -= 360;
  while (a <= -180) a += 360;

  if (a >= -90 && a < 10) return "commercial";
  if (a >= 10 && a < 110) return "residential";
  if (a >= 110 && a < 170) return "park";
  if (a >= 170 || a < -130) return "construction"; // 170~180 and -180~-130 = 170~230
  if (a >= -130 && a < -90) return "waterfront";
  return "commercial";
}

function isMainRoad(index) {
  return index % 4 === 0;
}

// 生成城市布局
function generateBlocks(seed) {
  const blocks = [];
  const rngGlobal = mulberry32(seed);
  const grid = CFG.CITY_GRID; // 28
  const pitch = CFG.BLOCK_PITCH; // 66 PH
  const pitchWorld = WORLD.BLOCK_PITCH;

  for (let bx = 0; bx < grid; bx++) {
    for (let bz = 0; bz < grid; bz++) {
      const cxPH = (bx - grid / 2 + 0.5) * pitch;
      const czPH = (bz - grid / 2 + 0.5) * pitch;
      const cx = u(cxPH);
      const cz = u(czPH);

      // 中心广场：2x2 块清空
      const isCenterPlaza = (bx >= 13 && bx <= 14 && bz >= 13 && bz <= 14);

      // 计算街道宽度（PH）
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

      // 旧城：20% 概率在住宅区中出现
      if (zone === "residential" && blockRng() < 0.2) zone = "oldtown";

      blocks.push({
        bx, bz,
        cx, cz, cxPH, czPH,
        netW: u(netWPH),
        netD: u(netDPH),
        netWPH, netDPH,
        zone,
        isCenterPlaza,
        isMain: isMainRoad(bx) || isMainRoad(bz),
        leftW: u(leftW), rightW: u(rightW), bottomW: u(bottomW), topW: u(topW),
        leftWPH: leftW, rightWPH: rightW, bottomWPH: bottomW, topWPH: topW,
      });
    }
  }
  return blocks;
}

// 创建材质（Babylon）— 统一走 window.BABYLON（由 bjs.js 挂载）
function createCityMaterial(scene, atlasTex, name = "cityMat") {
  let mat = null;
  try {
    const BABYLON = (typeof window !== "undefined" && window.BABYLON) ? window.BABYLON : null;
    if (!BABYLON) { console.warn("[city] BABYLON missing for material"); return null; }
    mat = new BABYLON.StandardMaterial(name, scene);
    if (atlasTex) {
      mat.diffuseTexture = atlasTex;
      mat.emissiveTexture = atlasTex;
      mat.emissiveColor = new BABYLON.Color3(0.6, 0.55, 0.45);
      mat.emissiveTexture.level = 0.5;
    }
    mat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    mat.backFaceCulling = false;
    mat.useVertexColor = true;
    mat.useVertexAlpha = true;
  } catch (e) {
    console.warn("[city] create material failed", e);
  }
  return mat;
}

// 街具生成器
const FURNITURE_DEFS = [
  { type: "lamp", spacing: 60, dist: 0.4, h: 5, r: 0.08, coll: true },
  { type: "tree", spacing: 45, dist: 0.5, h: 2.4, r: 0.12, coll: true },
  { type: "bench", spacing: 80, dist: 1.0, coll: true },
  { type: "trash", spacing: 90, dist: 0.9, coll: true },
  { type: "hydrant", spacing: 120, dist: 0.8, coll: true },
  { type: "busSign", spacing: 150, dist: 1.2, coll: true },
  { type: "flower", spacing: 100, dist: 1.0, coll: true },
  { type: "billboard", spacing: 110, dist: 0.9, coll: true },
  { type: "guard", spacing: 30, dist: 0.15, coll: true }, // 护栏沿主干道
  { type: "sign", spacing: 200, dist: 0.7, coll: true }, // 路牌只路口
  { type: "pole", spacing: 70, dist: 0.7, coll: true }, // 电线杆
  { type: "signal", spacing: 1000, dist: 0, coll: true }, // 信号灯只路口
];

function addFurnitureBox(batch, x, y, z, sx, sy, sz, yaw, rect, tint) {
  batch.addBox(x, y + sy / 2, z, sx, sy, sz, yaw, rect, tint);
}

function addFurniture(batch, def, x, z, yaw, rng, atlas) {
  const worldY = 0;
  const curbH = WORLD.CURB_H;
  const baseY = curbH; // 街具在人行道上

  const tintNeutral = [0.9, 0.9, 0.9];
  const metalRect = getAtlasRect(8);
  const brickRect = getAtlasRect(6);
  const signRect = getAtlasRect(10);
  const grassRect = getAtlasRect(7);

  switch (def.type) {
    case "lamp": {
      // 路灯：杆 + 弯臂 + 灯头
      const poleH = u(5), poleR = u(0.08);
      batch.addCylinder(x, baseY, z, poleR, poleH, 6, metalRect, [0.7, 0.7, 0.75]);
      // 弯臂
      const armLen = u(0.6);
      const armH = baseY + poleH - u(0.2);
      const armX = x + Math.cos(yaw) * armLen * 0.5;
      const armZ = z + Math.sin(yaw) * armLen * 0.5;
      batch.addBox(armX, armH, armZ, armLen, u(0.08), u(0.08), yaw, metalRect, [0.7, 0.7, 0.75]);
      // 灯头
      const headX = x + Math.cos(yaw) * armLen;
      const headZ = z + Math.sin(yaw) * armLen;
      batch.addBox(headX, armH - u(0.1), headZ, u(0.6), u(0.2), u(0.3), yaw, signRect, [1, 0.9, 0.6]);
      // 碰撞
      collideAddBox({ minX: x - u(0.08), maxX: x + u(0.08), minY: baseY, maxY: baseY + poleH, minZ: z - u(0.08), maxZ: z + u(0.08), kind: "furn" });
      break;
    }
    case "tree": {
      const trunkH = u(2.4), trunkR = u(0.12);
      batch.addCylinder(x, baseY, z, trunkR, trunkH, 6, metalRect, [0.4, 0.25, 0.15]);
      // 树冠 3 层球：用 box 堆叠近似
      const crownR = u(1.2);
      const tints = [[0.2, 0.5, 0.25], [0.25, 0.6, 0.3], [0.3, 0.55, 0.28]];
      for (let i = 0; i < 3; i++) {
        const cy = baseY + trunkH + u(0.3) + i * u(0.5);
        const r = crownR * (1 - i * 0.15);
        batch.addBox(x, cy, z, r * 2, r * 1.2, r * 2, 0, grassRect, tints[i]);
      }
      collideAddBox({ minX: x - trunkR, maxX: x + trunkR, minY: baseY, maxY: baseY + trunkH, minZ: z - trunkR, maxZ: z + trunkR, kind: "furn" });
      break;
    }
    case "bench": {
      const sx = u(1.2), sy = u(0.45), sz = u(0.4);
      addFurnitureBox(batch, x, baseY, z, sx, sy, sz, yaw, brickRect, [0.6, 0.4, 0.3]);
      collideAddBox({ minX: x - sx / 2, maxX: x + sx / 2, minY: baseY, maxY: baseY + sy, minZ: z - sz / 2, maxZ: z + sz / 2, kind: "furn" });
      break;
    }
    case "trash": {
      const r = u(0.25), h = u(0.7);
      batch.addCylinder(x, baseY, z, r, h, 8, metalRect, [0.3, 0.3, 0.35]);
      collideAddBox({ minX: x - r, maxX: x + r, minY: baseY, maxY: baseY + h, minZ: z - r, maxZ: z + r, kind: "furn" });
      break;
    }
    case "hydrant": {
      const r = u(0.15), h = u(0.6);
      batch.addCylinder(x, baseY, z, r, h, 6, metalRect, [0.9, 0.1, 0.1]);
      collideAddBox({ minX: x - r, maxX: x + r, minY: baseY, maxY: baseY + h, minZ: z - r, maxZ: z + r, kind: "furn" });
      break;
    }
    case "busSign": {
      const poleH = u(2.6);
      batch.addCylinder(x, baseY, z, u(0.05), poleH, 6, metalRect, [0.5, 0.5, 0.5]);
      batch.addBox(x, baseY + poleH - u(0.25), z, u(1.4), u(0.5), u(0.05), yaw, signRect, [0.2, 0.5, 0.9]);
      collideAddBox({ minX: x - u(0.1), maxX: x + u(0.1), minY: baseY, maxY: baseY + poleH, minZ: z - u(0.1), maxZ: z + u(0.1), kind: "furn" });
      break;
    }
    case "flower": {
      const sx = u(1.5), sy = u(0.4), sz = u(1.5);
      addFurnitureBox(batch, x, baseY, z, sx, sy, sz, 0, brickRect, [0.6, 0.5, 0.4]);
      // 花
      batch.addBox(x, baseY + sy + u(0.15), z, u(0.8), u(0.3), u(0.8), 0, grassRect, [0.3, 0.7, 0.4]);
      collideAddBox({ minX: x - sx / 2, maxX: x + sx / 2, minY: baseY, maxY: baseY + sy, minZ: z - sz / 2, maxZ: z + sz / 2, kind: "furn" });
      break;
    }
    case "billboard": {
      const sx = u(1.2), sy = u(2.0), sz = u(0.3);
      batch.addBox(x, baseY + sy / 2, z, sx, sy, sz, yaw, signRect, [1, 1, 1]);
      // 地面光斑（用软圆贴片，稍后在 fx 中处理，这里仅几何）
      collideAddBox({ minX: x - sx / 2, maxX: x + sx / 2, minY: baseY, maxY: baseY + sy, minZ: z - sz / 2, maxZ: z + sz / 2, kind: "furn" });
      break;
    }
    case "guard": {
      const len = u(1.5), h = u(0.5), thick = u(0.1);
      addFurnitureBox(batch, x, baseY, z, len, h, thick, yaw, metalRect, [0.8, 0.8, 0.85]);
      collideAddBox({ minX: x - len / 2, maxX: x + len / 2, minY: baseY, maxY: baseY + h, minZ: z - thick / 2, maxZ: z + thick / 2, kind: "furn" });
      break;
    }
    case "pole": {
      const poleH = u(6), r = u(0.15);
      batch.addCylinder(x, baseY, z, r, poleH, 6, metalRect, [0.5, 0.5, 0.5]);
      collideAddBox({ minX: x - r, maxX: x + r, minY: baseY, maxY: baseY + poleH, minZ: z - r, maxZ: z + r, kind: "furn" });
      break;
    }
    default: break;
  }
}

// 汽车
function addCar(batch, x, z, yaw, rng, atlas) {
  const len = u(2.8), wid = u(1.1), h = u(0.9);
  const colors = [[0.8, 0.1, 0.1], [0.1, 0.1, 0.8], [0.9, 0.9, 0.9], [0.2, 0.2, 0.2], [0.8, 0.8, 0.2]];
  const tint = choice(rng, colors);
  const metalRect = getAtlasRect(8);
  // 车身
  batch.addBox(x, WORLD.CURB_H + h / 2, z, len, h, wid, yaw, metalRect, tint);
  // 车顶
  batch.addBox(x, WORLD.CURB_H + h + u(0.3), z, len * 0.6, u(0.5), wid * 0.8, yaw, metalRect, tint);
  // 碰撞
  collideAddBox({ minX: x - len / 2, maxX: x + len / 2, minY: WORLD.CURB_H, maxY: WORLD.CURB_H + h + u(0.5), minZ: z - wid / 2, maxZ: z + wid / 2, kind: "card" });
}

// 建筑生成
function addBuilding(batch, block, edge, cursor, WPH, DPH, HPH, zone, rng, atlas, isMainRoad) {
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

  // 基座：1~2层，每层2.2 PH
  const floors = rng() < 0.5 ? 1 : 2;
  const baseH = u(floors * 2.2);
  const upperH = Math.max(u(1), H - baseH);

  // 退台 35%
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

  // 双体量 25%
  const hasDouble = rng() < 0.25 && !hasSetback;
  if (hasDouble) {
    const split = randRange(rng, 0.4, 0.6);
    const W1 = W * split, W2 = W * (1 - split);
    const H1 = H, H2 = H * randRange(rng, 0.6, 1.0);
    // 两个盒子并排
    const offset = W2 / 2;
    // 第一个
    batch.addBox(cx - offset, H1 / 2, cz, W1, H1, D, 0, winRect, tint, { uScale: WPH / 2.5, vScale: HPH / 2.2 });
    collideAddBox({ minX: cx - offset - W1 / 2, maxX: cx - offset + W1 / 2, minY: 0, maxY: H1, minZ: cz - D / 2, maxZ: cz + D / 2, kind: "build" });
    // 第二个
    batch.addBox(cx + W1 / 2 + W2 / 2 - offset, H2 / 2, cz, W2, H2, D, 0, winRect, tint, { uScale: W2 / u(1) / 2.5, vScale: H2 / u(1) / 2.2 });
    collideAddBox({ minX: cx + W1 / 2 - offset, maxX: cx + W1 / 2 + W2 - offset, minY: 0, maxY: H2, minZ: cz - D / 2, maxZ: cz + D / 2, kind: "build" });
    // 女儿墙
    const parapetH = u(0.4);
    batch.addBox(cx, H + parapetH / 2, cz, W + u(0.2), parapetH, D + u(0.2), 0, roofRect, tint);
    return;
  }

  // 正常：按退台段生成
  for (const seg of segments) {
    const segW = W - seg.inset * 2;
    const segD = D - seg.inset * 2;
    if (segW <= u(1) || segD <= u(1)) continue;
    const segY = seg.y + seg.h / 2;
    // 基座部分用玻璃门材质
    if (seg.y < baseH) {
      const hInBase = Math.min(seg.h, baseH - seg.y);
      // 基座
      batch.addBox(cx, seg.y + hInBase / 2, cz, segW, hInBase, segD, 0, doorRect, tint);
      // 上部（如果段跨越基座）
      if (seg.h > hInBase) {
        const upperSegH = seg.h - hInBase;
        batch.addBox(cx, seg.y + hInBase + upperSegH / 2, cz, segW, upperSegH, segD, 0, winRect, tint, { uScale: WPH / 2.5, vScale: HPH / 2.2 });
      }
    } else {
      batch.addBox(cx, segY, cz, segW, seg.h, segD, 0, winRect, tint, { uScale: WPH / 2.5, vScale: HPH / 2.2 });
    }
    // 碰撞：每段一个盒子
    collideAddBox({ minX: cx - segW / 2, maxX: cx + segW / 2, minY: seg.y, maxY: seg.y + seg.h, minZ: cz - segD / 2, maxZ: cz + segD / 2, kind: "build" });
  }

  // 女儿墙必然有
  const parapetH = u(0.4);
  batch.addBox(cx, H + parapetH / 2, cz, W + u(0.1), parapetH, D + u(0.1), 0, roofRect, tint);

  // 屋顶道具 45%，只在距原点 600 PH 内 + 主干道
  const distPH = Math.hypot(block.cxPH, block.czPH);
  if (distPH < 600 && isMainRoad && rng() < 0.45) {
    const propCount = randInt(rng, 1, 3);
    for (let i = 0; i < propCount; i++) {
      const px = cx + (rng() - 0.5) * W * 0.6;
      const pz = cz + (rng() - 0.5) * D * 0.6;
      const pw = u(randRange(rng, 0.4, 0.8));
      const ph = u(randRange(rng, 0.4, 1.0));
      const pd = u(randRange(rng, 0.4, 0.8));
      batch.addBox(px, H + ph / 2, pz, pw, ph, pd, 0, metalRect, [0.5, 0.5, 0.55]);
    }
  }

  // 底座挑出遮阳棚 0.5 PH 薄板
  if (rng() < 0.6) {
    const awningW = W * 0.8, awningD = u(0.5);
    batch.addBox(cx, baseH + u(0.1), cz + D / 2 + awningD / 2, awningW, u(0.05), awningD, 0, metalRect, [0.9, 0.9, 0.9]);
  }
}

// 主函数：buildCity
export function buildCity(scene, opts = {}) {
  const startTime = performance.now();
  const seed = opts.seed || CFG.CITY_SEED;
  const blocks = generateBlocks(seed);

  const tileBlocks = CFG.TILE_BLOCKS; // 7
  const grid = CFG.CITY_GRID; // 28
  const tilesPerSide = Math.ceil(grid / tileBlocks); // 4
  const tileSizePH = tileBlocks * CFG.BLOCK_PITCH; // 462
  const tileSize = u(tileSizePH);

  // 创建 atlas
  const atlas = buildAtlas(scene);
  const atlasTex = atlas.texture;

  // 创建材质
  const cityMat = createCityMaterial(scene, atlasTex, "cityMat");

  // 地面：大平面 AABB
  const cityHalf = u(grid * CFG.BLOCK_PITCH / 2);
  collideAddBox({ minX: -cityHalf - 10, maxX: cityHalf + 10, minY: -1, maxY: 0, minZ: -cityHalf - 10, maxZ: cityHalf + 10, kind: "ground" });

  // 边界隐形墙
  const wallH = u(10);
  const wallThick = u(2);
  // 4 面墙
  collideAddBox({ minX: -cityHalf - wallThick, maxX: -cityHalf, minY: 0, maxY: wallH, minZ: -cityHalf - 10, maxZ: cityHalf + 10, kind: "wall" });
  collideAddBox({ minX: cityHalf, maxX: cityHalf + wallThick, minY: 0, maxY: wallH, minZ: -cityHalf - 10, maxZ: cityHalf + 10, kind: "wall" });
  collideAddBox({ minX: -cityHalf - 10, maxX: cityHalf + 10, minY: 0, maxY: wallH, minZ: -cityHalf - wallThick, maxZ: -cityHalf, kind: "wall" });
  collideAddBox({ minX: -cityHalf - 10, maxX: cityHalf + 10, minY: 0, maxY: wallH, minZ: cityHalf, maxZ: cityHalf + wallThick, kind: "wall" });

  const tiles = [];
  let totalTris = 0;
  let totalVerts = 0;
  let buildingCount = 0;

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

      // 地面：整个 tile 的沥青
      const asphaltRect = getAtlasRect(4);
      batch.addQuad(
        { x: tileMinX, y: 0, z: tileMinZ },
        { x: tileMaxX, y: 0, z: tileMinZ },
        { x: tileMaxX, y: 0, z: tileMaxZ },
        { x: tileMinX, y: 0, z: tileMaxZ },
        asphaltRect,
        [0.9, 0.9, 0.9]
      );

      // 遍历块
      for (let bx = tileMinBX; bx <= tileMaxBX; bx++) {
        for (let bz = tileMinBZ; bz <= tileMaxBZ; bz++) {
          const blockIdx = bx * grid + bz; // 注意 generateBlocks 顺序是 bx outer, bz inner, 但我们用 find
          const block = blocks.find(b => b.bx === bx && b.bz === bz);
          if (!block) continue;

          const rng = mulberry32(seedFor(`b-${bx}-${bz}`, bx, bz));

          // 中心广场特殊处理
          if (block.isCenterPlaza) {
            // 广场砖
            const brickRect = getAtlasRect(6);
            batch.addQuad(
              { x: block.cx - block.netW / 2, y: 0.001, z: block.cz - block.netD / 2 },
              { x: block.cx + block.netW / 2, y: 0.001, z: block.cz - block.netD / 2 },
              { x: block.cx + block.netW / 2, y: 0.001, z: block.cz + block.netD / 2 },
              { x: block.cx - block.netW / 2, y: 0.001, z: block.cz + block.netD / 2 },
              brickRect,
              [1, 1, 1]
            );
            // 喷泉
            const fountainR = u(2);
            batch.addCylinder(block.cx, 0.001, block.cz, fountainR, u(0.5), 12, brickRect, [0.8, 0.8, 0.9]);
            // 花坛
            for (let f = 0; f < 4; f++) {
              const ang = (f / 4) * Math.PI * 2;
              const fx = block.cx + Math.cos(ang) * u(8);
              const fz = block.cz + Math.sin(ang) * u(8);
              batch.addBox(fx, u(0.2), fz, u(1.5), u(0.4), u(1.5), 0, brickRect, [0.6, 0.5, 0.4]);
            }
            continue;
          }

          // 公园：无楼，草地 + 树 + 长椅
          if (block.zone === "park") {
            const grassRect = getAtlasRect(7);
            batch.addQuad(
              { x: block.cx - block.netW / 2, y: 0.001, z: block.cz - block.netD / 2 },
              { x: block.cx + block.netW / 2, y: 0.001, z: block.cz - block.netD / 2 },
              { x: block.cx + block.netW / 2, y: 0.001, z: block.cz + block.netD / 2 },
              { x: block.cx - block.netW / 2, y: 0.001, z: block.cz + block.netD / 2 },
              grassRect,
              [1, 1, 1]
            );
            // 随机树
            const treeCount = randInt(rng, 5, 12);
            for (let t = 0; t < treeCount; t++) {
              const tx = block.cx + (rng() - 0.5) * block.netW * 0.8;
              const tz = block.cz + (rng() - 0.5) * block.netD * 0.8;
              addFurniture(batch, { type: "tree" }, tx, tz, 0, rng, atlas);
            }
            // 长椅
            for (let b = 0; b < 3; b++) {
              const bx = block.cx + (rng() - 0.5) * block.netW * 0.6;
              const bz = block.cz + (rng() - 0.5) * block.netD * 0.6;
              addFurniture(batch, { type: "bench" }, bx, bz, rng() * Math.PI * 2, rng, atlas);
            }
            continue;
          }

          // 人行道：4 条边
          const sidewalkW = WORLD.SIDEWALK;
          const curbH = WORLD.CURB_H;
          const brickRect = getAtlasRect(6);
          // 北
          batch.addBox(block.cx, curbH / 2, block.cz + block.netD / 2 + sidewalkW / 2, block.netW + sidewalkW * 2, curbH, sidewalkW, 0, brickRect, [1, 1, 1]);
          collideAddBox({ minX: block.cx - (block.netW + sidewalkW * 2) / 2, maxX: block.cx + (block.netW + sidewalkW * 2) / 2, minY: 0, maxY: curbH, minZ: block.cz + block.netD / 2, maxZ: block.cz + block.netD / 2 + sidewalkW, kind: "curb" });
          // 南
          batch.addBox(block.cx, curbH / 2, block.cz - block.netD / 2 - sidewalkW / 2, block.netW + sidewalkW * 2, curbH, sidewalkW, 0, brickRect, [1, 1, 1]);
          collideAddBox({ minX: block.cx - (block.netW + sidewalkW * 2) / 2, maxX: block.cx + (block.netW + sidewalkW * 2) / 2, minY: 0, maxY: curbH, minZ: block.cz - block.netD / 2 - sidewalkW, maxZ: block.cz - block.netD / 2, kind: "curb" });
          // 东
          batch.addBox(block.cx + block.netW / 2 + sidewalkW / 2, curbH / 2, block.cz, sidewalkW, curbH, block.netD, 0, brickRect, [1, 1, 1]);
          collideAddBox({ minX: block.cx + block.netW / 2, maxX: block.cx + block.netW / 2 + sidewalkW, minY: 0, maxY: curbH, minZ: block.cz - block.netD / 2, maxZ: block.cz + block.netD / 2, kind: "curb" });
          // 西
          batch.addBox(block.cx - block.netW / 2 - sidewalkW / 2, curbH / 2, block.cz, sidewalkW, curbH, block.netD, 0, brickRect, [1, 1, 1]);
          collideAddBox({ minX: block.cx - block.netW / 2 - sidewalkW, maxX: block.cx - block.netW / 2, minY: 0, maxY: curbH, minZ: block.cz - block.netD / 2, maxZ: block.cz + block.netD / 2, kind: "curb" });

          // 建筑：沿四边布置
          const zoneParam = ZONE_PARAMS[block.zone] || ZONE_PARAMS.residential;
          const totalBuildings = randInt(rng, 4, 8);
          const edges = ["north", "south", "east", "west"];
          let remaining = totalBuildings;
          const perEdge = [0, 0, 0, 0];
          for (let i = 0; i < remaining; i++) perEdge[i % 4]++;
          // 若某边 0，随机分配
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

              addBuilding(batch, block, edge, { x: bxPos, z: bzPos }, WPH, DPH, HPH, block.zone, rng, atlas, block.isMain);
              buildingCount++;
              cursorPos += u(WPH + gapPH);
            }
          }

          // 街具：沿人行道布置
          // 每条边按 spacing 放置
          for (const def of FURNITURE_DEFS) {
            if (def.type === "signal" || def.type === "sign") continue; // 只路口
            if (block.zone === "park") continue; // 公园已处理
            // 主干道才有护栏
            if (def.type === "guard" && !block.isMain) continue;
            // 电线杆只在老城区
            if (def.type === "pole" && block.zone !== "oldtown" && rng() > 0.3) continue;

            const spacingWorld = u(def.spacing);
            const jitter = 0.15;
            const phase = rng() * spacingWorld;

            // 四条边
            for (const edge of edges) {
              const isHorizontal = edge === "north" || edge === "south";
              const edgeLen = isHorizontal ? block.netW : block.netD;
              const steps = Math.floor(edgeLen / spacingWorld);
              for (let s = 0; s < steps; s++) {
                if (rng() < 0.3) continue; // 稀疏化
                const offset = (s * spacingWorld + phase + (rng() - 0.5) * spacingWorld * jitter);
                if (Math.abs(offset) > edgeLen / 2 - u(1)) continue;

                let fx, fz, yaw = 0;
                const dist = u(def.dist);
                if (edge === "north") {
                  fx = block.cx + offset;
                  fz = block.cz + block.netD / 2 + sidewalkW / 2;
                  yaw = 0;
                } else if (edge === "south") {
                  fx = block.cx + offset;
                  fz = block.cz - block.netD / 2 - sidewalkW / 2;
                  yaw = Math.PI;
                } else if (edge === "east") {
                  fx = block.cx + block.netW / 2 + sidewalkW / 2;
                  fz = block.cz + offset;
                  yaw = Math.PI / 2;
                } else {
                  fx = block.cx - block.netW / 2 - sidewalkW / 2;
                  fz = block.cz + offset;
                  yaw = -Math.PI / 2;
                }
                // 偏移 dist 从路缘
                const offX = Math.cos(yaw) * dist;
                const offZ = Math.sin(yaw) * dist;
                // 街具应在人行道内侧，微调
                fx += offX * 0.2;
                fz += offZ * 0.2;

                addFurniture(batch, def, fx, fz, yaw, rng, atlas);
              }
            }
          }

          // 车：路边停车
          if (block.zone !== "park" && rng() < 0.7) {
            const carCount = randInt(rng, 1, 3);
            for (let c = 0; c < carCount; c++) {
              const side = choice(rng, ["north", "south", "east", "west"]);
              const offset = (rng() - 0.5) * (side === "north" || side === "south" ? block.netW : block.netD) * 0.6;
              let cx, cz, yaw;
              if (side === "north") {
                cx = block.cx + offset;
                cz = block.cz + block.netD / 2 + sidewalkW + u(1.5);
                yaw = 0;
              } else if (side === "south") {
                cx = block.cx + offset;
                cz = block.cz - block.netD / 2 - sidewalkW - u(1.5);
                yaw = Math.PI;
              } else if (side === "east") {
                cx = block.cx + block.netW / 2 + sidewalkW + u(1.5);
                cz = block.cz + offset;
                yaw = Math.PI / 2;
              } else {
                cx = block.cx - block.netW / 2 - sidewalkW - u(1.5);
                cz = block.cz + offset;
                yaw = -Math.PI / 2;
              }
              addCar(batch, cx, cz, yaw, rng, atlas);
            }
          }

          // 路口标线：斑马线
          if (isMainRoad(bx) || isMainRoad(bz)) {
            const zebraRect = getAtlasRect(13);
            // 在块的四角路口处画斑马线（简化：每个块中心附近不画，只在主干道交叉）
            if (isMainRoad(bx) && isMainRoad(bz)) {
              // 十字路口中心
              const ix = u((bx - grid / 2) * CFG.BLOCK_PITCH);
              const iz = u((bz - grid / 2) * CFG.BLOCK_PITCH);
              const zw = u(3), zl = u(1);
              // 四组斑马线
              for (let dir = 0; dir < 4; dir++) {
                const ang = dir * Math.PI / 2;
                const px = ix + Math.cos(ang) * u(4);
                const pz = iz + Math.sin(ang) * u(4);
                batch.addQuad(
                  { x: px - zw / 2, y: 0.002, z: pz - zl / 2 },
                  { x: px + zw / 2, y: 0.002, z: pz - zl / 2 },
                  { x: px + zw / 2, y: 0.002, z: pz + zl / 2 },
                  { x: px - zw / 2, y: 0.002, z: pz + zl / 2 },
                  zebraRect,
                  [1, 1, 1],
                  [0, 1, 0]
                );
              }
            }
          }
        }
      }

      // 将 batch 转为 mesh
      const data = batch; // GeoBatch 本身持有数据
      const stats = data.getStats();
      totalTris += stats.triangles;
      totalVerts += stats.vertices;

      let mesh = null;
      if (scene) {
        try {
          // 使用 Babylon 创建 mesh
          const { Mesh, VertexData } = window.BABYLON || {};
          if (Mesh && VertexData) {
            mesh = new Mesh(`cityTile_${tx}_${tz}`, scene);
            const vd = new VertexData();
            vd.positions = data.pos;
            vd.normals = data.nrm;
            vd.uvs = data.uv;
            vd.colors = data.col;
            vd.indices = data.idx;
            vd.applyToMesh(mesh, false);
            mesh.material = cityMat;
            mesh.isPickable = false;
            mesh.receiveShadows = true;
            // 不投射阴影，省 shadow map
            mesh.castShadows = false;
          } else {
            // 尝试动态 import
            // 退化：不创建 mesh，但保留数据
          }
        } catch (e) {
          console.warn("[city] tile mesh failed", e);
        }
      }

      tiles.push({
        tx, tz,
        minX: tileMinX, maxX: tileMaxX, minZ: tileMinZ, maxZ: tileMaxZ,
        centerX: tileCenterX, centerZ: tileCenterZ,
        mesh,
        batch: data,
        stats,
      });
    }
  }

  // 地标：电视塔 120 PH，钟楼 45 PH
  const landmarks = [];
  // 电视塔：商业区边缘
  {
    const towerH = u(120);
    const towerR = u(0.5);
    const tx = u(30), tz = u(10); // 商业区边缘大致
    const batch = new GeoBatch();
    const metalRect = getAtlasRect(8);
    // 塔身
    batch.addCylinder(tx, 0, tz, towerR, towerH * 0.8, 8, metalRect, [0.7, 0.7, 0.75]);
    // 圆盘
    batch.addCylinder(tx, towerH * 0.7, tz, u(3), u(0.5), 12, metalRect, [0.8, 0.8, 0.85]);
    // 天线
    batch.addCylinder(tx, towerH * 0.8, tz, u(0.1), towerH * 0.2, 6, metalRect, [0.6, 0.6, 0.65]);
    // 碰撞
    collideAddBox({ minX: tx - towerR, maxX: tx + towerR, minY: 0, maxY: towerH, minZ: tz - towerR, maxZ: tz + towerR, kind: "build" });
    landmarks.push({ type: "tvTower", x: tx, z: tz, h: towerH, batch });
  }
  // 钟楼：中心广场一角
  {
    const towerH = u(45);
    const cx = u(5), cz = u(5);
    const batch = new GeoBatch();
    const brickRect = getAtlasRect(6);
    batch.addBox(cx, towerH / 2, cz, u(4), towerH, u(4), 0, brickRect, [0.8, 0.75, 0.7]);
    // 钟面
    const signRect = getAtlasRect(10);
    batch.addBox(cx, towerH * 0.8, cz + u(2.1), u(1.5), u(1.5), u(0.1), 0, signRect, [1, 1, 1]);
    // 尖顶
    batch.addCylinder(cx, towerH, cz, u(0.1), u(3), 4, brickRect, [0.6, 0.3, 0.2]);
    collideAddBox({ minX: cx - u(2), maxX: cx + u(2), minY: 0, maxY: towerH + u(3), minZ: cz - u(2), maxZ: cz + u(2), kind: "build" });
    landmarks.push({ type: "clockTower", x: cx, z: cz, h: towerH, batch });
  }

  // 远景剪影环：半径 70 世界单位
  let skylineMesh = null;
  if (scene && typeof window !== "undefined" && window.BABYLON) {
    try {
      const BABYLON = window.BABYLON;
      const skylineR = CFG.SKYLINE_R; // 70 世界单位
      const skylineBatch = new GeoBatch();
      const silhouetteRect = getAtlasRect(14); // 纯色
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
      const data = skylineBatch;
      const mesh = new BABYLON.Mesh("skylineRing", scene);
      const vd = new BABYLON.VertexData();
      vd.positions = data.pos;
      vd.normals = data.nrm;
      vd.uvs = data.uv;
      vd.colors = data.col;
      vd.indices = data.idx;
      vd.applyToMesh(mesh, false);
      const mat = new BABYLON.StandardMaterial("skylineMat", scene);
      mat.diffuseColor = new BABYLON.Color3(0.35, 0.42, 0.52);
      mat.emissiveColor = new BABYLON.Color3(0.1, 0.12, 0.15);
      mat.backFaceCulling = false;
      mesh.material = mat;
      mesh.isPickable = false;
      skylineMesh = mesh;
    } catch (e) {
      console.warn("[city] skyline failed", e);
    }
  }

  const endTime = performance.now();
  const genTime = endTime - startTime;

  // 统计
  const stats = {
    tileCount: tiles.length,
    buildingCount,
    triCount: totalTris,
    vertCount: totalVerts,
    aabbCount: 0, // 稍后从 collide 获取
    genTime,
    atlasSize: 1024,
  };

  return {
    tiles,
    blocks,
    landmarks,
    skylineMesh,
    atlas,
    material: cityMat,
    stats,
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
    if (tile.mesh.isEnabled() !== shouldShow) {
      tile.mesh.setEnabled(shouldShow);
    }
  }
}

// 额外：创建天空球和雾、光照（黄昏）
export function setupSkyAndLights(scene, opts = {}) {
  if (!scene) return null;
  let skyMesh = null;
  try {
    const BABYLON = window.BABYLON;
    if (!BABYLON) return null;

    // 天空球：反置大球 r=100，256×256 渐变
    const skySize = 256;
    const skyCanvas = document.createElement("canvas");
    skyCanvas.width = 16;
    skyCanvas.height = skySize;
    const sctx = skyCanvas.getContext("2d");
    const grad = sctx.createLinearGradient(0, 0, 0, skySize);
    grad.addColorStop(0, "#1b2a4a");
    grad.addColorStop(0.5, "#6b5b7a");
    grad.addColorStop(1, "#e0a878");
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 16, skySize);
    // 云带
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

    skyMesh = BABYLON.MeshBuilder.CreateSphere("skySphere", { diameter: 200, segments: 16 }, scene);
    skyMesh.material = skyMat;
    skyMesh.isPickable = false;
    skyMesh.infiniteDistance = true;
    skyMesh.renderingGroupId = 0;

    // 雾
    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogColor = new BABYLON.Color3(0.79, 0.64, 0.48); // #c9a27a
    scene.fogDensity = CFG.FOG_DENSITY;

    // 太阳：平行光，俯角 8°，方位 200°
    const sunDir = new BABYLON.Vector3(
      Math.cos(200 * Math.PI / 180) * Math.cos(8 * Math.PI / 180),
      -Math.sin(8 * Math.PI / 180),
      Math.sin(200 * Math.PI / 180) * Math.cos(8 * Math.PI / 180)
    );
    let dirLight = scene.lights ? scene.lights.find(l => l.name === "dir") : null;
    if (!dirLight) {
      dirLight = new BABYLON.DirectionalLight("sun", sunDir, scene);
    } else {
      dirLight.direction = sunDir;
    }
    dirLight.intensity = 2.2;
    dirLight.diffuse = new BABYLON.Color3(1, 0.84, 0.66); // #ffd7a8
    // 阴影
    if (dirLight) {
      dirLight.shadowMinZ = 0.5;
      dirLight.shadowMaxZ = 60;
    }

    // 半球光
    let hemi = scene.lights ? scene.lights.find(l => l.name === "hemi") : null;
    if (!hemi) {
      hemi = new BABYLON.HemisphericLight("hemiSky", new BABYLON.Vector3(0, 1, 0), scene);
    }
    hemi.intensity = 0.35;
    hemi.diffuse = new BABYLON.Color3(0.42, 0.49, 0.66); // #6b7ea8
    hemi.groundColor = new BABYLON.Color3(0.23, 0.23, 0.27); // #3a3a44

    // 补光
    const fillDir = sunDir.scale(-1);
    let fill = scene.lights ? scene.lights.find(l => l.name === "fill") : null;
    if (!fill) {
      fill = new BABYLON.DirectionalLight("fillLight", fillDir, scene);
    }
    fill.intensity = 0.25;
    fill.diffuse = new BABYLON.Color3(0.8, 0.8, 0.9);

    scene.clearColor = new BABYLON.Color4(0.13, 0.14, 0.17, 1);
    scene.ambientColor = new BABYLON.Color3(0.35, 0.35, 0.38);

    return { skyMesh, dirLight, hemiLight: hemi, fillLight: fill };
  } catch (e) {
    console.warn("[city] setup sky/lights failed", e);
    return null;
  }
}

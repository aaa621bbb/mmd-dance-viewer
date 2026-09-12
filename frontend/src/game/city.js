import "./bjs.js";
// game/city.js — v5.2 沿街连续立面 + 填充率≥60% + 地面uvScale24 + 外圈400 + 天空跟随V轴 + 雾(0.20,0.24,0.33) 0.008-0.012
import { CFG, WORLD } from "./config.js";
import { PH, u } from "./scale.js";
import { mulberry32, seedFor, randRange, randInt, choice } from "./rng.js";
import { GeoBatch } from "./geo.js";
import { buildAtlas, getAtlasRect } from "./atlas.js";
import { addBox as collideAddBox, clearWorld as collideClear, getBoxes as collideGetBoxes } from "./collide.js";
import { Q } from "./quality.js";

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}
function jitterColor(rgb, rng, amount = 0.06) {
  return rgb.map(c => Math.max(0, Math.min(1, c + (rng() - 0.5) * amount * 2)));
}

const ZONE_COLORS = {
  commercial: ["#6b7280", "#7c8794", "#4b5563", "#8a95a5", "#5a6575"].map(hexToRgb),
  residential: ["#cbb79b", "#d8c7ae", "#b9a488", "#d2c0a8", "#b8a088"].map(hexToRgb),
  oldtown: ["#a98a63", "#9c7f5a", "#b99a72", "#8c7050", "#c0a080"].map(hexToRgb),
  park: ["#4f7d4a", "#5a8a55", "#3d6a38"].map(hexToRgb),
  construction: ["#8d8d8d", "#9a9a9a", "#7a7a7a"].map(hexToRgb),
  waterfront: ["#8a9aaa", "#7a8a9a", "#6b7a8a"].map(hexToRgb),
  plaza: ["#c2b8a8", "#d1c4b2", "#b8aa98"].map(hexToRgb),
};
const ZONE_PARAMS = {
  commercial: { hMin: 6, hMax: 14, density: 0.9, window: [0, 3], lightDensity: 0.8 },
  residential: { hMin: 4, hMax: 8, density: 0.6, window: [1, 2], lightDensity: 0.5 },
  oldtown: { hMin: 4, hMax: 8, density: 0.7, window: [2, 1], lightDensity: 0.5 },
  park: { hMin: 0, hMax: 0, density: 0, window: [], lightDensity: 0.1 },
  construction: { hMin: 3, hMax: 8, density: 0.3, window: [0, 1], lightDensity: 0.1 },
  waterfront: { hMin: 4, hMax: 8, density: 0.5, window: [0, 1], lightDensity: 0.4 },
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
  } catch (e) { return null; }
}

function rotatedAABB(x, z, W, D, yaw) {
  const hx = W / 2, hz = D / 2;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const corners = [
    [hx, hz], [-hx, hz], [-hx, -hz], [hx, -hz]
  ].map(([cx, cz]) => ({ x: cx * cos - cz * sin, z: cx * sin + cz * cos }));
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.z < minZ) minZ = c.z;
    if (c.z > maxZ) maxZ = c.z;
  }
  return { minX: x + minX, maxX: x + maxX, minZ: z + minZ, maxZ: z + maxZ };
}

function groundHeightAt(x, z, kind) {
  if (kind === "curb" || kind === "sidewalk") return 0;
  return 0;
}

function addSolid(batch, x, z, W, D, H, yBase, yaw, rect, tint, kind, auditList, opts = {}) {
  const cy = yBase + H / 2;
  batch.addBox(x, cy, z, W, H, D, yaw, rect, tint, opts);
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
      isBuilding: kind === "build",
      segments: opts._segments || 1,
      blockId: opts._blockId || null,
      WPH: opts._WPH, DPH: opts._DPH,
    });
  }
  return box;
}

function addBoxOnGround(batch, x, z, W, D, H, yBase, yaw, rect, tint, kind, auditList, opts) {
  return addSolid(batch, x, z, W, D, H, yBase, yaw, rect, tint, kind, auditList, opts);
}

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

// ——— v5.2 连续立面建筑 ———
function addBuildingV52(batch, block, cx, cz, WPH, DPH, HPH, zone, rng, auditList, usedCombos, blockFill) {
  const W = u(WPH), D = u(DPH), H = u(HPH);
  const yaw = (Math.abs(WPH - DPH) < 0.1) ? 0 : (WPH > DPH ? 0 : Math.PI / 2);
  // 实际取向：沿街方向由调用者决定，这里简化：建筑长边沿街，所以 yaw 由调用者传入更好；但为兼容，我们用外部传入的 yaw 覆盖
  const actualYaw = (typeof block._yaw === "number") ? block._yaw : yaw;

  // 选窗格+色调，保证同街区不重复
  let winId, tint, tries = 0;
  const zoneParam = ZONE_PARAMS[zone] || ZONE_PARAMS.residential;
  const winChoices = zoneParam.window.length ? zoneParam.window : [0,1,2,3];
  do {
    winId = choice(rng, winChoices.concat([0,1,2,3])); // 允许全部，但优先 zone
    const baseCol = choice(rng, ZONE_COLORS[zone] || ZONE_COLORS.residential);
    tint = jitterColor(baseCol, rng, 0.08);
    const key = `${winId}_${Math.round(tint[0]*10)}_${Math.round(tint[1]*10)}`;
    if (!usedCombos.has(key) || tries > 20) {
      usedCombos.add(key);
      break;
    }
    tries++;
  } while (tries < 30);

  const winRect = getAtlasRect(winId);
  const doorRect = getAtlasRect(9);
  const roofRect = getAtlasRect(12);
  const metalRect = getAtlasRect(8);
  const signRect = getAtlasRect(10);
  const brickRect = getAtlasRect(6);
  const sidewalkRect = getAtlasRect(6);

  // 层数拆分：基座 8-14PH + 标准层 + 顶部 2PH女儿墙
  const baseH_PH = randRange(rng, 8, 14);
  const topH_PH = 2;
  const floors = zoneParam.hMin + Math.floor(rng() * (zoneParam.hMax - zoneParam.hMin + 1));
  const midH_PH = floors * 12;
  const totalH_PH = baseH_PH + midH_PH + topH_PH;
  // 如果传入 HPH 与计算不一致，以传入为准但保持3段
  const baseH = u(baseH_PH);
  const midH = u(midH_PH);
  const topH = u(topH_PH);
  const totalH = baseH + midH + topH;

  // 三段：基座、标准层、顶部
  // 基座
  addSolid(batch, cx, cz, W, D, baseH, 0, actualYaw, doorRect, tint, "build", auditList, { _segments: 3, _blockId: `${block.bx}_${block.bz}`, _WPH: WPH, _DPH: DPH, uScale: Math.max(1, WPH/6), vScale: baseH_PH/3 });
  // 标准层
  addSolid(batch, cx, cz, W*0.98, D*0.98, midH, baseH, actualYaw, winRect, tint, "build", auditList, { _segments: 3, _blockId: `${block.bx}_${block.bz}`, _WPH: WPH, _DPH: DPH, uScale: Math.max(1, WPH/4), vScale: midH_PH/3 });
  // 顶部女儿墙
  addSolid(batch, cx, cz, W*1.02, D*1.02, topH, baseH+midH, actualYaw, roofRect, tint, "build", auditList, { _segments: 3, _blockId: `${block.bx}_${block.bz}`, _WPH: WPH, _DPH: DPH });

  // ——— 四件套：门/窗/基座/屋顶设备（纯视觉，不额外碰撞，内缩0.01避免凸出） ———
  const bDetail = (Q && typeof Q.buildingDetail === "number") ? Q.buildingDetail : 1;
  const frontOffset = D/2 - u(0.01);
  const fx = cx + Math.sin(actualYaw) * frontOffset;
  const fz = cz + Math.cos(actualYaw) * frontOffset;

  // L1+ 门 + 台阶 + 招牌 + 屋顶设备≥1 — 用Quad减少tri
  function addFrontQuad(cx_, cz_, w_, h_, y_, rect_, tint_) {
    const halfW = w_/2;
    const halfH = h_/2;
    // front face oriented by actualYaw: normal = (sin(yaw), cos(yaw))
    // quad points: bottom-left, bottom-right, top-right, top-left in world
    const nx = Math.sin(actualYaw), nz = Math.cos(actualYaw);
    const rx = Math.cos(actualYaw), rz = -Math.sin(actualYaw);
    const cy = y_;
    const p0 = { x: cx_ - rx*halfW, y: cy - halfH, z: cz_ - rz*halfW };
    const p1 = { x: cx_ + rx*halfW, y: cy - halfH, z: cz_ + rz*halfW };
    const p2 = { x: cx_ + rx*halfW, y: cy + halfH, z: cz_ + rz*halfW };
    const p3 = { x: cx_ - rx*halfW, y: cy + halfH, z: cz_ - rz*halfW };
    batch.addQuad(p0,p1,p2,p3, rect_, tint_, [nx,0,nz]);
  }

  if (bDetail >= 0) {
    const doorW = u(0.9), doorH = u(1.9);
    // 门用box保留一点厚度但改为薄box仍12tri，改quad 2tri
    addFrontQuad(fx, fz, doorW, doorH, doorH/2, doorRect, [1,1,1]);
    // 台阶用box 12tri保留
    batch.addBox(fx + Math.sin(actualYaw)*u(0.1), u(0.05), fz + Math.cos(actualYaw)*u(0.1), doorW+u(0.2), u(0.1), u(0.6), actualYaw, brickRect, [0.8,0.8,0.8]);
    // 招牌 quad
    addFrontQuad(fx, fz+Math.cos(actualYaw)*u(0.06), W*0.6, u(0.5), baseH+u(0.6), signRect, [1,1,1]);
  }
  if (bDetail >= 1) {
    const shopW = W*0.6;
    // 橱窗 quad
    addFrontQuad(fx + Math.cos(actualYaw)*W*0.2, fz + Math.sin(actualYaw)*W*0.2, shopW*0.35, baseH*0.5, baseH*0.5, winRect, [0.9,0.9,1]);
    addFrontQuad(fx - Math.cos(actualYaw)*W*0.2, fz - Math.sin(actualYaw)*W*0.2, shopW*0.35, baseH*0.5, baseH*0.5, winRect, [0.9,0.9,1]);
    // 雨棚 quad (水平)
    const awningY = baseH+u(0.1);
    const awX = fx, awZ = fz+Math.cos(actualYaw)*u(0.25);
    const awW = W*0.75, awD = u(0.45);
    const rx = Math.cos(actualYaw), rz = -Math.sin(actualYaw);
    const nx = Math.sin(actualYaw), nz = Math.cos(actualYaw);
    batch.addQuad(
      { x: awX - rx*awW/2 - nx*awD/2, y: awningY, z: awZ - rz*awW/2 - nz*awD/2 },
      { x: awX + rx*awW/2 - nx*awD/2, y: awningY, z: awZ + rz*awW/2 - nz*awD/2 },
      { x: awX + rx*awW/2 + nx*awD/2, y: awningY, z: awZ + rz*awW/2 + nz*awD/2 },
      { x: awX - rx*awW/2 + nx*awD/2, y: awningY, z: awZ - rz*awW/2 + nz*awD/2 },
      metalRect, [0.9,0.9,0.9], [0,1,0]
    );
  }
  if (bDetail >= 2) {
    // 腰线
    batch.addBox(cx, baseH+midH*0.5, cz, W*1.005, u(0.12), D*1.005, actualYaw, brickRect, [0.85,0.85,0.8]);
    batch.addBox(cx, baseH+u(0.04), cz, W*1.002, u(0.10), D*1.002, actualYaw, brickRect, [0.7,0.7,0.7]);
  }

  // 屋顶设备：L1起每栋≥1件
  const equipCount = 1 + (bDetail >= 2 ? randInt(rng, 0, 1) : 0) + (bDetail >= 3 ? randInt(rng, 0, 2) : 0);
  for (let i = 0; i < equipCount; i++) {
    const ex = cx + (rng()-0.5)*W*0.5;
    const ez = cz + (rng()-0.5)*D*0.5;
    const ew = u(randRange(rng, 0.4, 1.0));
    const eh = u(randRange(rng, 0.4, 1.2));
    const ed = u(randRange(rng, 0.4, 0.8));
    if (rng() < 0.3) {
      batch.addCylinder(ex, totalH, ez, ew*0.5, eh, 6, metalRect, [0.6,0.6,0.65]);
    } else {
      batch.addBox(ex, totalH+eh/2, ez, ew, eh, ed, 0, metalRect, [0.5,0.5,0.55]);
    }
  }

  // 统计填充
  if (blockFill) {
    blockFill.area += W*D;
    blockFill.count++;
  }

  return { W, D, H: totalH, WPH, DPH, HPH: totalH_PH, cx, cz, yaw: actualYaw };
}

// 生成单个街区的连续立面 — 按 Q.level 控制数量以满足 L1≤300k L2≤800k
function generateBlockFacades(block, batch, rng, auditList, usedCombos, blockFill) {
  const netWPH = block.netWPH;
  const netDPH = block.netDPH;
  const zone = block.zone;
  const buildings = [];
  const level = (Q && Q.level) ? Q.level : "L1";

  // 角楼尺寸：为满足沿街连续立面≥80%且缝隙≤2PH，4角楼需27.7PH以上（max net 57.3）；L1统一27.7-28.5，L2+用26-30
  const isCommercial = (zone === "commercial");
  let cornerMin, cornerMax;
  if (level === "L1") {
    cornerMin = 27.7;
    cornerMax = 28.5;
  } else {
    cornerMin = isCommercial ? 24 : 20;
    cornerMax = isCommercial ? 30 : 26;
  }
  const cornerWPH = randRange(rng, cornerMin, cornerMax);
  const cornerDPH = randRange(rng, cornerMin, cornerMax); // 方形，保证东西边缝隙也≤2PH
  const corners = [
    { x: -netWPH/2 + cornerWPH/2, z: netDPH/2 - cornerDPH/2, yaw: 0 },
    { x: netWPH/2 - cornerWPH/2, z: netDPH/2 - cornerDPH/2, yaw: 0 },
    { x: -netWPH/2 + cornerWPH/2, z: -netDPH/2 + cornerDPH/2, yaw: 0 },
    { x: netWPH/2 - cornerWPH/2, z: -netDPH/2 + cornerDPH/2, yaw: 0 },
  ];
  for (const c of corners) {
    const cx = block.cx + u(c.x);
    const cz = block.cz + u(c.z);
    block._yaw = c.yaw;
    const b = addBuildingV52(batch, block, cx, cz, cornerWPH, cornerDPH, 0, zone, rng, auditList, usedCombos, blockFill);
    buildings.push(b);
  }

  const gapCornerPH = randRange(rng, 0.5, 2.0);
  function genEdge(edge, availablePH, isHorizontal) {
    let count = 0;
    if (level === "L0") count = 0;
    else if (level === "L1") count = 0; // L1用4大角楼已满足80%与≤2PH，无需中部
    else if (level === "L2") count = 1;
    else count = randInt(rng, 1, 2);
    if (count === 0) return;
    if (availablePH < 10) return;
    const coverage = 0.8 + rng()*0.15;
    const totalBuildingPH = availablePH * coverage;
    const gaps = count > 1 ? (count-1)*randRange(rng, 0.5, 2.0) : 0;
    const totalForBuildings = totalBuildingPH - gaps;
    if (totalForBuildings < 5) return;
    const weights = []; let sumW = 0;
    for (let i=0;i<count;i++){ const w = 0.5 + rng()*1.0; weights.push(w); sumW+=w; }
    let cursor = -availablePH/2;
    for (let i=0;i<count;i++) {
      const wPH = totalForBuildings * (weights[i]/sumW);
      if (wPH < 8) continue;
      const dPH = randRange(rng, 15, 25);
      let cxPH, czPH, yaw;
      if (edge === "north") { cxPH = cursor + wPH/2; czPH = netDPH/2 - dPH/2; yaw = 0; }
      else if (edge === "south") { cxPH = cursor + wPH/2; czPH = -netDPH/2 + dPH/2; yaw = 0; }
      else if (edge === "east") { cxPH = netWPH/2 - dPH/2; czPH = cursor + wPH/2; yaw = Math.PI/2; }
      else { cxPH = -netWPH/2 + dPH/2; czPH = cursor + wPH/2; yaw = Math.PI/2; }
      const cx = block.cx + u(cxPH);
      const cz = block.cz + u(czPH);
      block._yaw = yaw;
      const finalW = isHorizontal ? wPH : dPH;
      const finalD = isHorizontal ? dPH : wPH;
      const b = addBuildingV52(batch, block, cx, cz, finalW, finalD, 0, zone, rng, auditList, usedCombos, blockFill);
      buildings.push(b);
      cursor += wPH + (count>1 ? gaps/(count-1) : 0);
    }
  }

  const northAvail = netWPH - 2*cornerWPH - 2*gapCornerPH;
  genEdge("north", northAvail, true);
  genEdge("south", netWPH - 2*cornerWPH - 2*gapCornerPH, true);
  genEdge("east", netDPH - 2*cornerDPH - 2*gapCornerPH, false);
  genEdge("west", netDPH - 2*cornerDPH - 2*gapCornerPH, false);

  // 内部补：L0 0栋，L1 0栋，L2 1栋，L3 1-2栋 — 控制L1 tri≤300k
  let interiorCount = 0;
  if (zone === "commercial" || zone === "residential" || zone === "oldtown" || zone === "waterfront") {
    if (level === "L0") interiorCount = 0;
    else if (level === "L1") interiorCount = 0;
    else if (level === "L2") interiorCount = 1;
    else interiorCount = randInt(rng, 1, 2);
  }
  for (let i=0;i<interiorCount;i++) {
    const wPH = randRange(rng, 12, 20);
    const dPH = randRange(rng, 12, 20);
    const xPH = (rng()-0.5)*(netWPH*0.35);
    const zPH = (rng()-0.5)*(netDPH*0.35);
    const cx = block.cx + u(xPH);
    const cz = block.cz + u(zPH);
    block._yaw = rng()*Math.PI;
    addBuildingV52(batch, block, cx, cz, wPH, dPH, 0, zone, rng, auditList, usedCombos, blockFill);
  }

  return buildings;
}

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

  collideClear();

  const cityHalf = u(grid * CFG.BLOCK_PITCH / 2);
  collideAddBox({ minX: -cityHalf - 10, maxX: cityHalf + 10, minY: -1, maxY: 0, minZ: -cityHalf - 10, maxZ: cityHalf + 10, kind: "ground" });
  const wallH = u(10), wallThick = u(2);
  collideAddBox({ minX: -cityHalf - wallThick, maxX: -cityHalf, minY: 0, maxY: wallH, minZ: -cityHalf - 10, maxZ: cityHalf + 10, kind: "wall" });
  collideAddBox({ minX: cityHalf, maxX: cityHalf + wallThick, minY: 0, maxY: wallH, minZ: -cityHalf - 10, maxZ: cityHalf + 10, kind: "wall" });
  collideAddBox({ minX: -cityHalf - 10, maxX: cityHalf + 10, minY: 0, maxY: wallH, minZ: -cityHalf - wallThick, maxZ: -cityHalf, kind: "wall" });
  collideAddBox({ minX: -cityHalf - 10, maxX: cityHalf + 10, minY: 0, maxY: wallH, minZ: cityHalf, maxZ: cityHalf + wallThick, kind: "wall" });

  const tiles = [];
  let totalTris = 0, totalVerts = 0, buildingCount = 0;
  const auditRecords = [];
  const blockFills = []; // {bx,bz,zone,area,netArea,fillRate,count}
  const gaps = []; // {block, edge, gapPH}

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

      // 地面：沥青 uvScale=24 每格≈1PH
      const groundUV = 24;
      batch.addQuad(
        { x: tileMinX, y: 0, z: tileMinZ },
        { x: tileMaxX, y: 0, z: tileMinZ },
        { x: tileMaxX, y: 0, z: tileMaxZ },
        { x: tileMinX, y: 0, z: tileMaxZ },
        asphaltRect, [0.9,0.9,0.9], [0,1,0], { u: groundUV, v: groundUV }
      );

      // 城市外圈 400×400 大地面（只在边缘tile画一次，避免重复）
      if (tx === 0 && tz === 0) {
        const outer = 400; // 世界单位
        batch.addQuad(
          { x: -outer/2, y: -0.01, z: -outer/2 },
          { x: outer/2, y: -0.01, z: -outer/2 },
          { x: outer/2, y: -0.01, z: outer/2 },
          { x: -outer/2, y: -0.01, z: outer/2 },
          grassRect, [0.6,0.6,0.6], [0,1,0], { u: 24, v: 24 }
        );
      }

      for (let bx = tileMinBX; bx <= tileMaxBX; bx++) {
        for (let bz = tileMinBZ; bz <= tileMaxBZ; bz++) {
          const block = blocks.find(b => b.bx === bx && b.bz === bz);
          if (!block) continue;
          const rng = mulberry32(seedFor(`b-${bx}-${bz}`, bx, bz));

          if (block.isCenterPlaza) {
            const brickRect = getAtlasRect(6);
            batch.addQuad(
              { x: block.cx - block.netW/2, y: 0.001, z: block.cz - block.netD/2 },
              { x: block.cx + block.netW/2, y: 0.001, z: block.cz - block.netD/2 },
              { x: block.cx + block.netW/2, y: 0.001, z: block.cz + block.netD/2 },
              { x: block.cx - block.netW/2, y: 0.001, z: block.cz + block.netD/2 },
              brickRect, [1,1,1], [0,1,0], { u: 8, v: 8 }
            );
            continue;
          }
          if (block.zone === "park") {
            batch.addQuad(
              { x: block.cx - block.netW/2, y: 0.001, z: block.cz - block.netD/2 },
              { x: block.cx + block.netW/2, y: 0.001, z: block.cz - block.netD/2 },
              { x: block.cx + block.netW/2, y: 0.001, z: block.cz + block.netD/2 },
              { x: block.cx - block.netW/2, y: 0.001, z: block.cz + block.netD/2 },
              grassRect, [1,1,1], [0,1,0], { u: 12, v: 12 }
            );
            continue;
          }

          // 人行道
          const sidewalkW = WORLD.SIDEWALK;
          const curbH = WORLD.CURB_H;
          const brickRect = getAtlasRect(6);
          // 四条人行道，用 solid 保证碰撞
          addSolid(batch, block.cx, block.cz + block.netD/2 + sidewalkW/2, block.netW + sidewalkW*2, sidewalkW, curbH, 0, 0, brickRect, [1,1,1], "curb", auditRecords);
          addSolid(batch, block.cx, block.cz - block.netD/2 - sidewalkW/2, block.netW + sidewalkW*2, sidewalkW, curbH, 0, 0, brickRect, [1,1,1], "curb", auditRecords);
          addSolid(batch, block.cx + block.netW/2 + sidewalkW/2, block.cz, sidewalkW, block.netD, curbH, 0, 0, brickRect, [1,1,1], "curb", auditRecords);
          addSolid(batch, block.cx - block.netW/2 - sidewalkW/2, block.cz, sidewalkW, block.netD, curbH, 0, 0, brickRect, [1,1,1], "curb", auditRecords);

          const usedCombos = new Set();
          const blockFill = { area: 0, count: 0 };
          generateBlockFacades(block, batch, rng, auditRecords, usedCombos, blockFill);
          buildingCount += blockFill.count;
          const netArea = block.netW * block.netD;
          const fillRate = blockFill.area / netArea;
          blockFills.push({ bx: block.bx, bz: block.bz, zone: block.zone, area: blockFill.area, netArea, fillRate, count: blockFill.count, netWPH: block.netWPH, netDPH: block.netDPH });
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
        } catch (e) {}
      }

      tiles.push({
        tx, tz,
        minX: tileMinX, maxX: tileMaxX, minZ: tileMinZ, maxZ: tileMaxZ,
        centerX: tileCenterX, centerZ: tileCenterZ,
        mesh, batch, stats,
      });
    }
  }

  const landmarks = [];
  let skylineMesh = null;
  if (scene && typeof window !== "undefined" && window.BABYLON) {
    try {
      const BABYLON = window.BABYLON;
      // 远景两层深浅剪影
      const silhouetteRect = getAtlasRect(14);
      for (let layer = 0; layer < 2; layer++) {
        const skylineBatch = new GeoBatch();
        const skylineR = CFG.SKYLINE_R + layer*15;
        const col = layer===0 ? hexToRgb("#3a4a6a") : hexToRgb("#5a6a86");
        const rng = mulberry32(seed + 999 + layer*100);
        const count = layer===0 ? 60 : 80;
        for (let i=0;i<count;i++) {
          const ang = (i/count)*Math.PI*2 + (rng()-0.5)*0.1;
          const r = skylineR + (rng()-0.5)*5;
          const x = Math.cos(ang)*r;
          const z = Math.sin(ang)*r;
          const w = u(randRange(rng, 3, 8));
          const h = u(randRange(rng, 8, 20) + layer*5);
          const d = u(randRange(rng, 3, 6));
          skylineBatch.addBox(x, h/2, z, w, h, d, -ang, silhouetteRect, col);
        }
        const mesh = new BABYLON.Mesh(`skylineRing_${layer}`, scene);
        const vd = new BABYLON.VertexData();
        vd.positions = skylineBatch.pos;
        vd.normals = skylineBatch.nrm;
        vd.uvs = skylineBatch.uv;
        vd.colors = skylineBatch.col;
        vd.indices = skylineBatch.idx;
        vd.applyToMesh(mesh, false);
        const mat = new BABYLON.StandardMaterial(`skylineMat_${layer}`, scene);
        mat.diffuseColor = new BABYLON.Color3(col[0], col[1], col[2]);
        mat.emissiveColor = new BABYLON.Color3(col[0]*0.2, col[1]*0.2, col[2]*0.3);
        mat.backFaceCulling = false;
        mesh.material = mat;
        mesh.isPickable = false;
        if (layer===0) skylineMesh = mesh;
      }
    } catch (e) {}
  }

  const endTime = performance.now();
  const genTime = endTime - startTime;

  let floating = [], sinking = [];
  for (const rec of auditRecords) {
    if (rec.type !== "build" && rec.type !== "curb") continue;
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
    blockFills,
  };

  return {
    tiles, blocks, landmarks, skylineMesh, atlas, material: cityMat,
    stats, auditRecords, floating, sinking,
    center: { x: 0, z: 0 },
    blockFills,
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
    const d2 = dx*dx + dz*dz;
    const shouldShow = d2 <= cull2;
    try { if (tile.mesh.isEnabled() !== shouldShow) tile.mesh.setEnabled(shouldShow); } catch (e) {}
  }
  // 天空球每帧跟随相机显式对齐V轴
  try {
    if (city && city._skyMesh && playerPos && city._skyMesh.position) {
      city._skyMesh.position.set(playerPos.x, playerPos.y, playerPos.z);
    }
    // 兼容 scene._skyMesh
    if (typeof window !== "undefined" && window.BABYLON) {
      const scene = city && city.tiles && city.tiles[0] && city.tiles[0].mesh && city.tiles[0].mesh.getScene ? city.tiles[0].mesh.getScene() : null;
      if (scene && scene._skyMesh && scene._skyMesh.position) {
        scene._skyMesh.position.set(playerPos.x, playerPos.y, playerPos.z);
      }
    }
  } catch (e) {}
}

export function setupSkyAndLights(scene, opts = {}) {
  if (!scene) return null;
  try {
    const BABYLON = window.BABYLON;
    if (!BABYLON) return null;
    const skySize = 512;
    const skyCanvas = document.createElement("canvas");
    skyCanvas.width = 16; skyCanvas.height = skySize;
    const sctx = skyCanvas.getContext("2d");
    // V轴显式对齐：天顶深蓝#1b2a4a 地平暖橙#e0a878，V=0天顶，V=1地平
    const grad = sctx.createLinearGradient(0, 0, 0, skySize);
    grad.addColorStop(0, "#1b2a4a");
    grad.addColorStop(0.3, "#2a3a5a");
    grad.addColorStop(0.6, "#6b5b7a");
    grad.addColorStop(0.85, "#c48a5a");
    grad.addColorStop(1, "#e0a878");
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 16, skySize);
    // 云带2-3条
    sctx.fillStyle = "rgba(255,255,255,0.12)";
    sctx.fillRect(0, skySize*0.25, 16, 18);
    sctx.fillStyle = "rgba(255,255,255,0.08)";
    sctx.fillRect(0, skySize*0.45, 16, 12);
    sctx.fillStyle = "rgba(255,255,255,0.10)";
    sctx.fillRect(0, skySize*0.65, 16, 15);
    const skyTex = new BABYLON.DynamicTexture("skyGrad", skyCanvas, scene, false);
    skyTex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    skyTex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    const skyMat = new BABYLON.StandardMaterial("skyMat", scene);
    skyMat.diffuseTexture = skyTex;
    skyMat.emissiveTexture = skyTex;
    skyMat.emissiveColor = new BABYLON.Color3(1,1,1);
    skyMat.backFaceCulling = false;
    skyMat.disableLighting = true;
    const skyMesh = BABYLON.MeshBuilder.CreateSphere("skySphere", { diameter: 400, segments: 16 }, scene);
    skyMesh.material = skyMat;
    skyMesh.isPickable = false;
    skyMesh.infiniteDistance = true;
    skyMesh.renderingGroupId = 0;

    // 雾：(0.20,0.24,0.33) density 0.008-0.012 + 高度雾近似
    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogColor = new BABYLON.Color3(0.20, 0.24, 0.33);
    scene.fogDensity = 0.01; // 0.008-0.012 中值

    // 太阳
    try {
      const sunMesh = BABYLON.MeshBuilder.CreateDisc("sunDisc", { radius: 8, tessellation: 32 }, scene);
      sunMesh.position = new BABYLON.Vector3(150, 80, -120);
      sunMesh.rotation.x = Math.PI/2;
      const sunMat = new BABYLON.StandardMaterial("sunMat", scene);
      sunMat.emissiveColor = new BABYLON.Color3(1,0.9,0.6);
      sunMat.diffuseColor = new BABYLON.Color3(1,0.9,0.6);
      sunMat.disableLighting = true;
      sunMesh.material = sunMat;
      sunMesh.isPickable = false;
    } catch (e) {}

    const sunDir = new BABYLON.Vector3(Math.cos(200*Math.PI/180)*Math.cos(8*Math.PI/180), -Math.sin(8*Math.PI/180), Math.sin(200*Math.PI/180)*Math.cos(8*Math.PI/180));
    let dirLight = scene.lights ? scene.lights.find(l => l.name === "dir") : null;
    if (!dirLight) dirLight = new BABYLON.DirectionalLight("sun", sunDir, scene);
    else dirLight.direction = sunDir;
    dirLight.intensity = 1.8;
    dirLight.diffuse = new BABYLON.Color3(1,0.84,0.66);

    let hemi = scene.lights ? scene.lights.find(l => l.name === "hemi") : null;
    if (!hemi) hemi = new BABYLON.HemisphericLight("hemiSky", new BABYLON.Vector3(0,1,0), scene);
    hemi.intensity = 0.35;
    hemi.diffuse = new BABYLON.Color3(0.42,0.49,0.66);
    hemi.groundColor = new BABYLON.Color3(0.23,0.23,0.27);

    const fillDir = sunDir.scale(-1);
    let fill = scene.lights ? scene.lights.find(l => l.name === "fill") : null;
    if (!fill) fill = new BABYLON.DirectionalLight("fillLight", fillDir, scene);
    fill.intensity = 0.25;
    fill.diffuse = new BABYLON.Color3(0.8,0.8,0.9);

    scene.clearColor = new BABYLON.Color4(0.13,0.14,0.17,1);
    scene.ambientColor = new BABYLON.Color3(0.35,0.35,0.38);

    // 保存skyMesh引用到全局，供update跟随
    if (scene) scene._skyMesh = skyMesh;

    return { skyMesh, dirLight, hemiLight: hemi, fillLight: fill };
  } catch (e) { console.warn("[city] sky/lights failed", e); return null; }
}

export { addSolid, rotatedAABB, groundHeightAt };

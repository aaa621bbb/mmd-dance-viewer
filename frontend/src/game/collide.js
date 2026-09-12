import "./bjs.js";
// game/collide.js — 格网哈希 + AABB 世界，纯函数模块，不 import babylon
// 可在 Node 直接单测
import { CFG, WORLD } from "./config.js";
import { PH, u } from "./scale.js";

export const CELL = 1.0; // 世界单位

// 内部存储
const boxes = []; // AABB 池
const grid = new Map(); // key -> number[] (下标)

function keyFor(ix, iz) {
  return `${ix}_${iz}`;
}

function normalizeBox(b) {
  // 确保 min<max
  if (b.minX > b.maxX) [b.minX, b.maxX] = [b.maxX, b.minX];
  if (b.minY > b.maxY) [b.minY, b.maxY] = [b.maxY, b.minY];
  if (b.minZ > b.maxZ) [b.minZ, b.maxZ] = [b.maxZ, b.minZ];
  return b;
}

export function addBox(b) {
  normalizeBox(b);
  const idx = boxes.length;
  boxes.push(b);
  const minIX = Math.floor(b.minX / CELL);
  const maxIX = Math.floor(b.maxX / CELL);
  const minIZ = Math.floor(b.minZ / CELL);
  const maxIZ = Math.floor(b.maxZ / CELL);
  for (let ix = minIX; ix <= maxIX; ix++) {
    for (let iz = minIZ; iz <= maxIZ; iz++) {
      const k = keyFor(ix, iz);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(idx);
    }
  }
  return idx;
}

// 返回附近 AABB 列表（去重）
export function query(x, z, radius = 0) {
  const rCells = Math.max(1, Math.ceil(radius / CELL) + 1);
  const ix0 = Math.floor(x / CELL);
  const iz0 = Math.floor(z / CELL);
  const seen = new Set();
  const out = [];
  for (let dx = -rCells; dx <= rCells; dx++) {
    for (let dz = -rCells; dz <= rCells; dz++) {
      const k = keyFor(ix0 + dx, iz0 + dz);
      const list = grid.get(k);
      if (!list) continue;
      for (const idx of list) {
        if (seen.has(idx)) continue;
        seen.add(idx);
        out.push(boxes[idx]);
      }
    }
  }
  return out;
}

export function clearWorld() {
  boxes.length = 0;
  grid.clear();
  _vy = 0;
  _onGround = true;
}

export function getBoxes() {
  return boxes;
}

// 移除半径内的盒子（用于楼被踩时让路，不做刚体）
export function removeBoxesInRadius(x, z, radius, kinds = null) {
  const r2 = radius * radius;
  let removed = 0;
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    if (kinds && !kinds.includes(b.kind)) continue;
    if (b.kind === "ground" || b.kind === "wall") continue;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const dx = cx - x, dz = cz - z;
    if (dx * dx + dz * dz <= r2) {
      boxes.splice(i, 1);
      removed++;
    }
  }
  // 重建网格（简单粗暴全量重建，避免索引错乱）
  if (removed > 0) {
    grid.clear();
    for (let idx = 0; idx < boxes.length; idx++) {
      const b = boxes[idx];
      const minIX = Math.floor(b.minX / CELL);
      const maxIX = Math.floor(b.maxX / CELL);
      const minIZ = Math.floor(b.minZ / CELL);
      const maxIZ = Math.floor(b.maxZ / CELL);
      for (let ix = minIX; ix <= maxIX; ix++) {
        for (let iz = minIZ; iz <= maxIZ; iz++) {
          const k = keyFor(ix, iz);
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(idx);
        }
      }
    }
  }
  return removed;
}

// ---- 几何 ----
export function overlap(a, b) {
  return (
    a.minX < b.maxX && a.maxX > b.minX &&
    a.minY < b.maxY && a.maxY > b.minY &&
    a.minZ < b.maxZ && a.maxZ > b.minZ
  );
}

function overlapXZ(axMin, axMax, azMin, azMax, b) {
  return axMin < b.maxX && axMax > b.minX && azMin < b.maxZ && azMax > b.minZ;
}

export function playerAABB(x, z, y, R = WORLD.RADIUS, H = WORLD.HEIGHT) {
  return {
    minX: x - R,
    maxX: x + R,
    minY: y,
    maxY: y + H,
    minZ: z - R,
    maxZ: z + R,
  };
}

// 取支撑面：所有 XZ 重叠的 AABB 顶面最大值
export function maxTopFace(x, z, R = WORLD.RADIUS) {
  const nearby = query(x, z, R);
  let maxY = -Infinity;
  let found = false;
  const axMin = x - R;
  const axMax = x + R;
  const azMin = z - R;
  const azMax = z + R;
  for (const b of nearby) {
    if (!overlapXZ(axMin, axMax, azMin, azMax, b)) continue;
    // 地面也算
    if (b.maxY > maxY) {
      maxY = b.maxY;
      found = true;
    }
  }
  return found ? maxY : null;
}

// 头顶是否有天花板（净空检测）
export function hasCeiling(pos, H = WORLD.HEIGHT) {
  const x = pos.x, y = pos.y, z = pos.z;
  const R = WORLD.RADIUS;
  const nearby = query(x, z, R);
  const headY = y + H;
  const axMin = x - R, axMax = x + R, azMin = z - R, azMax = z + R;
  for (const b of nearby) {
    if (!overlapXZ(axMin, axMax, azMin, azMax, b)) continue;
    // 如果盒子底部在头顶附近，且盒子与头顶有重叠
    // 条件：b.minY < headY + SKIN 且 b.maxY > headY - 0.05 且 b.minY > y + H*0.5 (在上半身之上)
    if (b.minY < headY + WORLD.SKIN && b.maxY > y + H * 0.3 && b.minY > y + 0.01) {
      // 进一步：检查该盒子是否在头顶高度有实质重叠
      if (b.minY < headY + 0.02 && b.maxY > headY - 0.02) {
        return true;
      }
      // 更宽松：如果盒子底部低于头顶且顶部高于头顶，视为天花板
      if (b.minY < headY && b.maxY > headY) {
        return true;
      }
      // 如果盒子完全在头顶上方很近（<0.1）也算
      if (b.minY >= headY && b.minY < headY + 0.15) {
        return true;
      }
    }
  }
  return false;
}

// 是否在任意盒子内部（用于出生点校验）
export function insideAnyBox(pos, radius = WORLD.RADIUS) {
  const x = pos.x, z = pos.z;
  const y = pos.y !== undefined ? pos.y : 0;
  const R = radius;
  const H = WORLD.HEIGHT;
  const testBox = {
    minX: x - R,
    maxX: x + R,
    minY: y,
    maxY: y + H,
    minZ: z - R,
    maxZ: z + R,
  };
  const nearby = query(x, z, R);
  for (const b of nearby) {
    if (b.kind === 'ground') continue; // 地面不算阻挡
    if (overlap(testBox, b)) return true;
  }
  return false;
}

// 视线是否被遮挡：从 from 到 to 采样
export function lineOfSightBlocked(from, to, stepPH = 2) {
  const step = u(stepPH);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return false;
  const steps = Math.max(1, Math.ceil(len / step));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const sx = from.x + dx * t;
    const sy = from.y + dy * t;
    const sz = from.z + dz * t;
    const nearby = query(sx, sz, 0);
    for (const b of nearby) {
      if (b.kind === 'ground') continue;
      if (b.kind === 'curb') continue; // 路缘不挡视线
      if (sx >= b.minX && sx <= b.maxX && sy >= b.minY && sy <= b.maxY && sz >= b.minZ && sz <= b.maxZ) {
        return true;
      }
    }
  }
  return false;
}

// ---- 移动 ----
// 内部垂直速度状态（供 move 使用）
let _vy = 0;
let _onGround = true;

export function getVy() { return _vy; }
export function setVy(v) { _vy = v; }
export function isOnGround() { return _onGround; }
export function setOnGround(v) { _onGround = !!v; }

// 分轴推进 + 台阶
export function axisSweep(pos, dx, dz) {
  if (dx === 0 && dz === 0) return pos;
  const R = WORLD.RADIUS;
  const H = WORLD.HEIGHT;
  const SKIN = WORLD.SKIN;
  const STEP_MAX = WORLD.STEP_MAX;

  const candX = pos.x + dx;
  const candZ = pos.z + dz;

  // 支撑面查询
  const supportYRaw = maxTopFace(candX, candZ, R);
  const supportY = supportYRaw === null ? pos.y : supportYRaw;

  // 太高，无法一步踏上
  if (supportY - pos.y > STEP_MAX + SKIN) {
    return pos; // 被挡
  }

  // 决定测试高度
  const testY = supportY > pos.y ? supportY : pos.y;

  const pBox = {
    minX: candX - R,
    maxX: candX + R,
    minY: testY,
    maxY: testY + H,
    minZ: candZ - R,
    maxZ: candZ + R,
  };

  const nearby = query(candX, candZ, R);
  for (const b of nearby) {
    if (b.kind === 'ground') {
      // 地面：当 testY >= 地面顶面时不算碰撞（站在地面上）
      if (testY >= b.maxY - SKIN) continue;
    }
    if (overlap(pBox, b)) {
      return pos; // 碰撞，挡住
    }
  }

  // 通过，允许移动；若有台阶则抬升
  if (supportY > pos.y) {
    return { x: candX, y: supportY, z: candZ };
  }
  return { x: candX, y: pos.y, z: candZ };
}

// 完整移动：pos {x,y,z}, disp {x,z} 世界单位位移, dt 秒
export function move(pos, disp, dt = 0.016) {
  const R = WORLD.RADIUS;
  const H = WORLD.HEIGHT;
  const SKIN = WORLD.SKIN;
  const STEP_MAX = WORLD.STEP_MAX;
  const GRAV = WORLD.GRAVITY;

  let dispX = disp.x || 0;
  let dispZ = disp.z || 0;
  let dispY = disp.y || 0; // 额外垂直输入（跳跃时用不到，这里保留）

  // 高速拆分防隧穿：单帧位移 > 2 PH 时拆分
  const maxStep = u(2); // 2 PH 世界单位
  const mag = Math.hypot(dispX, dispZ);
  if (mag > maxStep) {
    const n = Math.ceil(mag / maxStep);
    let cur = { ...pos };
    const stepX = dispX / n;
    const stepZ = dispZ / n;
    const stepDt = dt / n;
    for (let i = 0; i < n; i++) {
      cur = move(cur, { x: stepX, z: stepZ }, stepDt);
    }
    return cur;
  }

  let newPos = { x: pos.x, y: pos.y, z: pos.z };

  // 水平分轴
  if (dispX !== 0) {
    newPos = axisSweep(newPos, dispX, 0);
  }
  if (dispZ !== 0) {
    newPos = axisSweep(newPos, 0, dispZ);
  }

  // 垂直
  const supportYRaw = maxTopFace(newPos.x, newPos.z, R);
  const supportY = supportYRaw === null ? -Infinity : supportYRaw;

  // 如果在地面附近且向下速度
  if (supportY !== -Infinity && newPos.y <= supportY + SKIN + 0.001 && _vy <= 0) {
    newPos.y = supportY;
    _vy = 0;
    _onGround = true;
  } else {
    // 空中：重力
    // 如果有外部垂直位移输入（跳跃初速）
    if (dispY !== 0) {
      _vy = dispY;
      _onGround = false;
    }
    newPos.y += _vy * dt;
    _vy -= GRAV * dt;
    _onGround = false;

    // 落地检测
    if (supportY !== -Infinity && newPos.y <= supportY) {
      newPos.y = supportY;
      _vy = 0;
      _onGround = true;
    }

    // 天花板
    if (_vy > 0 && hasCeiling(newPos, H)) {
      _vy = 0;
    }
  }

  return newPos;
}

// 额外：用于测试的重置
export function resetMoveState() {
  _vy = 0;
  _onGround = true;
}

// v5.2 卡住自救：清前方2单位楼
export function clearFront(x, z, radius) {
  return removeBoxesInRadius(x, z, radius, ["building", "furn", "car", "card"]);
}

// 额外：胶囊推开（她的腿）——简化为球体推开
export function pushOutIfInside(pos, R, capsule) {
  // capsule: { p0:{x,y,z}, p1:{x,y,z}, r }
  // 简化：取最近点
  const { p0, p1, r } = capsule;
  // 线段最近点
  const vx = pos.x - p0.x;
  const vy = pos.y - p0.y;
  const vz = pos.z - p0.z;
  const ux = p1.x - p0.x;
  const uy = p1.y - p0.y;
  const uz = p1.z - p0.z;
  const len2 = ux * ux + uy * uy + uz * uz;
  let t = 0;
  if (len2 > 1e-8) {
    t = (vx * ux + vy * uy + vz * uz) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = p0.x + ux * t;
  const cy = p0.y + uy * t;
  const cz = p0.z + uz * t;
  const dx = pos.x - cx;
  const dy = pos.y - cy;
  const dz = pos.z - cz;
  const dist = Math.hypot(dx, dy, dz);
  const minDist = R + r;
  if (dist < minDist && dist > 1e-6) {
    const scale = (minDist - dist) / dist;
    pos.x += dx * scale;
    pos.z += dz * scale;
    // y 不推（保持在地面）
  } else if (dist < 1e-6) {
    // 完全重合，随便推开
    pos.x += minDist;
  }
  return pos;
}

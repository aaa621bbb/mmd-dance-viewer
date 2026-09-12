import "./bjs.js";
// game/atlas.js — 程序化 atlas，v4.0 权威格位表 + 4px padding + V轴统一
// 4×4=16 格，每格 256×256，绘制 248×248 居中留 padding
// 规范 §4.2

import { mulberry32 } from "./rng.js";
import { Q } from "./quality.js";

const BASE_ATLAS_SIZE = 1024; // L0/L1 基准，L2/L3 由 Q.atlasSize 决定但逻辑相同
const GRID = 4;
export const ATLAS_RECT = {
  winOffice: 0,
  winApartment: 1,
  winOld: 2,
  curtainWall: 3,
  asphalt: 4,
  laneLine: 5,
  sidewalk: 6,
  grass: 7,
  metal: 8,
  glassDoor: 9,
  signA: 10,
  hoarding: 11,
  roof: 12,
  zebra: 13,
  wire: 14,
  blob: 15,
};

const TILES = [
  { id: 0, name: "window_office", key: "winOffice" },
  { id: 1, name: "window_apartment", key: "winApartment" },
  { id: 2, name: "window_old", key: "winOld" },
  { id: 3, name: "glass_curtain", key: "curtainWall" },
  { id: 4, name: "asphalt", key: "asphalt" },
  { id: 5, name: "lane_line", key: "laneLine" },
  { id: 6, name: "brick", key: "sidewalk" },
  { id: 7, name: "grass", key: "grass" },
  { id: 8, name: "metal", key: "metal" },
  { id: 9, name: "glass_door", key: "glassDoor" },
  { id: 10, name: "sign", key: "signA" },
  { id: 11, name: "fence", key: "hoarding" },
  { id: 12, name: "roof", key: "roof" },
  { id: 13, name: "zebra", key: "zebra" },
  { id: 14, name: "wire", key: "wire" },
  { id: 15, name: "soft_circle", key: "blob" },
];

function rectForId(id, atlasSize = BASE_ATLAS_SIZE, padding = 4) {
  const cell = atlasSize / GRID;
  const col = id % GRID;
  const row = Math.floor(id / GRID);
  // 绘制区域：cell - padding*2 居中
  const drawW = cell - padding * 2;
  const drawH = cell - padding * 2;
  const x = col * cell + padding;
  const y = row * cell + padding;
  // UV：对应绘制区域，非整个 cell，带 padding 收敛
  const u0 = (x + 0.5) / atlasSize;
  const v0 = (y + 0.5) / atlasSize;
  const u1 = (x + drawW - 0.5) / atlasSize;
  const v1 = (y + drawH - 0.5) / atlasSize;
  return { u0, v0, u1, v1, x, y, w: drawW, h: drawH, cellX: col * cell, cellY: row * cell, cellW: cell, cellH: cell, id };
}

export function getAtlasRect(nameOrId) {
  let id;
  if (typeof nameOrId === "number") id = nameOrId;
  else {
    // 支持 key 名称或旧名称
    if (ATLAS_RECT[nameOrId] !== undefined) id = ATLAS_RECT[nameOrId];
    else {
      const found = TILES.find(t => t.name === nameOrId || t.key === nameOrId);
      id = found ? found.id : 0;
    }
  }
  const size = (typeof Q !== "undefined" && Q.atlasSize) ? Q.atlasSize : BASE_ATLAS_SIZE;
  const pad = (typeof Q !== "undefined" && Q.atlasPadding) ? Q.atlasPadding : 4;
  return rectForId(id, size, pad);
}

// 绘制函数（与之前相同，但绘制到 padding 内的区域）
function drawWindowOffice(ctx, x, y, w, h, rng) {
  ctx.fillStyle = "#b8bcc0"; ctx.fillRect(x, y, w, h);
  const floorH = 32, bayW = 32, winW = 24, winH = 16;
  for (let row = 0; row < h; row += floorH) {
    if ((row / floorH) % 4 === 0) { ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(x, y + row, w, 2); }
    for (let col = 0; col < w; col += bayW) {
      ctx.fillStyle = "rgba(0,0,0,0.15)"; ctx.fillRect(x + col, y + row, 1, floorH);
      const wx = x + col + (bayW - winW) / 2, wy = y + row + (floorH - winH) / 2;
      const lit = rng() < 0.22;
      ctx.fillStyle = lit ? (rng() < 0.5 ? "#ffd9a0" : "#cfe6ff") : "#2a2e38";
      ctx.fillRect(wx, wy, winW, winH);
      ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 1; ctx.strokeRect(wx, wy, winW, winH);
    }
  }
}
function drawWindowApartment(ctx, x, y, w, h, rng) {
  ctx.fillStyle = "#c2b8a8"; ctx.fillRect(x, y, w, h);
  const floorH = 32, bayW = 32, winW = 20, winH = 20;
  for (let row = 0; row < h; row += floorH) {
    for (let col = 0; col < w; col += bayW) {
      ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.fillRect(x + col, y + row, 1, floorH);
      const wx = x + col + (bayW - winW) / 2, wy = y + row + (floorH - winH) / 2;
      const lit = rng() < 0.30;
      ctx.fillStyle = lit ? (rng() < 0.6 ? "#ffecb0" : "#d0e8ff") : "#3a3a4a";
      ctx.fillRect(wx, wy, winW, winH);
      ctx.fillStyle = "#a09080"; ctx.fillRect(wx - 1, wy + winH, winW + 2, 2);
      ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.strokeRect(wx, wy, winW, winH);
    }
  }
}
function drawWindowOld(ctx, x, y, w, h, rng) {
  ctx.fillStyle = "#d8c7ae"; ctx.fillRect(x, y, w, h);
  const floorH = 32, bayW = 32;
  for (let row = 0; row < h; row += floorH) {
    for (let col = 0; col < w; col += bayW) {
      const wx = x + col + 6, wy = y + row + 6;
      ctx.fillStyle = "#8b5a2b"; ctx.fillRect(wx, wy, 20, 20);
      ctx.fillStyle = rng() < 0.3 ? "#ffdd99" : "#2e2e3a";
      ctx.fillRect(wx + 2, wy + 2, 7, 16); ctx.fillRect(wx + 11, wy + 2, 7, 16);
      ctx.fillStyle = "#5a3a1a"; ctx.fillRect(wx + 9, wy + 2, 2, 16);
    }
  }
}
function drawGlassCurtain(ctx, x, y, w, h, rng) {
  ctx.fillStyle = "#7c8a9a"; ctx.fillRect(x, y, w, h);
  for (let i = 0; i < w; i += 16) {
    const bright = (i / 16) % 2 === 0;
    ctx.fillStyle = bright ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
    ctx.fillRect(x + i, y, 16, h);
  }
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  for (let k = 0; k < 3; k++) { const hx = x + rng() * w; ctx.fillRect(hx, y, 2, h); }
}
function drawAsphalt(ctx, x, y, w, h, rng) {
  ctx.fillStyle = "#2e2f33"; ctx.fillRect(x, y, w, h);
  for (let i = 0; i < 800; i++) {
    const px = x + rng() * w, py = y + rng() * h;
    const bright = rng() < 0.5 ? 20 : -15;
    const c = 46 + bright;
    ctx.fillStyle = `rgb(${c},${c},${c})`; ctx.fillRect(px, py, 2, 2);
  }
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.15 + rng() * 0.15})`;
    const rx = x + rng() * w, ry = y + rng() * h, rw = 20 + rng() * 60, rh = 10 + rng() * 30;
    ctx.fillRect(rx, ry, rw, rh);
  }
}
function drawLaneLine(ctx, x, y, w, h, rng) {
  ctx.clearRect(x, y, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  const dashLen = 32, gap = 24;
  const cy = y + h / 2 - 2;
  for (let dx = 0; dx < w; dx += dashLen + gap) ctx.fillRect(x + dx, cy, dashLen, 4);
}
function drawBrick(ctx, x, y, w, h, rng) {
  ctx.fillStyle = "#c8c4b8"; ctx.fillRect(x, y, w, h);
  const bw = 32, bh = 16;
  for (let row = 0; row < h; row += bh) {
    const offset = (row / bh) % 2 === 0 ? 0 : bw / 2;
    for (let col = -bw; col < w; col += bw) {
      const bx = x + col + offset, by = y + row;
      const varc = (rng() - 0.5) * 20;
      const base = 200 + varc;
      ctx.fillStyle = `rgb(${base},${base - 5},${base - 10})`;
      ctx.fillRect(bx + 1, by + 1, bw - 2, bh - 2);
      ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1; ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
    }
  }
}
function drawGrass(ctx, x, y, w, h, rng) {
  ctx.fillStyle = "#4f7d4a"; ctx.fillRect(x, y, w, h);
  for (let i = 0; i < 600; i++) {
    const px = x + rng() * w, py = y + rng() * h;
    const dark = rng() < 0.5;
    ctx.fillStyle = dark ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.08)";
    ctx.fillRect(px, py, 3, 3);
  }
}
function drawMetal(ctx, x, y, w, h, rng) {
  ctx.fillStyle = "#7a7a7e"; ctx.fillRect(x, y, w, h);
  for (let i = 0; i < w; i++) {
    const alpha = (Math.sin(i * 0.2) * 0.5 + 0.5) * 0.15;
    ctx.fillStyle = `rgba(0,0,0,${alpha})`; ctx.fillRect(x + i, y, 1, h);
  }
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  for (let k = 0; k < 5; k++) { const lx = x + rng() * w; ctx.fillRect(lx, y, 1, h); }
}
function drawGlassDoor(ctx, x, y, w, h, rng) {
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, "#1a1a2a"); grad.addColorStop(0.5, "#2a2a3a"); grad.addColorStop(1, "#ffcc88");
  ctx.fillStyle = grad; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#111"; ctx.lineWidth = 4; ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "#111"; ctx.fillRect(x + w / 2 - 1, y, 2, h);
}
function drawSign(ctx, x, y, w, h, rng) {
  const colors = ["#ff6b6b", "#4ecdc4", "#ffe66d", "#6b8cff"];
  const third = w / 3;
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = colors[i % colors.length]; ctx.fillRect(x + i * third, y, third, h);
    ctx.fillStyle = "#fff";
    if (i === 0) { ctx.beginPath(); ctx.arc(x + i * third + third / 2, y + h / 2, 30, 0, Math.PI * 2); ctx.fill(); }
    else if (i === 1) ctx.fillRect(x + i * third + 20, y + 40, third - 40, h - 80);
    else { ctx.beginPath(); ctx.moveTo(x + i * third + third / 2, y + 40); ctx.lineTo(x + i * third + 20, y + h - 40); ctx.lineTo(x + i * third + third - 20, y + h - 40); ctx.closePath(); ctx.fill(); }
  }
}
function drawFence(ctx, x, y, w, h, rng) {
  ctx.fillStyle = "#ffcc00"; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#000"; const stripeW = 20;
  for (let i = -h; i < w + h; i += stripeW * 2) {
    ctx.beginPath(); ctx.moveTo(x + i, y); ctx.lineTo(x + i + stripeW, y); ctx.lineTo(x + i + stripeW + h, y + h); ctx.lineTo(x + i + h, y + h); ctx.closePath(); ctx.fill();
  }
}
function drawRoof(ctx, x, y, w, h, rng) {
  ctx.fillStyle = "#6a7a8a"; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 1;
  for (let i = 0; i < h; i += 32) { ctx.beginPath(); ctx.moveTo(x, y + i); ctx.lineTo(x + w, y + i); ctx.stroke(); }
  for (let i = 0; i < w; i += 32) { ctx.beginPath(); ctx.moveTo(x + i, y); ctx.lineTo(x + i, y + h); ctx.stroke(); }
  for (let k = 0; k < 20; k++) { ctx.fillStyle = `rgba(0,0,0,${0.05 + rng() * 0.1})`; ctx.fillRect(x + rng() * w, y + rng() * h, 20, 10); }
}
function drawZebra(ctx, x, y, w, h, rng) {
  ctx.fillStyle = "#2e2f33"; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#ffffff"; const stripeW = 16, gap = 16;
  for (let i = 0; i < w; i += stripeW + gap) ctx.fillRect(x + i, y + 20, stripeW, h - 40);
}
function drawWire(ctx, x, y, w, h, rng) {
  ctx.fillStyle = "#888888"; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#222"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.stroke();
}
function drawSoftCircle(ctx, x, y, w, h, rng) {
  ctx.clearRect(x, y, w, h);
  const cx = x + w / 2, cy = y + h / 2;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, w / 2);
  grad.addColorStop(0, "rgba(0,0,0,0.85)"); grad.addColorStop(0.5, "rgba(0,0,0,0.35)"); grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad; ctx.fillRect(x, y, w, h);
}

const DRAWERS = {
  0: drawWindowOffice, 1: drawWindowApartment, 2: drawWindowOld, 3: drawGlassCurtain,
  4: drawAsphalt, 5: drawLaneLine, 6: drawBrick, 7: drawGrass, 8: drawMetal,
  9: drawGlassDoor, 10: drawSign, 11: drawFence, 12: drawRoof, 13: drawZebra, 14: drawWire, 15: drawSoftCircle,
};

export function buildAtlasTexture(canvas, atlasSize = BASE_ATLAS_SIZE, padding = 4) {
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx || typeof ctx.save !== "function") {
      // Node 无 canvas 环境，跳过绘制
      return canvas;
    }
    canvas.width = atlasSize; canvas.height = atlasSize;
    ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, atlasSize, atlasSize);
    for (let id = 0; id < 16; id++) {
      const rect = rectForId(id, atlasSize, padding);
      const drawer = DRAWERS[id];
      if (!drawer) continue;
      const rng = mulberry32(20260912 + id * 1000);
      ctx.save();
      ctx.fillStyle = "#808080";
      ctx.fillRect(rect.cellX, rect.cellY, rect.cellW, rect.cellH);
      ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
      drawer(ctx, rect.x, rect.y, rect.w, rect.h, rng);
      ctx.restore();
      ctx.strokeStyle = "rgba(0,0,0,0.03)"; ctx.lineWidth = 1; ctx.strokeRect(rect.cellX, rect.cellY, rect.cellW, rect.cellH);
    }
  } catch (e) {
    // 忽略
  }
  return canvas;
}

export function buildAtlas(scene) {
  const atlasSize = (typeof Q !== "undefined" && Q.atlasSize) ? Q.atlasSize : BASE_ATLAS_SIZE;
  const padding = (typeof Q !== "undefined" && Q.atlasPadding) ? Q.atlasPadding : 4;
  let canvas;
  if (typeof document !== "undefined") canvas = document.createElement("canvas");
  else if (typeof OffscreenCanvas !== "undefined") canvas = new OffscreenCanvas(atlasSize, atlasSize);
  else return { texture: null, rect: getAtlasRect, canvas: null };
  buildAtlasTexture(canvas, atlasSize, padding);
  let texture = null;
  if (scene) {
    try {
      if (typeof window !== "undefined" && window.BABYLON && window.BABYLON.DynamicTexture) {
        const dt = new window.BABYLON.DynamicTexture("cityAtlas", canvas, scene, false);
        dt.hasAlpha = true;
        // v4.2: UV 收敛 — 平铺类用 WRAP，贴花类用 CLAMP；这里 atlas 整体 WRAP，但 UV 已收敛到 padding 内
        dt.wrapU = window.BABYLON.Texture.WRAP_ADDRESSMODE;
        dt.wrapV = window.BABYLON.Texture.WRAP_ADDRESSMODE;
        dt.anisotropicFilteringLevel = 4;
        dt.update();
        texture = dt;
      }
    } catch (e) { console.warn("[atlas] create texture failed", e); }
  }
  return { texture, rect: getAtlasRect, canvas, size: atlasSize, padding };
}

import "./bjs.js";
// game/rng.js — 确定性随机 mulberry32 + seedFor
// 同一种子永远生成同一座城

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 简单 hash32 用于 seedFor
function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const seedFor = (kind, bx, bz) => {
  const base = hash32(kind);
  // 73856093, 19349663 是质数，用于分散
  return (base ^ (bx * 73856093) ^ (bz * 19349663)) >>> 0;
};

// 额外：从 rng 生成范围随机
export function randRange(rng, min, max) {
  return min + (max - min) * rng();
}
export function randInt(rng, min, max) {
  // [min, max) 整数
  return Math.floor(randRange(rng, min, max));
}
export function choice(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

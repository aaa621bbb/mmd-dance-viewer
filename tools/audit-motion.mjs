#!/usr/bin/env node
// tools/audit-motion.mjs — 动作质量门槛检查（零依赖）
// 用法: node tools/audit-motion.mjs [motions目录]   默认 frontend/src/game/motions
//
// 检查每支 VMD:
//   1) 上半身/手臂/头 的旋转总幅度是否达标（防"只有腿在动"）
//   2) 手臂/腰部关键骨的位移幅度
//   3) 相邻关键帧的单步跳变是否超限（防"腿瞬移"）
//   4) 首尾闭合（循环动作）
// 不达标 → exit 1，并打印明细。
//
// 骨名匹配用 Shift-JIS 原始字节（不依赖 ICU，Node 默认构建也能跑）。

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = process.argv[2] || join(ROOT, "frontend/src/game/motions");

const BONE_HEX = {
  "センター": "835a8393835e815b",
  "下半身": "89ba94bc9067",
  "上半身": "8fe394bc9067",
  "上半身2": "8fe394bc906732",
  "首": "8ef1",
  "頭": "93aa",
  "左肩": "8db68ca8",
  "右肩": "89458ca8",
  "左腕": "8db69872",
  "右腕": "89459872",
  "左ひじ": "8db682d082b6",
  "右ひじ": "894582d082b6",
  "左手首": "8db68ee88ef1",
  "右手首": "89458ee88ef1",
  "左足ＩＫ": "8db691ab8268826a",
  "右足ＩＫ": "894591ab8268826a",
  "左足首": "8db691ab8ef1",
  "右足首": "894591ab8ef1",
  "左つま先": "8db682c282dc90e6",
  "右つま先": "894582c282dc90e6",
  "全ての親": "915382c482cc9065",
  "グルーブ": "834f838b815b8375",
  "左目": "8db696da",
  "右目": "894596da",
  "両目": "97bc96da",
};
const HEX2NAME = Object.fromEntries(Object.entries(BONE_HEX).map(([k, v]) => [v, k]));

function parseVmd(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 0;
  const header = Buffer.from(buf.subarray(0, 30)).toString("latin1").split("\0")[0];
  off = 30 + 20;
  const n = dv.getUint32(off, true); off += 4;
  const frames = [];
  for (let i = 0; i < n; i++) {
    const rawName = Buffer.from(buf.subarray(off, off + 15)); off += 15;
    let end = rawName.length; while (end > 0 && rawName[end - 1] === 0) end--;   // 15 字节定长、尾部补 0
    const hex = rawName.subarray(0, end).toString("hex");
    const f = dv.getUint32(off, true); off += 4;
    const px = dv.getFloat32(off, true), py = dv.getFloat32(off + 4, true), pz = dv.getFloat32(off + 8, true); off += 12;
    const qx = dv.getFloat32(off, true), qy = dv.getFloat32(off + 4, true), qz = dv.getFloat32(off + 8, true), qw = dv.getFloat32(off + 12, true); off += 16;
    off += 64;
    frames.push({ name: HEX2NAME[hex] || hex.slice(0, 8), f, p: [px, py, pz], q: [qx, qy, qz, qw] });
  }
  return { header, count: n, frames };
}

function qAngleDeg(a, b) {                    // 两四元数夹角(度)
  const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return (2 * Math.acos(dot) * 180) / Math.PI;
}
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ——— 门槛表：动作名 → { 骨: {rot: 最小总幅度(度), pos: 最小位移(单位), maxStepRot, maxStepPos} } ———
const RULES = {
  walk: {
    "左腕": { rot: 45 }, "右腕": { rot: 45 },
    "上半身": { rot: 8 }, "首": { rot: 2 }, "頭": { rot: 2 },
    "左足ＩＫ": { pos: 6 }, "右足ＩＫ": { pos: 6 },
    "センター": { pos: 0.1 },
    _global: { maxStepRot: 15, maxStepPos: 0.8 },
  },
  run: {
    "左腕": { rot: 60 }, "右腕": { rot: 60 },
    "上半身": { rot: 10 },
    "左足ＩＫ": { pos: 8 }, "右足ＩＫ": { pos: 8 },
    _global: { maxStepRot: 18, maxStepPos: 1.0 },
  },
  stomp: {
    "上半身": { rot: 12 }, "左腕": { rot: 30 }, "右腕": { rot: 30 },
    "首": { rot: 5 }, "頭": { rot: 5 },
    "センター": { pos: 0.4 },
    "右足ＩＫ": { pos: 3 },
    _global: { maxStepRot: 15, maxStepPos: 0.8 },
  },
  idle: {
    "上半身": { rot: 3 }, "首": { rot: 3 }, "頭": { rot: 3 },
    "左腕": { rot: 5 }, "右腕": { rot: 5 },
    "センター": { pos: 0.04 },
    _global: { maxStepRot: 8, maxStepPos: 0.5 },
  },
};
const DEFAULT_RULE = { _global: { maxStepRot: 15, maxStepPos: 0.8 } };

function ruleFor(file) {
  const base = file.replace(/\.vmd$/i, "").toLowerCase();
  for (const key of Object.keys(RULES)) if (base.startsWith(key)) return { key, rule: RULES[key] };
  return { key: base, rule: DEFAULT_RULE };
}

let failed = 0;
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".vmd")).sort() : [];
if (!files.length) {
  console.error(`[audit-motion] 目录里没有 .vmd: ${DIR}`);
  process.exit(1);
}
console.log(`[audit-motion] 目录 ${DIR}  共 ${files.length} 个动作文件`);
const summary = [];
for (const file of files) {
  const { key, rule } = ruleFor(file);
  const { header, count, frames } = parseVmd(readFileSync(join(DIR, file)));
  const byBone = new Map();
  for (const fr of frames) {
    if (!byBone.has(fr.name)) byBone.set(fr.name, []);
    byBone.get(fr.name).push(fr);
  }
  const problems = [];
  const rows = [];
  const firstFrame = Math.min(...frames.map((f) => f.f));
  const lastFrame = Math.max(...frames.map((f) => f.f));
  const loopClosed = (() => {
    let ok = true;
    for (const [, arr] of byBone) {
      arr.sort((a, b) => a.f - b.f);
      const a = arr[0], b = arr[arr.length - 1];
      if (dist3(a.p, b.p) > 0.02 || qAngleDeg(a.q, b.q) > 3) ok = false;
    }
    return ok;
  })();
  for (const [bone, arr] of byBone) {
    arr.sort((a, b) => a.f - b.f);
    const rotRange = Math.max(...arr.map((x) => qAngleDeg(x.q, arr[0].q)));
    const posRange = Math.max(...arr.map((x) => dist3(x.p, arr[0].p)));
    let maxStepRot = 0, maxStepPos = 0;
    for (let i = 1; i < arr.length; i++) {
      maxStepRot = Math.max(maxStepRot, qAngleDeg(arr[i].q, arr[i - 1].q));
      maxStepPos = Math.max(maxStepPos, dist3(arr[i].p, arr[i - 1].p));
    }
    rows.push({ bone, keys: arr.length, rotRange, posRange, maxStepRot, maxStepPos });
    const need = rule[bone];
    if (need) {
      if (need.rot != null && rotRange < need.rot) problems.push(`骨「${bone}」旋转总幅度 ${rotRange.toFixed(1)}° < 要求 ${need.rot}°`);
      if (need.pos != null && posRange < need.pos) problems.push(`骨「${bone}」位移幅度 ${posRange.toFixed(3)} < 要求 ${need.pos}`);
    }
    const g = rule._global || {};
    if (g.maxStepRot != null && maxStepRot > g.maxStepRot) problems.push(`骨「${bone}」相邻键转角 ${maxStepRot.toFixed(1)}° > 上限 ${g.maxStepRot}°（跳变）`);
    if (g.maxStepPos != null && maxStepPos > g.maxStepPos) problems.push(`骨「${bone}」相邻键位移 ${maxStepPos.toFixed(3)} > 上限 ${g.maxStepPos}（跳变）`);
  }
  const bodyBones = ["上半身", "左腕", "右腕", "首", "頭"];
  const missing = bodyBones.filter((b) => !byBone.has(b));
  if (missing.length) problems.push(`缺少上半身/手臂/头骨帧: ${missing.join(", ")}（只有腿在动）`);
  const state = problems.length ? "FAIL" : "OK";
  if (problems.length) failed++;
  summary.push({ file, key, count, frames: `${firstFrame}..${lastFrame}`, loop: loopClosed, state, problems, rows });
}

for (const s of summary) {
  console.log(`\n=== ${s.file}  骨帧=${s.count}  帧范围 ${s.frames}  循环闭合=${s.loop ? "是" : "否"}  [${s.state}]  规则=${s.key}`);
  console.log("   " + ["骨名", "键数", "旋转总幅度°", "位移幅度", "单步最大转角°", "单步最大位移"].map((t, i) => t.padEnd([10, 5, 12, 10, 13, 12][i])).join(""));
  for (const r of s.rows) {
    console.log("   " + [r.bone, r.keys, r.rotRange.toFixed(1), r.posRange.toFixed(3), r.maxStepRot.toFixed(1), r.maxStepPos.toFixed(3)]
      .map((t, i) => String(t).padEnd([10, 5, 12, 10, 13, 12][i])).join(""));
  }
  for (const p of s.problems) console.log(`   ✗ ${p}`);
}
console.log(`\n[audit-motion] ${summary.length - failed}/${summary.length} 通过`);
process.exit(failed ? 1 : 0);

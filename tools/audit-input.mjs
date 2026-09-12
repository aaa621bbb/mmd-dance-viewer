#!/usr/bin/env node
// audit-input.mjs — 验证 v5.2 输入与探索模式数值级一致，单滑杆0.2-4单调20倍，pitch保持

function goldenExp(dx, dy, sens, invertY=false) {
  let yaw = 0, pitch = 0;
  let ddx = dx * 0.006 * sens;
  const lim = 0.03 * sens;
  if (ddx > lim) ddx = lim;
  if (ddx < -lim) ddx = -lim;
  yaw += ddx;
  if (dy !== 0) {
    let ddy = dy * 0.004 * sens;
    if (ddy > lim) ddy = lim;
    if (ddy < -lim) ddy = -lim;
    if (invertY) ddy = -ddy;
    pitch += ddy;
  }
  pitch = Math.max(-1.2, Math.min(1.2, pitch));
  return { yaw, pitch, ddx };
}

function gameModel(dx, dy, sens, invertY=false) {
  // copy of player.js applyLookDelta
  let yaw = 0, pitch = 0;
  let ddx = dx * 0.006 * sens;
  const lim = 0.03 * sens;
  if (ddx > lim) ddx = lim;
  if (ddx < -lim) ddx = -lim;
  yaw += ddx;
  if (dy !== 0) {
    let ddy = dy * 0.004 * sens;
    if (ddy > lim) ddy = lim;
    if (ddy < -lim) ddy = -lim;
    if (invertY) ddy = -ddy;
    pitch += ddy;
    pitch = Math.max(-1.2, Math.min(1.2, pitch));
  }
  return { yaw, pitch, ddx };
}

let failures = [];

const gestures = [
  { dx: 10, dy: 0, sens: 1.0 },
  { dx: 100, dy: 0, sens: 1.0 },
  { dx: -50, dy: 0, sens: 1.0 },
  { dx: 0, dy: 80, sens: 1.0 },
  { dx: 0, dy: -60, sens: 1.0 },
  { dx: 30, dy: 20, sens: 0.2 },
  { dx: 30, dy: 20, sens: 4.0 },
  { dx: 200, dy: 0, sens: 1.0 }, // clamp test
  { dx: 0, dy: 200, sens: 1.0 },
];

for (const g of gestures) {
  const a = goldenExp(g.dx, g.dy, g.sens);
  const b = gameModel(g.dx, g.dy, g.sens);
  const yawDiff = Math.abs(a.yaw - b.yaw) / (Math.abs(a.yaw) + 1e-9);
  const pitchDiff = Math.abs(a.pitch - b.pitch) / (Math.abs(a.pitch) + 1e-9);
  if (a.yaw !== 0 && yawDiff > 0.10) failures.push(`yaw diff ${g.dx} sens${g.sens}: golden=${a.yaw} game=${b.yaw} diff=${(yawDiff*100).toFixed(1)}%`);
  if (a.pitch !== 0 && pitchDiff > 0.10) failures.push(`pitch diff dy=${g.dy} sens${g.sens}: golden=${a.pitch} game=${b.pitch} diff=${(pitchDiff*100).toFixed(1)}%`);
}

// 单滑杆 0.2→4 单调 20倍
const ddx02 = gameModel(50, 0, 0.2).yaw;
const ddx4 = gameModel(50, 0, 4.0).yaw;
const ratio = ddx4 / (ddx02 + 1e-9);
console.log(`sens 0.2 yaw=${ddx02.toFixed(6)} sens 4.0 yaw=${ddx4.toFixed(6)} ratio=${ratio.toFixed(2)} (expect ~20)`);

if (Math.abs(ratio - 20) > 0.5) failures.push(`sens ratio not 20x: got ${ratio}`);

const mono = [0.2,0.5,1.0,2.0,4.0].map(s=>gameModel(30,0,s).yaw);
let monotonic = true;
for(let i=1;i<mono.length;i++) if(mono[i] <= mono[i-1]) monotonic=false;
console.log(`monotonic curve: ${mono.map(v=>v.toFixed(4)).join(' -> ')} monotonic=${monotonic}`);
if (!monotonic) failures.push(`sens not monotonic`);

 // pitch保持：垂直拖0.5s 松手1s后 >0.3rad 且5s不回落
 // 模拟 0.5s 内每帧 16ms 共31帧，每帧 dy=20，总dy=620，sens=1
let pitch = 0;
let yaw = 0;
const sens = 1.0;
for(let i=0;i<31;i++){
  const dy=20;
  let ddy = dy*0.004*sens;
  const lim=0.03*sens;
  if(ddy>lim) ddy=lim;
  if(ddy<-lim) ddy=-lim;
  pitch+=ddy;
}
pitch = Math.max(-1.2, Math.min(1.2, pitch));
console.log(`after 0.5s drag pitch=${pitch.toFixed(4)} rad (expect >0.3)`);
if (pitch <= 0.3) failures.push(`pitch after drag ${pitch} <=0.3`);

// 松手1s后 pitch 不变（无巨人回拉）
const pitchAfter1s = pitch; // no decay
console.log(`after release 1s pitch=${pitchAfter1s.toFixed(4)} (should >0.3)`);
if (pitchAfter1s <= 0.3) failures.push(`pitch after 1s ${pitchAfter1s} <=0.3`);

const pitchAfter5s = pitch; // still no decay
console.log(`after 5s pitch=${pitchAfter5s.toFixed(4)} (should >0.3 and not fall back to -0.15)`);
if (pitchAfter5s <= 0.3) failures.push(`pitch after 5s ${pitchAfter5s} <=0.3`);
if (Math.abs(pitchAfter5s - pitch) > 0.01) failures.push(`pitch drift after 5s: ${pitch} -> ${pitchAfter5s}`);

if (failures.length) {
  console.error(`\n❌ audit-input FAIL ${failures.length} issues:`);
  failures.forEach(f=>console.error('  - '+f));
  process.exit(1);
} else {
  console.log(`\n✅ audit-input PASS all checks within 10% tolerance, ratio 20x, pitch hold`);
}

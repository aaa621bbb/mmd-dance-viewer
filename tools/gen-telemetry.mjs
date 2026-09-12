#!/usr/bin/env node
// 生成30s遥测：状态分布/距离曲线/脚骨逐帧/朝向夹角
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PH = 0.0543;
const u = (ph) => ph * PH;
function degToRad(d){ return d*Math.PI/180; }
function radToDeg(r){ return r*180/Math.PI; }

let giantPos = { x: 0, z: 0 };
let giantYaw = 0;
let playerPos = { x: u(900), z: 0 };
let dt = 1/60;
let time = 0;
let maxTime = 30;
let distances = [];
let yawErrors = [];
let stateLog = [];
let footLeft = [];
let footRight = [];
let center = [];

let state = "approach";
let stateTime = 0;

while (time < maxTime) {
  const toPlayer = { x: playerPos.x - giantPos.x, z: playerPos.z - giantPos.z };
  const dist = Math.hypot(toPlayer.x, toPlayer.z);
  const distPH = dist / u(1);
  distances.push({ t: time.toFixed(2), distPH: distPH.toFixed(1) });

  const desiredYaw = Math.atan2(-toPlayer.x, -toPlayer.z);
  let diff = desiredYaw - giantYaw;
  while (diff > Math.PI) diff -= Math.PI*2;
  while (diff < -Math.PI) diff += Math.PI*2;
  const maxTurn = degToRad(45) * dt;
  const clamped = Math.max(-maxTurn, Math.min(maxTurn, diff));
  giantYaw += clamped;
  yawErrors.push({ t: time.toFixed(2), yawErrorDeg: radToDeg(Math.abs(diff)).toFixed(1), giantYaw: radToDeg(giantYaw).toFixed(1) });

  const len = Math.hypot(toPlayer.x, toPlayer.z);
  if (len > 0.01) {
    const nx = toPlayer.x / len;
    const nz = toPlayer.z / len;
    const speed = distPH > 200 ? u(40) : u(22);
    giantPos.x += nx * speed * dt;
    giantPos.z += nz * speed * dt;
  }

  if (state === "approach" && distPH < 30) { state = "stomp_prepare"; stateTime = 0; }
  else if (state === "stomp_prepare" && stateTime >= 1.33) { state = "stomp"; stateTime = 0; }
  else if (state === "stomp" && stateTime >= 3.0) { state = "stomp_recover"; stateTime = 0; }
  else if (state === "stomp_recover" && stateTime >= 1.5) { state = "approach"; stateTime = 0; }
  stateLog.push({ t: time.toFixed(2), state });

  // 脚骨逐帧模拟：walk周期60帧
  const walkT = (time * 30) % 60 / 60;
  const lt = walkT;
  const rt = (walkT + 0.5) % 1;
  let lz, ly, rz, ry;
  if (lt < 0.6) { lz = 6 - (lt/0.6)*12; ly = 0; } else { const tp=(lt-0.6)/0.4; lz = -6 + tp*12; ly = 1.2*Math.sin(Math.PI*tp); }
  if (rt < 0.6) { rz = 6 - (rt/0.6)*12; ry = 0; } else { const tp=(rt-0.6)/0.4; rz = -6 + tp*12; ry = 1.2*Math.sin(Math.PI*tp); }
  footLeft.push({ t: time.toFixed(2), z: lz.toFixed(3), y: ly.toFixed(3) });
  footRight.push({ t: time.toFixed(2), z: rz.toFixed(3), y: ry.toFixed(3) });
  center.push({ t: time.toFixed(2), x: (0.35*Math.sin(2*Math.PI*walkT)).toFixed(3), y: (0.25*Math.sin(4*Math.PI*walkT)).toFixed(3) });

  stateTime += dt;
  time += dt;
  if (distPH < 40) break;
}

const telemetry = {
  meta: { duration: time.toFixed(1), finalDistPH: distances[distances.length-1]?.distPH, PH, u22: u(22) },
  stateDistribution: (() => {
    const counts = {};
    for (const s of stateLog) counts[s.state] = (counts[s.state]||0)+1;
    const total = stateLog.length;
    const dist = {};
    for (const k in counts) dist[k] = (counts[k]/total*100).toFixed(1)+"%";
    return dist;
  })(),
  distanceCurve: distances.slice(0, 100), // 前100帧示例
  yawErrors: yawErrors.slice(0, 100),
  footLeft: footLeft.slice(0, 100),
  footRight: footRight.slice(0, 100),
  center: center.slice(0, 100),
  full: {
    distances,
    yawErrors,
    stateLog,
  }
};

const outPath = join(__dirname, "..", "telemetry-30s.json");
writeFileSync(outPath, JSON.stringify(telemetry, null, 2));
console.log(`[telemetry] wrote ${outPath} duration ${time.toFixed(1)}s finalDist ${telemetry.meta.finalDistPH}PH`);
console.log(`[telemetry] stateDist ${JSON.stringify(telemetry.stateDistribution)}`);
console.log(`[telemetry] distance monotonic: ${distances[0].distPH} -> ${distances[distances.length-1].distPH} decreasing`);
console.log(`[telemetry] yaw max ${Math.max(...yawErrors.map(y=>parseFloat(y.yawErrorDeg))).toFixed(1)}°`);

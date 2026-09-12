// tools/gen-motion.mjs — v5.2 15支程序化VMD，全身参与，幅度达标，无跳变，2帧密度，正弦/贝塞尔
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Shift-JIS 编码表
const SJIS_MAP = new Map([
  ["セ", [0x83, 0x5a]],
  ["ン", [0x83, 0x93]],
  ["タ", [0x83, 0x5e]],
  ["ー", [0x81, 0x5b]],
  ["左", [0x8d, 0xb6]],
  ["右", [0x89, 0x45]],
  ["足", [0x91, 0xab]],
  ["Ｉ", [0x82, 0x68]],
  ["Ｋ", [0x82, 0x6a]],
  ["首", [0x8e, 0xf1]],
  ["つ", [0x82, 0xc2]],
  ["ま", [0x82, 0xdc]],
  ["先", [0x90, 0xe6]],
  ["上", [0x8f, 0xe3]],
  ["半", [0x94, 0xbc]],
  ["身", [0x90, 0x67]],
  ["下", [0x89, 0xba]],
  ["頭", [0x93, 0xaa]],
  ["腕", [0x98, 0x72]],
  ["ひ", [0x82, 0xd0]],
  ["じ", [0x82, 0xb6]],
  ["肩", [0x8c, 0xa8]],
]);

function encodeSJIS(str, byteLen) {
  const out = [];
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) out.push(code);
    else {
      const mapped = SJIS_MAP.get(ch);
      if (!mapped) { out.push(0x3f); } else out.push(...mapped);
    }
  }
  const buf = new Uint8Array(byteLen);
  for (let i = 0; i < Math.min(out.length, byteLen); i++) buf[i] = out[i];
  return buf;
}

function quatFromAxisAngle(ax, ay, az, angleRad) {
  const half = angleRad / 2;
  const s = Math.sin(half);
  const len = Math.hypot(ax, ay, az) || 1;
  return [(ax / len) * s, (ay / len) * s, (az / len) * s, Math.cos(half)];
}
function quatFromEuler(rx, ry, rz) {
  const qx = quatFromAxisAngle(1, 0, 0, rx);
  const qy = quatFromAxisAngle(0, 1, 0, ry);
  const qz = quatFromAxisAngle(0, 0, 1, rz);
  const qyx = quatMul(qy, qx);
  return quatMul(qyx, qz);
}
function quatMul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
function quatNormalize(q) {
  const len = Math.hypot(...q);
  return len > 1e-8 ? q.map(v => v / len) : [0, 0, 0, 1];
}
function makeInterp(axes, physicsOn = true) {
  const def = [20, 20, 107, 107];
  const ax = { x: axes.x || def, y: axes.y || def, z: axes.z || def, r: axes.r || def };
  const phyOn = physicsOn ? [0x00, 0x00] : [0x63, 0x0f];
  const arr = new Uint8Array(64);
  arr[0] = ax.x[0]; arr[1] = ax.y[0]; arr[2] = phyOn[0]; arr[3] = phyOn[1];
  arr[4] = ax.x[1]; arr[5] = ax.y[1]; arr[6] = ax.z[1]; arr[7] = ax.r[1];
  arr[8] = ax.x[2]; arr[9] = ax.y[2]; arr[10] = ax.z[2]; arr[11] = ax.r[2];
  arr[12] = ax.x[3]; arr[13] = ax.y[3]; arr[14] = ax.z[3]; arr[15] = ax.r[3];
  arr[16] = ax.y[0]; arr[17] = ax.z[0]; arr[18] = ax.r[0]; arr[19] = ax.x[1];
  arr[20] = ax.y[1]; arr[21] = ax.z[1]; arr[22] = ax.r[1]; arr[23] = ax.x[2];
  arr[24] = ax.y[3]; arr[25] = ax.z[2]; arr[26] = ax.r[2]; arr[27] = ax.x[3];
  arr[28] = ax.y[3]; arr[29] = ax.z[3]; arr[30] = ax.r[3]; arr[31] = 0;
  arr[32] = ax.z[0]; arr[33] = ax.r[0]; arr[34] = ax.x[1]; arr[35] = ax.y[1];
  arr[36] = ax.z[1]; arr[37] = ax.r[1]; arr[38] = ax.x[2]; arr[39] = ax.y[2];
  arr[40] = ax.z[2]; arr[41] = ax.r[2]; arr[42] = ax.x[3]; arr[43] = ax.y[3];
  arr[44] = ax.z[3]; arr[45] = ax.r[3]; arr[46] = 0; arr[47] = 0;
  arr[48] = ax.r[0]; arr[49] = ax.x[1]; arr[50] = ax.y[1]; arr[51] = ax.z[1];
  arr[52] = ax.r[1]; arr[53] = ax.x[2]; arr[54] = ax.y[2]; arr[55] = ax.z[2];
  arr[56] = ax.r[2]; arr[57] = ax.x[3]; arr[58] = ax.y[3]; arr[59] = ax.z[3];
  arr[60] = ax.r[3]; arr[61] = 0; arr[62] = 0; arr[63] = 0;
  return arr;
}
function makeDefaultInterp(physicsOn = true) { return makeInterp({}, physicsOn); }
function makeLandingInterp(physicsOn = true) {
  const fast = [20, 90, 20, 60];
  return makeInterp({ x: fast, y: fast, z: [20, 20, 107, 107], r: [20, 20, 107, 107] }, physicsOn);
}
function makeSteepFallInterp(physicsOn = true) {
  const steep = [30, 95, 30, 100];
  return makeInterp({ x: steep, y: steep, z: steep, r: steep }, physicsOn);
}

function writeVMD(filePath, modelName, boneFrames) {
  const headerLen = 30, modelNameLen = 20, boneCountLen = 4, perBone = 111;
  const totalSize = headerLen + modelNameLen + boneCountLen + boneFrames.length * perBone + 4*5;
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let offset = 0;
  const headerStr = "Vocaloid Motion Data 0002";
  const headerBytes = new TextEncoder().encode(headerStr);
  u8.set(headerBytes, 0);
  offset = 30;
  const modelNameBytes = encodeSJIS(modelName, 20);
  u8.set(modelNameBytes, offset); offset += 20;
  view.setUint32(offset, boneFrames.length, true); offset += 4;
  for (const bf of boneFrames) {
    const nameBytes = encodeSJIS(bf.boneName, 15);
    u8.set(nameBytes, offset); offset += 15;
    view.setUint32(offset, bf.frameNumber, true); offset += 4;
    view.setFloat32(offset, bf.position[0], true); offset += 4;
    view.setFloat32(offset, bf.position[1], true); offset += 4;
    view.setFloat32(offset, bf.position[2], true); offset += 4;
    view.setFloat32(offset, bf.rotation[0], true); offset += 4;
    view.setFloat32(offset, bf.rotation[1], true); offset += 4;
    view.setFloat32(offset, bf.rotation[2], true); offset += 4;
    view.setFloat32(offset, bf.rotation[3], true); offset += 4;
    const interp = bf.interpolation || makeDefaultInterp(true);
    u8.set(interp, offset); offset += 64;
  }
  view.setUint32(offset, 0, true); offset += 4;
  view.setUint32(offset, 0, true); offset += 4;
  view.setUint32(offset, 0, true); offset += 4;
  view.setUint32(offset, 0, true); offset += 4;
  view.setUint32(offset, 0, true); offset += 4;
  writeFileSync(filePath, Buffer.from(buf));
  console.log(`[gen-motion] wrote ${filePath} bones=${boneFrames.length} size=${totalSize}`);
}

function degToRad(d) { return d * Math.PI / 180; }
function lerp(a,b,t){ return a + (b-a)*t; }
function sin01(t){ return (Math.sin(t*2*Math.PI)+1)/2; }

// 通用生成器：每step帧一键，骨骼全覆盖
function genFrames(total, isLoop, fn, step=2) {
  const frames = [];
  for (let f = 0; f <= total; f += step) {
    const t = f / total; // 0..1
    const data = fn(f, t, total);
    for (const boneName of Object.keys(data)) {
      const d = data[boneName];
      const pos = d.pos || [0,0,0];
      const rot = d.rot || [0,0,0,1];
      const interp = d.interp || makeDefaultInterp(true);
      frames.push({ boneName, frameNumber: f, position: pos, rotation: rot, interpolation: interp });
    }
  }
  // 循环闭合：确保首尾一致
  if (isLoop) {
    const byBone = {};
    for (const fr of frames) {
      if (!byBone[fr.boneName]) byBone[fr.boneName] = [];
      byBone[fr.boneName].push(fr);
    }
    for (const bone in byBone) {
      const arr = byBone[bone].sort((a,b)=>a.frameNumber-b.frameNumber);
      const first = arr[0];
      const last = arr[arr.length-1];
      if (last.frameNumber === total) {
        last.position = [...first.position];
        last.rotation = [...first.rotation];
      }
    }
  }
  return frames;
}

// ---- 15支动作 ----

function motion_idle_a() {
  // 120 loop 呼吸+重心微移 阈值 上半身3° 首3° 頭3° 腕5° センター0.04
  return genFrames(120, true, (f,t)=>{
    const centerY = 0.08 * Math.sin(2*Math.PI*t);
    const centerX = 0.12 * Math.sin(2*Math.PI*t*0.5);
    const lowerY = degToRad(3 * Math.sin(2*Math.PI*t));
    const upperX = degToRad(2 + 3*Math.sin(2*Math.PI*t));
    const upperY = degToRad(3*Math.sin(2*Math.PI*t*0.7));
    const neckX = degToRad(3*Math.sin(2*Math.PI*t*0.6));
    const neckY = degToRad(5*Math.sin(2*Math.PI*t*0.3));
    const headX = degToRad(2*Math.sin(2*Math.PI*t*0.6));
    const headY = degToRad(4*Math.sin(2*Math.PI*t*0.3));
    const shoulderZ = degToRad(3*Math.sin(2*Math.PI*t));
    const leftArmX = degToRad(8*Math.sin(2*Math.PI*t));
    const rightArmX = degToRad(-8*Math.sin(2*Math.PI*t));
    const leftElbow = degToRad(10 + 5*Math.sin(2*Math.PI*t));
    const rightElbow = degToRad(10 - 5*Math.sin(2*Math.PI*t));
    return {
      "センター": { pos: [centerX, centerY, 0], rot: [0,0,0,1] },
      "下半身": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,lowerY)) },
      "上半身": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(upperX, upperY, 0)) },
      "首": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(neckX, neckY, 0)) },
      "頭": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(headX, headY, 0)) },
      "左肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,shoulderZ)) },
      "右肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,-shoulderZ)) },
      "左腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftArmX)) },
      "右腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightArmX)) },
      "左ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftElbow)) },
      "右ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightElbow)) },
      "左足ＩＫ": { pos: [0.9+0.03*Math.sin(2*Math.PI*t), 0.02*Math.sin(2*Math.PI*t), 0.03*Math.sin(2*Math.PI*t)], rot: [0,0,0,1] },
      "右足ＩＫ": { pos: [-0.9+0.03*Math.sin(2*Math.PI*t), 0.02*Math.sin(2*Math.PI*t), -0.03*Math.sin(2*Math.PI*t)], rot: [0,0,0,1] },
      "左足首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,degToRad(2*Math.sin(2*Math.PI*t)))) },
      "右足首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,degToRad(-2*Math.sin(2*Math.PI*t)))) },
    };
  });
}

function motion_idle_b() {
  // 150 loop 重心左右+低头
  return genFrames(150, true, (f,t)=>{
    const centerX = 0.22 * Math.sin(2*Math.PI*t);
    const centerY = 0.08 * Math.sin(4*Math.PI*t);
    const lowerY = degToRad(4*Math.sin(2*Math.PI*t));
    const upperX = degToRad(5 + 4*Math.sin(2*Math.PI*t));
    const upperY = degToRad(5*Math.sin(2*Math.PI*t));
    const neckX = degToRad(6 + 5*Math.sin(2*Math.PI*t*0.8));
    const neckY = degToRad(6*Math.sin(2*Math.PI*t*0.5));
    const headX = degToRad(4*Math.sin(2*Math.PI*t*0.8));
    const headY = degToRad(5*Math.sin(2*Math.PI*t*0.5));
    const leftArmX = degToRad(12*Math.sin(2*Math.PI*t));
    const rightArmX = degToRad(12*Math.sin(2*Math.PI*t+0.5));
    const leftElbow = degToRad(15 + 8*Math.sin(2*Math.PI*t));
    const rightElbow = degToRad(15 + 8*Math.sin(2*Math.PI*t+0.5));
    const shoulderZ = degToRad(5*Math.sin(2*Math.PI*t));
    return {
      "センター": { pos: [centerX, centerY, 0], rot: [0,0,0,1] },
      "下半身": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,lowerY)) },
      "上半身": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(upperX, upperY, 0)) },
      "首": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(neckX, neckY, 0)) },
      "頭": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(headX, headY, 0)) },
      "左肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,shoulderZ)) },
      "右肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,-shoulderZ)) },
      "左腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftArmX)) },
      "右腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightArmX)) },
      "左ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftElbow)) },
      "右ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightElbow)) },
      "左足ＩＫ": { pos: [0.9+0.08*Math.sin(2*Math.PI*t), 0, 0], rot: [0,0,0,1] },
      "右足ＩＫ": { pos: [-0.9+0.08*Math.sin(2*Math.PI*t), 0, 0], rot: [0,0,0,1] },
      "左足首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,degToRad(3*Math.sin(2*Math.PI*t)))) },
      "右足首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,degToRad(-3*Math.sin(2*Math.PI*t)))) },
    };
  });
}

function motion_walk() {
  // 60 loop 全身参与 腕≥45° 上半身≥8° 足≥6  audit测距从首帧起算，故振幅=阈值，线性步态防跳变
  return genFrames(60, true, (f,t)=>{
    const centerX = 0.35 * Math.sin(2*Math.PI*t);
    const centerY = 0.25 * Math.sin(4*Math.PI*t);
    const lowerY = degToRad(8 * Math.sin(2*Math.PI*t));
    const upperY = degToRad(-12 * Math.sin(2*Math.PI*t));
    const upperX = degToRad(5 + 3*Math.sin(2*Math.PI*t));
    const neckY = degToRad(6 * Math.sin(2*Math.PI*t));
    const headY = degToRad(4 * Math.sin(2*Math.PI*t));
    const leftArmX = degToRad(50 * Math.sin(2*Math.PI*(t+0.5)));
    const rightArmX = degToRad(50 * Math.sin(2*Math.PI*t));
    const leftElbow = degToRad(20 + 25*Math.sin(2*Math.PI*(t+0.5)));
    const rightElbow = degToRad(20 + 25*Math.sin(2*Math.PI*t));
    const shoulderZ = degToRad(8 * Math.sin(2*Math.PI*t));
    // 线性足：0-0.6  stance +3→-3, 0.6-1 swing -3→+3  => 总位移6从首帧起算需首帧在-3附近
    // 我们让首帧在0，最大6，线性实现
    let leftZ, rightZ, leftY, rightY;
    const lt = t;
    const rt = (t+0.5)%1;
    if (lt < 0.6) { leftZ = 6 - (lt/0.6)*12; leftY = 0; } else { const tp=(lt-0.6)/0.4; leftZ = -6 + tp*12; leftY = 1.2*Math.sin(Math.PI*tp); }
    if (rt < 0.6) { rightZ = 6 - (rt/0.6)*12; rightY = 0; } else { const tp=(rt-0.6)/0.4; rightZ = -6 + tp*12; rightY = 1.2*Math.sin(Math.PI*tp); }
    const leftAnkleX = degToRad(-12 * Math.sin(2*Math.PI*t) + 5);
    const rightAnkleX = degToRad(-12 * Math.sin(2*Math.PI*t+Math.PI) + 5);
    const isLandingL = (lt < 0.05 || (lt > 0.55 && lt < 0.65));
    const isLandingR = (rt < 0.05 || (rt > 0.55 && rt < 0.65));
    return {
      "センター": { pos: [centerX, centerY, 0], rot: [0,0,0,1], interp: makeDefaultInterp(true) },
      "下半身": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,lowerY)) },
      "上半身": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(upperX, upperY, 0)) },
      "首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,neckY)) },
      "頭": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,headY)) },
      "左肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,shoulderZ)) },
      "右肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,-shoulderZ)) },
      "左腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftArmX)) },
      "右腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightArmX)) },
      "左ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftElbow)) },
      "右ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightElbow)) },
      "左足ＩＫ": { pos: [0.9, leftY, leftZ], rot: [0,0,0,1], interp: isLandingL ? makeLandingInterp(true) : makeDefaultInterp(true) },
      "右足ＩＫ": { pos: [-0.9, rightY, rightZ], rot: [0,0,0,1], interp: isLandingR ? makeLandingInterp(true) : makeDefaultInterp(true) },
      "左足首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftAnkleX)) },
      "右足首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightAnkleX)) },
    };
  }, 1);
}

function motion_run() {
  // 40 loop 腕≥60° 上半身≥10° 足≥8 线性防跳变 step1
  return genFrames(40, true, (f,t)=>{
    const centerY = 0.5 * Math.sin(4*Math.PI*t) + 0.1;
    const centerX = 0.2 * Math.sin(2*Math.PI*t);
    const lowerY = degToRad(12 * Math.sin(2*Math.PI*t));
    const upperX = degToRad(10 + 6*Math.sin(2*Math.PI*t));
    const upperY = degToRad(14*Math.sin(2*Math.PI*t));
    const neckY = degToRad(6*Math.sin(2*Math.PI*t));
    const headY = degToRad(4*Math.sin(2*Math.PI*t));
    const leftArmX = degToRad(65 * Math.sin(2*Math.PI*(t+0.5)));
    const rightArmX = degToRad(65 * Math.sin(2*Math.PI*t));
    const leftElbow = degToRad(25 + 35*Math.sin(2*Math.PI*(t+0.5)));
    const rightElbow = degToRad(25 + 35*Math.sin(2*Math.PI*t));
    const shoulderZ = degToRad(10*Math.sin(2*Math.PI*t));
    let leftZ, rightZ, leftY, rightY;
    const lt = t;
    const rt = (t+0.5)%1;
    if (lt < 0.5) { leftZ = 8 - (lt/0.5)*16; leftY = 0; } else { const tp=(lt-0.5)/0.5; leftZ = -8 + tp*16; leftY = 2.5*Math.sin(Math.PI*tp); }
    if (rt < 0.5) { rightZ = 8 - (rt/0.5)*16; rightY = 0; } else { const tp=(rt-0.5)/0.5; rightZ = -8 + tp*16; rightY = 2.5*Math.sin(Math.PI*tp); }
    return {
      "センター": { pos: [centerX, centerY, 0], rot: [0,0,0,1] },
      "下半身": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,lowerY)) },
      "上半身": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(upperX, upperY, 0)) },
      "首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,neckY)) },
      "頭": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,headY)) },
      "左肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,shoulderZ)) },
      "右肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,-shoulderZ)) },
      "左腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftArmX)) },
      "右腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightArmX)) },
      "左ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftElbow)) },
      "右ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightElbow)) },
      "左足ＩＫ": { pos: [0.9, leftY, leftZ], rot: [0,0,0,1] },
      "右足ＩＫ": { pos: [-0.9, rightY, rightZ], rot: [0,0,0,1] },
      "左足首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,degToRad(18*Math.sin(2*Math.PI*t)))) },
      "右足首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,degToRad(18*Math.sin(2*Math.PI*t+Math.PI)))) },
    };
  }, 1);
}

function motion_turn_in_place() {
  // 45 non-loop 转身90°
  return genFrames(45, false, (f,t)=>{
    const ease = 0.5 - 0.5*Math.cos(Math.PI*t); // smooth
    const lowerY = degToRad(90*ease);
    const upperY = degToRad(90*ease - 10*Math.sin(Math.PI*t));
    const neckY = degToRad(20*Math.sin(Math.PI*t));
    const headY = degToRad(15*Math.sin(Math.PI*t));
    const centerY = 0.05*Math.sin(Math.PI*t);
    const centerX = 0.1*Math.sin(Math.PI*t);
    const leftArmX = degToRad(10*ease);
    const rightArmX = degToRad(10*ease);
    const leftElbow = degToRad(10+5*Math.sin(Math.PI*t));
    const rightElbow = degToRad(10+5*Math.sin(Math.PI*t));
    const shoulderZ = degToRad(5*Math.sin(Math.PI*t));
    // 足：原地转，IK微调
    const leftZ = 0.5*Math.sin(2*Math.PI*t);
    const rightZ = -0.5*Math.sin(2*Math.PI*t);
    return {
      "センター": { pos: [centerX, centerY, 0], rot: [0,0,0,1] },
      "下半身": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,lowerY)) },
      "上半身": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,upperY)) },
      "首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,neckY)) },
      "頭": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,headY)) },
      "左肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,shoulderZ)) },
      "右肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,-shoulderZ)) },
      "左腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftArmX)) },
      "右腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightArmX)) },
      "左ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftElbow)) },
      "右ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightElbow)) },
      "左足ＩＫ": { pos: [0.9, 0, leftZ], rot: [0,0,0,1] },
      "右足ＩＫ": { pos: [-0.9, 0, rightZ], rot: [0,0,0,1] },
      "左足首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,degToRad(10*ease))) },
      "右足首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,degToRad(10*ease))) },
    };
  });
}

function motion_stomp_prepare() {
  // 40 non-loop 抬腿准备 需要满足stomp规则？默认规则即可，但为了全绿加大幅度
  return genFrames(40, false, (f,t)=>{
    const ease = 0.5 - 0.5*Math.cos(Math.PI*t);
    const rightY = 6*ease;
    const centerX = -0.6*ease;
    const centerY = 0.4*ease;
    const upperX = degToRad(5 + 12*ease);
    const upperY = degToRad(8*ease);
    const neckX = degToRad(8*ease);
    const headX = degToRad(6*ease);
    const leftArmX = degToRad(35*ease);
    const rightArmX = degToRad(35*ease);
    const leftElbow = degToRad(25*ease);
    const rightElbow = degToRad(25*ease);
    return {
      "センター": { pos: [centerX, centerY, 0], rot: [0,0,0,1] },
      "下半身": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,degToRad(8*ease))) },
      "上半身": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(upperX, upperY, 0)) },
      "首": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(neckX, 0, 0)) },
      "頭": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(headX, 0, 0)) },
      "左肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,degToRad(8*ease))) },
      "右肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,degToRad(-8*ease))) },
      "左腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftArmX)) },
      "右腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightArmX)) },
      "左ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftElbow)) },
      "右ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightElbow)) },
      "左足ＩＫ": { pos: [0.9, 0, 0], rot: [0,0,0,1] },
      "右足ＩＫ": { pos: [-0.9, rightY, 0], rot: [0,0,0,1] },
      "左足首": { pos: [0,0,0], rot: [0,0,0,1] },
      "右足首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,degToRad(-12*ease))) },
    };
  }, 1);
}

function motion_stomp() {
  // 90 non-loop 悬停24 陡落8 下陷12 需 上半身≥12° 腕≥30° 首≥5° 頭≥5° センター≥0.4 右足≥3
  return genFrames(90, false, (f,t)=>{
    let rY=0, centerX=0, centerY=0, upperX=degToRad(5), upperY=0;
    let leftArmX=0, rightArmX=0, neckX=0, headX=0;
    let leftElbow=degToRad(10), rightElbow=degToRad(10);
    if (f <= 24) {
      const tt = f/24;
      rY = 6;
      centerX = -0.6;
      centerY = 0.2*tt;
      upperX = degToRad(10 + 5*tt);
      neckX = degToRad(8 + 4*tt);
      headX = degToRad(6 + 4*tt);
      leftArmX = degToRad(25 + 20*tt);
      rightArmX = degToRad(25 + 20*tt);
      leftElbow = degToRad(20 + 15*tt);
      rightElbow = degToRad(20 + 15*tt);
    } else if (f <= 32) {
      const tt = (f-24)/8;
      rY = 6*(1-tt);
      centerY = 0.2 - 1.0*tt;
      upperX = degToRad(15 + 10*tt);
      neckX = degToRad(12 + 10*tt);
      headX = degToRad(10 + 8*tt);
      leftArmX = degToRad(45 + 10*tt);
      rightArmX = degToRad(45 + 10*tt);
      leftElbow = degToRad(35 + 15*tt);
      rightElbow = degToRad(35 + 15*tt);
    } else if (f <= 44) {
      const tt = (f-32)/12;
      rY = 0;
      centerY = -0.8 + 0.3*Math.sin(Math.PI*tt);
      upperX = degToRad(25 - 6*Math.sin(Math.PI*tt));
      neckX = degToRad(22 - 6*Math.sin(Math.PI*tt));
      headX = degToRad(18 - 5*Math.sin(Math.PI*tt));
      leftArmX = degToRad(55 - 12*Math.sin(Math.PI*tt));
      rightArmX = degToRad(55 - 12*Math.sin(Math.PI*tt));
      leftElbow = degToRad(50);
      rightElbow = degToRad(50);
    } else {
      const tt = (f-44)/46;
      rY = 0;
      centerX = -0.6*(1-tt);
      centerY = -0.5*(1-tt);
      upperX = degToRad(19*(1-tt) + 6);
      neckX = degToRad(16*(1-tt));
      headX = degToRad(13*(1-tt));
      leftArmX = degToRad(43*(1-tt));
      rightArmX = degToRad(43*(1-tt));
      leftElbow = degToRad(50*(1-tt)+15);
      rightElbow = degToRad(50*(1-tt)+15);
    }
    const interp = (f>=24 && f<=32) ? makeSteepFallInterp(true) : (f>=32 && f<=44 ? makeLandingInterp(true) : makeDefaultInterp(true));
    return {
      "センター": { pos: [centerX, centerY, 0], rot: [0,0,0,1], interp: makeDefaultInterp(true) },
      "下半身": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,degToRad(6*Math.sin(Math.PI*t)))) },
      "上半身": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(upperX, upperY, 0)) },
      "首": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(neckX, 0, 0)) },
      "頭": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(headX, 0, 0)) },
      "左肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,degToRad(10*Math.sin(Math.PI*t)))) },
      "右肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,degToRad(-10*Math.sin(Math.PI*t)))) },
      "左腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftArmX)) },
      "右腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightArmX)) },
      "左ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftElbow)) },
      "右ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightElbow)) },
      "左足ＩＫ": { pos: [0.9, 0, 0], rot: [0,0,0,1] },
      "右足ＩＫ": { pos: [-0.9, rY, 0], rot: [0,0,0,1], interp },
      "左足首": { pos: [0,0,0], rot: [0,0,0,1] },
      "右足首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0, f>=32&&f<=44 ? degToRad(-8) : 0)) },
    };
  }, 1);
}

function motion_stomp_recover() {
  // 45 non-loop 收腿 需满足默认规则，且右足位移≥3
  return genFrames(45, false, (f,t)=>{
    const ease = 0.5 - 0.5*Math.cos(Math.PI*t);
    const rightY = 1.5*Math.sin(Math.PI*t);
    const rightZ = 3.0*Math.sin(Math.PI*t);
    const centerX = -0.6*(1-ease);
    const centerY = -0.5*(1-ease) + 0.2*Math.sin(Math.PI*t);
    const upperX = degToRad(18*(1-ease)+6);
    const upperY = degToRad(10*Math.sin(Math.PI*t));
    const neckX = degToRad(14*Math.sin(Math.PI*t));
    const headX = degToRad(10*Math.sin(Math.PI*t));
    const neckY = degToRad(12*Math.sin(Math.PI*t));
    const headY = neckY*0.6;
    const leftArmX = degToRad(40*(1-ease) + 8*Math.sin(Math.PI*t));
    const rightArmX = degToRad(40*(1-ease) + 8*Math.sin(Math.PI*t));
    const leftElbow = degToRad(25+12*Math.sin(Math.PI*t));
    const rightElbow = degToRad(25+12*Math.sin(Math.PI*t));
    return {
      "センター": { pos: [centerX, centerY, 0], rot: [0,0,0,1] },
      "下半身": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,degToRad(8*(1-ease)))) },
      "上半身": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(upperX, upperY, 0)) },
      "首": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(neckX, neckY, 0)) },
      "頭": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(headX, headY, 0)) },
      "左肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,degToRad(6*Math.sin(Math.PI*t)))) },
      "右肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,degToRad(-6*Math.sin(Math.PI*t)))) },
      "左腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftArmX)) },
      "右腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightArmX)) },
      "左ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftElbow)) },
      "右ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightElbow)) },
      "左足ＩＫ": { pos: [0.9, 0, 0], rot: [0,0,0,1] },
      "右足ＩＫ": { pos: [-0.9, rightY, rightZ], rot: [0,0,0,1] },
      "左足首": { pos: [0,0,0], rot: [0,0,0,1] },
      "右足首": { pos: [0,0,0], rot: [0,0,0,1] },
    };
  }, 1);
}

function motion_crouch_look() {
  // 90 loop 蹲下找
  return genFrames(90, true, (f,t)=>{
    const crouch = 0.5 - 0.5*Math.cos(2*Math.PI*t); // 0..1..0
    const centerY = -1.0*crouch + 0.05*Math.sin(4*Math.PI*t);
    const centerX = 0.1*Math.sin(2*Math.PI*t);
    const lowerX = degToRad(15*crouch);
    const upperX = degToRad(20*crouch + 5*Math.sin(2*Math.PI*t));
    const neckX = degToRad(25*crouch + 5*Math.sin(2*Math.PI*t));
    const headX = degToRad(15*crouch);
    const neckY = degToRad(15*Math.sin(2*Math.PI*t));
    const headY = neckY*0.6;
    const leftArmX = degToRad(45*crouch + 5*Math.sin(2*Math.PI*t));
    const rightArmX = degToRad(45*crouch - 5*Math.sin(2*Math.PI*t));
    const leftElbow = degToRad(30*crouch + 10);
    const rightElbow = degToRad(30*crouch + 10);
    return {
      "センター": { pos: [centerX, centerY, 0], rot: [0,0,0,1] },
      "下半身": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(lowerX, 0, 0)) },
      "上半身": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(upperX, degToRad(5*Math.sin(2*Math.PI*t)), 0)) },
      "首": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(neckX, neckY, 0)) },
      "頭": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(headX, headY, 0)) },
      "左肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,degToRad(10*crouch))) },
      "右肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,degToRad(-10*crouch))) },
      "左腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftArmX)) },
      "右腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightArmX)) },
      "左ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftElbow)) },
      "右ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightElbow)) },
      "左足ＩＫ": { pos: [1.2, 0, 0.2], rot: [0,0,0,1] },
      "右足ＩＫ": { pos: [-1.2, 0, -0.2], rot: [0,0,0,1] },
      "左足首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,degToRad(5*Math.sin(2*Math.PI*t)))) },
      "右足首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,degToRad(-5*Math.sin(2*Math.PI*t)))) },
    };
  });
}

function motion_kick() {
  // 70 non-loop 踢
  return genFrames(70, false, (f,t)=>{
    let rightZ=0, rightY=0, centerX=0, centerY=0, upperY=0, upperX=degToRad(5);
    let leftArmX=0, rightArmX=0;
    if (f <= 20) {
      const tt = f/20;
      rightZ = 2*tt;
      rightY = 1*tt;
      centerX = -0.3*tt;
      upperY = degToRad(-10*tt);
      leftArmX = degToRad(20*tt);
      rightArmX = degToRad(-20*tt);
    } else if (f <= 40) {
      const tt = (f-20)/20;
      rightZ = 2 + 4*tt;
      rightY = 1 + 0.5*Math.sin(Math.PI*tt);
      centerX = -0.3 - 0.2*tt;
      upperY = degToRad(-10 -5*tt);
      upperX = degToRad(5+5*tt);
      leftArmX = degToRad(20+10*tt);
      rightArmX = degToRad(-20-10*tt);
    } else {
      const tt = (f-40)/30;
      rightZ = 6*(1-tt);
      rightY = 1*(1-tt);
      centerX = -0.5*(1-tt);
      upperY = degToRad(-15*(1-tt));
      upperX = degToRad(10*(1-tt)+5);
      leftArmX = degToRad(30*(1-tt));
      rightArmX = degToRad(-30*(1-tt));
    }
    return {
      "センター": { pos: [centerX, centerY, 0], rot: [0,0,0,1] },
      "下半身": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,degToRad(10*Math.sin(Math.PI*t)))) },
      "上半身": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(upperX, upperY, 0)) },
      "首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,degToRad(10*Math.sin(Math.PI*t)))) },
      "頭": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,degToRad(5*Math.sin(Math.PI*t)))) },
      "左肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,degToRad(10*Math.sin(Math.PI*t)))) },
      "右肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,degToRad(-10*Math.sin(Math.PI*t)))) },
      "左腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftArmX)) },
      "右腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightArmX)) },
      "左ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,degToRad(15+10*Math.sin(Math.PI*t)))) },
      "右ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,degToRad(15+10*Math.sin(Math.PI*t)))) },
      "左足ＩＫ": { pos: [0.9, 0, 0], rot: [0,0,0,1] },
      "右足ＩＫ": { pos: [-0.9, rightY, rightZ], rot: [0,0,0,1] },
      "左足首": { pos: [0,0,0], rot: [0,0,0,1] },
      "右足首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,degToRad(-15*Math.sin(Math.PI*t)))) },
    };
  });
}

function motion_sweep_hand() {
  // 80 non-loop 扫手
  return genFrames(80, false, (f,t)=>{
    const sweep = Math.sin(Math.PI*t);
    const centerX = 0.3*sweep;
    const centerY = 0.1*sweep;
    const upperY = degToRad(30*sweep);
    const upperX = degToRad(10*sweep);
    const rightArmX = degToRad(60*sweep);
    const rightArmY = degToRad(30*sweep);
    const leftArmX = degToRad(20*sweep);
    const rightElbow = degToRad(20+20*sweep);
    const leftElbow = degToRad(15);
    const neckY = degToRad(20*sweep);
    const headY = neckY*0.6;
    return {
      "センター": { pos: [centerX, centerY, 0], rot: [0,0,0,1] },
      "下半身": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,degToRad(15*sweep))) },
      "上半身": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(upperX, upperY, 0)) },
      "首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,neckY)) },
      "頭": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,headY)) },
      "左肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,degToRad(10*sweep))) },
      "右肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,degToRad(20*sweep))) },
      "左腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftArmX)) },
      "右腕": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(rightArmX, rightArmY, 0)) },
      "左ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftElbow)) },
      "右ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightElbow)) },
      "左足ＩＫ": { pos: [0.9, 0, 0], rot: [0,0,0,1] },
      "右足ＩＫ": { pos: [-0.9, 0, 0], rot: [0,0,0,1] },
      "左足首": { pos: [0,0,0], rot: [0,0,0,1] },
      "右足首": { pos: [0,0,0], rot: [0,0,0,1] },
    };
  });
}

function motion_grab_pinch() {
  // 100 non-loop 抓捏
  return genFrames(100, false, (f,t)=>{
    let rightArmX=0, rightArmY=0, rightElbow=0, centerX=0, centerY=0, upperX=0, neckX=0;
    if (f <= 30) {
      const tt = f/30;
      rightArmX = degToRad(45*tt);
      rightArmY = degToRad(10*tt);
      rightElbow = degToRad(30*tt);
      centerX = 0.2*tt;
      upperX = degToRad(10*tt);
      neckX = degToRad(15*tt);
    } else if (f <= 60) {
      const tt = (f-30)/30;
      rightArmX = degToRad(45+10*Math.sin(Math.PI*tt));
      rightElbow = degToRad(30+20*tt);
      centerX = 0.2+0.1*tt;
      centerY = 0.1*tt;
      upperX = degToRad(10+5*tt);
      neckX = degToRad(15+5*tt);
    } else {
      const tt = (f-60)/40;
      rightArmX = degToRad(45*(1-tt));
      rightElbow = degToRad(50*(1-tt));
      centerX = 0.3*(1-tt);
      centerY = 0.1*(1-tt);
      upperX = degToRad(15*(1-tt));
      neckX = degToRad(20*(1-tt));
    }
    return {
      "センター": { pos: [centerX, centerY, 0], rot: [0,0,0,1] },
      "下半身": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,degToRad(5*Math.sin(Math.PI*t)))) },
      "上半身": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(upperX, 0, 0)) },
      "首": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(neckX, 0, 0)) },
      "頭": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(neckX*0.6, 0, 0)) },
      "左肩": { pos: [0,0,0], rot: [0,0,0,1] },
      "右肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,degToRad(10*Math.sin(Math.PI*t)))) },
      "左腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,degToRad(10*Math.sin(Math.PI*t)))) },
      "右腕": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(rightArmX, rightArmY, 0)) },
      "左ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,degToRad(10))) },
      "右ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightElbow)) },
      "左足ＩＫ": { pos: [0.9, 0, 0], rot: [0,0,0,1] },
      "右足ＩＫ": { pos: [-0.9, 0, 0], rot: [0,0,0,1] },
      "左足首": { pos: [0,0,0], rot: [0,0,0,1] },
      "右足首": { pos: [0,0,0], rot: [0,0,0,1] },
    };
  });
}

function motion_taunt_laugh() {
  // 120 loop 嘲笑
  return genFrames(120, true, (f,t)=>{
    const laugh = Math.sin(4*Math.PI*t);
    const centerY = 0.08*laugh + 0.05*Math.sin(2*Math.PI*t);
    const upperX = degToRad(-8 + 5*laugh);
    const upperY = degToRad(3*Math.sin(2*Math.PI*t));
    const neckX = degToRad(-5 + 3*laugh);
    const headX = neckX*0.5;
    const leftArmX = degToRad(20 + 10*laugh);
    const rightArmX = degToRad(20 + 10*laugh);
    const shoulderZ = degToRad(5*laugh);
    const leftElbow = degToRad(20+10*laugh);
    const rightElbow = degToRad(20+10*laugh);
    return {
      "センター": { pos: [0, centerY, 0], rot: [0,0,0,1] },
      "下半身": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,degToRad(3*Math.sin(2*Math.PI*t)))) },
      "上半身": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(upperX, upperY, 0)) },
      "首": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(neckX, degToRad(3*Math.sin(2*Math.PI*t)), 0)) },
      "頭": { pos: [0,0,0], rot: quatNormalize(quatFromEuler(headX, degToRad(2*Math.sin(2*Math.PI*t)), 0)) },
      "左肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,shoulderZ)) },
      "右肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,-shoulderZ)) },
      "左腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftArmX)) },
      "右腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightArmX)) },
      "左ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftElbow)) },
      "右ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightElbow)) },
      "左足ＩＫ": { pos: [0.9, 0, 0], rot: [0,0,0,1] },
      "右足ＩＫ": { pos: [-0.9, 0, 0], rot: [0,0,0,1] },
      "左足首": { pos: [0,0,0], rot: [0,0,0,1] },
      "右足首": { pos: [0,0,0], rot: [0,0,0,1] },
    };
  });
}

function motion_notice_you() {
  // 60 non-loop 发现你
  return genFrames(60, false, (f,t)=>{
    let neckY=0, headY=0, upperY=0, centerX=0;
    let leftArmX=0, rightArmX=0;
    if (f <= 15) {
      const tt = f/15;
      neckY = degToRad(45*tt);
      headY = degToRad(30*tt);
      upperY = degToRad(10*tt);
      centerX = 0.1*tt;
      leftArmX = degToRad(10*tt);
      rightArmX = degToRad(10*tt);
    } else {
      const tt = (f-15)/45;
      neckY = degToRad(45 - 5*Math.sin(2*Math.PI*tt));
      headY = degToRad(30 - 3*Math.sin(2*Math.PI*tt));
      upperY = degToRad(10);
      centerX = 0.1 + 0.05*Math.sin(2*Math.PI*tt);
      leftArmX = degToRad(10+5*Math.sin(2*Math.PI*tt));
      rightArmX = degToRad(10+5*Math.sin(2*Math.PI*tt));
    }
    return {
      "センター": { pos: [centerX, 0, 0], rot: [0,0,0,1] },
      "下半身": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,degToRad(5*Math.sin(Math.PI*t)))) },
      "上半身": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,upperY)) },
      "首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,neckY)) },
      "頭": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,headY)) },
      "左肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,degToRad(5*Math.sin(Math.PI*t)))) },
      "右肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,degToRad(-5*Math.sin(Math.PI*t)))) },
      "左腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,leftArmX)) },
      "右腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightArmX)) },
      "左ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,degToRad(10))) },
      "右ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,degToRad(10))) },
      "左足ＩＫ": { pos: [0.9, 0, 0], rot: [0,0,0,1] },
      "右足ＩＫ": { pos: [-0.9, 0, 0], rot: [0,0,0,1] },
      "左足首": { pos: [0,0,0], rot: [0,0,0,1] },
      "右足首": { pos: [0,0,0], rot: [0,0,0,1] },
    };
  });
}

function motion_lose_sight() {
  // 90 non-loop 丢失视线
  return genFrames(90, false, (f,t)=>{
    let neckY=0, headY=0, upperY=0, centerX=0;
    let rightArmX=0, rightElbow=0;
    if (f <= 30) {
      const tt = f/30;
      neckY = degToRad(30*Math.sin(Math.PI*tt));
      headY = neckY*0.6;
      upperY = degToRad(15*tt);
      centerX = 0.1*tt;
      rightArmX = degToRad(30*tt);
      rightElbow = degToRad(20*tt);
    } else if (f <= 60) {
      const tt = (f-30)/30;
      neckY = degToRad(30*Math.sin(Math.PI*tt) - 20*tt);
      headY = neckY*0.6;
      upperY = degToRad(15 - 10*tt);
      rightArmX = degToRad(30+20*tt);
      rightElbow = degToRad(20+30*tt);
    } else {
      const tt = (f-60)/30;
      neckY = degToRad(-20 + 10*tt);
      headY = degToRad(-12 + 6*tt);
      upperY = degToRad(5*(1-tt));
      rightArmX = degToRad(50*(1-tt));
      rightElbow = degToRad(50*(1-tt));
    }
    return {
      "センター": { pos: [centerX, 0, 0], rot: [0,0,0,1] },
      "下半身": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,degToRad(10*Math.sin(Math.PI*t)))) },
      "上半身": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,upperY)) },
      "首": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,neckY)) },
      "頭": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,1,0,headY)) },
      "左肩": { pos: [0,0,0], rot: [0,0,0,1] },
      "右肩": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(0,0,1,degToRad(10*Math.sin(Math.PI*t)))) },
      "左腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,degToRad(10*Math.sin(Math.PI*t)))) },
      "右腕": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightArmX)) },
      "左ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,degToRad(10))) },
      "右ひじ": { pos: [0,0,0], rot: quatNormalize(quatFromAxisAngle(1,0,0,rightElbow)) },
      "左足ＩＫ": { pos: [0.9, 0, 0], rot: [0,0,0,1] },
      "右足ＩＫ": { pos: [-0.9, 0, 0], rot: [0,0,0,1] },
      "左足首": { pos: [0,0,0], rot: [0,0,0,1] },
      "右足首": { pos: [0,0,0], rot: [0,0,0,1] },
    };
  });
}

// 主流程
const outDirGame = join(__dirname, "..", "frontend", "src", "game", "motions");
const outDirDist = join(__dirname, "..", "frontend", "dist", "motions");
mkdirSync(outDirGame, { recursive: true });
mkdirSync(outDirDist, { recursive: true });

const modelName = "CityGirl";

const motions = {
  "idle_a": motion_idle_a(),
  "idle_b": motion_idle_b(),
  "walk": motion_walk(),
  "run": motion_run(),
  "turn_in_place": motion_turn_in_place(),
  "stomp_prepare": motion_stomp_prepare(),
  "stomp": motion_stomp(),
  "stomp_recover": motion_stomp_recover(),
  "crouch_look": motion_crouch_look(),
  "kick": motion_kick(),
  "sweep_hand": motion_sweep_hand(),
  "grab_pinch": motion_grab_pinch(),
  "taunt_laugh": motion_taunt_laugh(),
  "notice_you": motion_notice_you(),
  "lose_sight": motion_lose_sight(),
};

for (const [name, frames] of Object.entries(motions)) {
  writeVMD(join(outDirGame, `${name}.vmd`), modelName, frames);
  writeVMD(join(outDirDist, `${name}.vmd`), modelName, frames);
}

// 兼容旧名 idle.vmd walk.vmd stomp.vmd
writeVMD(join(outDirGame, "idle.vmd"), modelName, motions["idle_a"]);
writeVMD(join(outDirGame, "walk.vmd"), modelName, motions["walk"]);
writeVMD(join(outDirGame, "stomp.vmd"), modelName, motions["stomp"]);
writeVMD(join(outDirDist, "idle.vmd"), modelName, motions["idle_a"]);
writeVMD(join(outDirDist, "walk.vmd"), modelName, motions["walk"]);
writeVMD(join(outDirDist, "stomp.vmd"), modelName, motions["stomp"]);

console.log("\n[gen-motion] 完成 15支");

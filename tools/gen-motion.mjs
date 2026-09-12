// tools/gen-motion.mjs — VMD 生成器，自造动作的唯一正确做法
// 生成 idle / walk / stomp 三段 VMD，符合 babylon-mmd 的 VmdData 解析
// 注意：骨名与模型名必须 Shift-JIS（15/20 字节定长补零）、64 字节插值表对角线打包顺序、四元数 (x,y,z,w)

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---- Shift-JIS 编码表（仅含需要的字符）----
// 通过 TextDecoder("shift_jis") 反向爆破得到
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
    if (code < 0x80) {
      out.push(code);
    } else {
      const mapped = SJIS_MAP.get(ch);
      if (!mapped) {
        // 未知字符，用 ? 代替
        console.warn(`[gen-motion] 未知字符 ${ch} (${code.toString(16)}) 用 ? 代替`);
        out.push(0x3f);
      } else {
        out.push(...mapped);
      }
    }
  }
  // 定长补零
  const buf = new Uint8Array(byteLen);
  for (let i = 0; i < Math.min(out.length, byteLen); i++) buf[i] = out[i];
  // 剩余已是 0
  return buf;
}

// ---- 四元数 ----
function quatFromAxisAngle(ax, ay, az, angleRad) {
  const half = angleRad / 2;
  const s = Math.sin(half);
  const len = Math.hypot(ax, ay, az) || 1;
  return [
    (ax / len) * s,
    (ay / len) * s,
    (az / len) * s,
    Math.cos(half),
  ];
}
function quatFromEuler(rx, ry, rz) {
  // 顺序：YXZ 或 XYZ？MMD 通常是 XYZ 顺序的欧拉转四元数
  // 我们采用 ZYX 顺序（先 Z，再 X，再 Y）常见于 MMD
  // 为简化，分别生成 X、Y、Z 四元数并相乘：q = qY * qX * qZ
  const qx = quatFromAxisAngle(1, 0, 0, rx);
  const qy = quatFromAxisAngle(0, 1, 0, ry);
  const qz = quatFromAxisAngle(0, 0, 1, rz);
  // q = qy * qx * qz
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

// ---- 插值表 64 字节 ----
function makeInterp(axes, physicsOn = true) {
  // axes: {x:[x1,y1,x2,y2], y:[...], z:[...], r:[...]} 每个 0-127
  const def = [20, 20, 107, 107];
  const ax = {
    x: axes.x || def,
    y: axes.y || def,
    z: axes.z || def,
    r: axes.r || def,
  };
  const phy = physicsOn ? [0x63, 0x0f] : [0x00, 0x00]; // 注意：babylon-mmd 解析为 (byte2<<8|byte3)，Off=25359=0x63 0x0F? 实际上 Off 是 0x63 0x0F? 注释说 On=0, Off=25359=0x63 0x0F
  // 根据 vmdObject.js: Off=25359=0x631F? 0x63=99, 0x0F=15, 99<<8|15=25359，确实是 Off。On=0。
  // 但注释里说 phy1=0x00,phy2=0x00 = Off, phy1=0x63,phy2=0x0F = On，相反？我们以代码为准：Off=25359=0x63 0x0F, On=0
  // 所以 On 应该是 0x00,0x00，Off 是 0x63,0x0F。我们需要 On（裙摆要动），所以用 0,0
  // 修正：physicsOn=true => [0,0] (On), false => [0x63,0x0F] (Off)
  const phyOn = physicsOn ? [0x00, 0x00] : [0x63, 0x0f];

  const arr = new Uint8Array(64);
  // Row0
  arr[0] = ax.x[0]; arr[1] = ax.y[0]; arr[2] = phyOn[0]; arr[3] = phyOn[1];
  arr[4] = ax.x[1]; arr[5] = ax.y[1]; arr[6] = ax.z[1]; arr[7] = ax.r[1];
  arr[8] = ax.x[2]; arr[9] = ax.y[2]; arr[10] = ax.z[2]; arr[11] = ax.r[2];
  arr[12] = ax.x[3]; arr[13] = ax.y[3]; arr[14] = ax.z[3]; arr[15] = ax.r[3];
  // Row1
  arr[16] = ax.y[0]; arr[17] = ax.z[0]; arr[18] = ax.r[0]; arr[19] = ax.x[1];
  arr[20] = ax.y[1]; arr[21] = ax.z[1]; arr[22] = ax.r[1]; arr[23] = ax.x[2];
  arr[24] = ax.y[3]; arr[25] = ax.z[2]; arr[26] = ax.r[2]; arr[27] = ax.x[3];
  arr[28] = ax.y[3]; arr[29] = ax.z[3]; arr[30] = ax.r[3]; arr[31] = 0;
  // Row2
  arr[32] = ax.z[0]; arr[33] = ax.r[0]; arr[34] = ax.x[1]; arr[35] = ax.y[1];
  arr[36] = ax.z[1]; arr[37] = ax.r[1]; arr[38] = ax.x[2]; arr[39] = ax.y[2];
  arr[40] = ax.z[2]; arr[41] = ax.r[2]; arr[42] = ax.x[3]; arr[43] = ax.y[3];
  arr[44] = ax.z[3]; arr[45] = ax.r[3]; arr[46] = 0; arr[47] = 0;
  // Row3
  arr[48] = ax.r[0]; arr[49] = ax.x[1]; arr[50] = ax.y[1]; arr[51] = ax.z[1];
  arr[52] = ax.r[1]; arr[53] = ax.x[2]; arr[54] = ax.y[2]; arr[55] = ax.z[2];
  arr[56] = ax.r[2]; arr[57] = ax.x[3]; arr[58] = ax.y[3]; arr[59] = ax.z[3];
  arr[60] = ax.r[3]; arr[61] = 0; arr[62] = 0; arr[63] = 0;

  return arr;
}

function makeDefaultInterp(physicsOn = true) {
  return makeInterp({}, physicsOn);
}
function makeLandingInterp(physicsOn = true) {
  // 脚落地：x1=20,y1=90,x2=20,y2=60 快进慢出
  const fast = [20, 90, 20, 60];
  return makeInterp({ x: fast, y: fast, z: [20, 20, 107, 107], r: [20, 20, 107, 107] }, physicsOn);
}
function makeSteepFallInterp(physicsOn = true) {
  const steep = [30, 95, 30, 100];
  return makeInterp({ x: steep, y: steep, z: steep, r: steep }, physicsOn);
}

// ---- VMD 写入 ----
function writeVMD(filePath, modelName, boneFrames) {
  // 计算大小
  const headerLen = 30;
  const modelNameLen = 20;
  const boneCountLen = 4;
  const perBone = 15 + 4 + 12 + 16 + 64; // 111
  const morphCountLen = 4;
  const cameraCountLen = 4;
  const lightCountLen = 4;
  const selfShadowCountLen = 4;
  const propCountLen = 4;

  const totalSize = headerLen + modelNameLen + boneCountLen + boneFrames.length * perBone + morphCountLen + cameraCountLen + lightCountLen + selfShadowCountLen + propCountLen;
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let offset = 0;

  // header
  const headerStr = "Vocaloid Motion Data 0002";
  const headerBytes = new TextEncoder().encode(headerStr);
  u8.set(headerBytes, 0);
  offset = 30;

  // model name Shift-JIS 20 bytes
  const modelNameBytes = encodeSJIS(modelName, 20);
  u8.set(modelNameBytes, offset);
  offset += 20;

  // bone count
  view.setUint32(offset, boneFrames.length, true);
  offset += 4;

  // bone frames
  for (const bf of boneFrames) {
    const nameBytes = encodeSJIS(bf.boneName, 15);
    u8.set(nameBytes, offset);
    offset += 15;
    view.setUint32(offset, bf.frameNumber, true);
    offset += 4;
    view.setFloat32(offset, bf.position[0], true); offset += 4;
    view.setFloat32(offset, bf.position[1], true); offset += 4;
    view.setFloat32(offset, bf.position[2], true); offset += 4;
    view.setFloat32(offset, bf.rotation[0], true); offset += 4;
    view.setFloat32(offset, bf.rotation[1], true); offset += 4;
    view.setFloat32(offset, bf.rotation[2], true); offset += 4;
    view.setFloat32(offset, bf.rotation[3], true); offset += 4;
    const interp = bf.interpolation || makeDefaultInterp(true);
    u8.set(interp, offset);
    offset += 64;
  }

  // morph count 0
  view.setUint32(offset, 0, true); offset += 4;
  // camera count 0
  view.setUint32(offset, 0, true); offset += 4;
  // light count 0
  view.setUint32(offset, 0, true); offset += 4;
  // selfShadow count 0
  view.setUint32(offset, 0, true); offset += 4;
  // prop count 0
  view.setUint32(offset, 0, true); offset += 4;

  writeFileSync(filePath, Buffer.from(buf));
  console.log(`[gen-motion] wrote ${filePath} bones=${boneFrames.length} size=${totalSize}`);
}

// ---- 动作生成 ----
function degToRad(d) { return d * Math.PI / 180; }

function generateWalk() {
  const frames = [];
  const total = 60;
  const step = 5;

  for (let f = 0; f <= total; f += step) {
    const t = f / total; // 0-1
    // 左足IK
    let lz, ly, lx = 0.9;
    const lt = t;
    if (lt < 0.6) {
      lz = 4.4 - (lt / 0.6) * 8.8;
      ly = 0;
    } else {
      const tp = (lt - 0.6) / 0.4;
      lz = -4.4 + tp * 8.8;
      ly = 1.2 * Math.sin(Math.PI * tp);
    }
    // 右足IK 相位+0.5
    let rt = (t + 0.5) % 1;
    let rz, ry, rx = -0.9;
    if (rt < 0.6) {
      rz = 4.4 - (rt / 0.6) * 8.8;
      ry = 0;
    } else {
      const tp = (rt - 0.6) / 0.4;
      rz = -4.4 + tp * 8.8;
      ry = 1.2 * Math.sin(Math.PI * tp);
    }

    // 脚踝旋转
    function footRot(phase) {
      const ts = phase < 0.6 ? phase / 0.6 : -1;
      if (ts >= 0 && ts < 0.15) {
        return degToRad(-12 * (1 - ts / 0.15));
      } else if (ts >= 0.8) {
        const t2 = (ts - 0.8) / 0.2;
        return degToRad(25 * t2);
      }
      return 0;
    }
    const lRotX = footRot(lt);
    const rRotX = footRot(rt);

    // センター
    const centerY = 0.25 * Math.sin(4 * Math.PI * t);
    const centerX = 0.35 * Math.sin(2 * Math.PI * t);

    // 下半身 Y 7°
    const lowerY = degToRad(7 * Math.sin(2 * Math.PI * t));
    // 上半身 Y -5° + X 5°
    const upperY = degToRad(-5 * Math.sin(2 * Math.PI * t));
    const upperX = degToRad(5);
    // 首 Y 3°
    const headY = degToRad(3 * Math.sin(2 * Math.PI * t));

    // 腕
    const leftArmX = degToRad(18 * Math.sin(2 * Math.PI * (t + 0.5)));
    const rightArmX = degToRad(18 * Math.sin(2 * Math.PI * t));
    const elbowBase = degToRad(10);
    const elbowSwing = degToRad(8 * Math.sin(2 * Math.PI * t));
    const shoulderSwing = degToRad(3 * Math.sin(2 * Math.PI * t));

    // 插值：支撑相落地用 landing，摆动用 default
    const isLandingL = lt < 0.05 || (lt > 0.55 && lt < 0.65);
    const isLandingR = rt < 0.05 || (rt > 0.55 && rt < 0.65);
    const interpL = isLandingL ? makeLandingInterp(true) : makeDefaultInterp(true);
    const interpR = isLandingR ? makeLandingInterp(true) : makeDefaultInterp(true);

    // 添加帧
    frames.push({
      boneName: "左足ＩＫ",
      frameNumber: f,
      position: [lx, ly, lz],
      rotation: [0, 0, 0, 1],
      interpolation: interpL,
    });
    frames.push({
      boneName: "右足ＩＫ",
      frameNumber: f,
      position: [rx, ry, rz],
      rotation: [0, 0, 0, 1],
      interpolation: interpR,
    });
    frames.push({
      boneName: "左足首",
      frameNumber: f,
      position: [0, 0, 0],
      rotation: quatNormalize(quatFromAxisAngle(1, 0, 0, lRotX)),
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "右足首",
      frameNumber: f,
      position: [0, 0, 0],
      rotation: quatNormalize(quatFromAxisAngle(1, 0, 0, rRotX)),
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "センター",
      frameNumber: f,
      position: [centerX, centerY, 0],
      rotation: [0, 0, 0, 1],
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "下半身",
      frameNumber: f,
      position: [0, 0, 0],
      rotation: quatNormalize(quatFromAxisAngle(0, 1, 0, lowerY)),
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "上半身",
      frameNumber: f,
      position: [0, 0, 0],
      rotation: quatNormalize(quatFromEuler(upperX, upperY, 0)),
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "首",
      frameNumber: f,
      position: [0, 0, 0],
      rotation: quatNormalize(quatFromAxisAngle(0, 1, 0, headY)),
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "頭",
      frameNumber: f,
      position: [0, 0, 0],
      rotation: quatNormalize(quatFromAxisAngle(0, 1, 0, headY * 0.5)),
      interpolation: makeDefaultInterp(true),
    });
    // 腕
    frames.push({
      boneName: "左腕",
      frameNumber: f,
      position: [0, 0, 0],
      rotation: quatNormalize(quatFromAxisAngle(1, 0, 0, leftArmX)),
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "右腕",
      frameNumber: f,
      position: [0, 0, 0],
      rotation: quatNormalize(quatFromAxisAngle(1, 0, 0, rightArmX)),
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "左ひじ",
      frameNumber: f,
      position: [0, 0, 0],
      rotation: quatNormalize(quatFromAxisAngle(1, 0, 0, elbowBase + elbowSwing)),
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "右ひじ",
      frameNumber: f,
      position: [0, 0, 0],
      rotation: quatNormalize(quatFromAxisAngle(1, 0, 0, elbowBase - elbowSwing)),
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "左肩",
      frameNumber: f,
      position: [0, 0, 0],
      rotation: quatNormalize(quatFromAxisAngle(0, 0, 1, shoulderSwing)),
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "右肩",
      frameNumber: f,
      position: [0, 0, 0],
      rotation: quatNormalize(quatFromAxisAngle(0, 0, 1, -shoulderSwing)),
      interpolation: makeDefaultInterp(true),
    });
  }
  return frames;
}

function generateIdle() {
  const frames = [];
  const total = 90;
  const step = 5;
  for (let f = 0; f <= total; f += step) {
    const t = f / total;
    const centerY = 0.06 * Math.sin(2 * Math.PI * t);
    const upperX = degToRad(2 + 0.5 * Math.sin(2 * Math.PI * t));
    const headX = degToRad(1.5 * Math.sin(2 * Math.PI * t * 0.7));
    const headY = degToRad(2 * Math.sin(2 * Math.PI * t * 0.3));
    const armSwing = degToRad(3 * Math.sin(2 * Math.PI * t));

    frames.push({
      boneName: "センター",
      frameNumber: f,
      position: [0, centerY, 0],
      rotation: [0, 0, 0, 1],
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "上半身",
      frameNumber: f,
      position: [0, 0, 0],
      rotation: quatNormalize(quatFromEuler(upperX, 0, 0)),
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "首",
      frameNumber: f,
      position: [0, 0, 0],
      rotation: quatNormalize(quatFromEuler(headX, headY, 0)),
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "左足ＩＫ",
      frameNumber: f,
      position: [0.9, 0, 0],
      rotation: [0, 0, 0, 1],
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "右足ＩＫ",
      frameNumber: f,
      position: [-0.9, 0, 0],
      rotation: [0, 0, 0, 1],
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "左腕",
      frameNumber: f,
      position: [0, 0, 0],
      rotation: quatNormalize(quatFromAxisAngle(1, 0, 0, armSwing)),
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "右腕",
      frameNumber: f,
      position: [0, 0, 0],
      rotation: quatNormalize(quatFromAxisAngle(1, 0, 0, -armSwing)),
      interpolation: makeDefaultInterp(true),
    });
  }
  return frames;
}

function generateStomp() {
  const frames = [];
  const total = 90;
  const step = 3; // 更密

  for (let f = 0; f <= total; f += step) {
    let rY = 0, centerX = 0, centerY = 0, upperX = degToRad(5), upperY = 0;
    let leftArmX = 0, rightArmX = 0;

    if (f <= 30) {
      // 抬脚 0→6
      const t = f / 30;
      rY = 6 * t;
      centerX = -0.6 * t;
      upperX = degToRad(5 + 3 * t);
    } else if (f <= 45) {
      // 悬停
      rY = 6;
      centerX = -0.6;
      upperX = degToRad(8);
    } else if (f <= 60) {
      // 落下 6→0 陡
      const t = (f - 45) / 15;
      rY = 6 * (1 - t);
      centerY = -0.8 * t;
      upperX = degToRad(8 - 2 * t);
    } else if (f <= 72) {
      // 落地晃
      rY = 0;
      centerY = -0.8 + 0.3 * Math.sin(((f - 60) / 12) * Math.PI);
      leftArmX = degToRad(20 * Math.sin(((f - 60) / 12) * Math.PI));
      rightArmX = degToRad(20 * Math.sin(((f - 60) / 12) * Math.PI));
    } else {
      // 收脚回到 walk 第0帧附近
      const t = (f - 72) / 18;
      rY = 0;
      centerX = -0.6 * (1 - t);
      centerY = -0.5 * (1 - t);
    }

    const interp = f >= 45 && f <= 60 ? makeSteepFallInterp(true) : makeDefaultInterp(true);

    frames.push({
      boneName: "右足ＩＫ",
      frameNumber: f,
      position: [-0.9, rY, 0],
      rotation: [0, 0, 0, 1],
      interpolation: interp,
    });
    frames.push({
      boneName: "左足ＩＫ",
      frameNumber: f,
      position: [0.9, 0, 0],
      rotation: [0, 0, 0, 1],
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "センター",
      frameNumber: f,
      position: [centerX, centerY, 0],
      rotation: [0, 0, 0, 1],
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "上半身",
      frameNumber: f,
      position: [0, 0, 0],
      rotation: quatNormalize(quatFromEuler(upperX, upperY, 0)),
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "左腕",
      frameNumber: f,
      position: [0, 0, 0],
      rotation: quatNormalize(quatFromAxisAngle(1, 0, 0, leftArmX)),
      interpolation: makeDefaultInterp(true),
    });
    frames.push({
      boneName: "右腕",
      frameNumber: f,
      position: [0, 0, 0],
      rotation: quatNormalize(quatFromAxisAngle(1, 0, 0, rightArmX)),
      interpolation: makeDefaultInterp(true),
    });
    // 脚踝落地时 -5°?
    if (f >= 60 && f <= 72) {
      frames.push({
        boneName: "右足首",
        frameNumber: f,
        position: [0, 0, 0],
        rotation: quatNormalize(quatFromAxisAngle(1, 0, 0, degToRad(-5))),
        interpolation: makeLandingInterp(true),
      });
    }
  }
  return frames;
}

// ---- 主流程 ----
const outDirGame = join(__dirname, "..", "frontend", "src", "game", "motions");
const outDirDist = join(__dirname, "..", "frontend", "dist", "motions");

mkdirSync(outDirGame, { recursive: true });
mkdirSync(outDirDist, { recursive: true });

const modelName = "CityGirl";

const idleFrames = generateIdle();
const walkFrames = generateWalk();
const stompFrames = generateStomp();

writeVMD(join(outDirGame, "idle.vmd"), modelName, idleFrames);
writeVMD(join(outDirGame, "walk.vmd"), modelName, walkFrames);
writeVMD(join(outDirGame, "stomp.vmd"), modelName, stompFrames);

writeVMD(join(outDirDist, "idle.vmd"), modelName, idleFrames);
writeVMD(join(outDirDist, "walk.vmd"), modelName, walkFrames);
writeVMD(join(outDirDist, "stomp.vmd"), modelName, stompFrames);

// ---- 自检 ----
function selfCheck() {
  console.log("\n[gen-motion] 自检回读断言...");
  // 简单检查：帧数、骨名集合、四元数模长、帧号单调、首尾闭合
  function check(frames, name) {
    const boneSet = new Set(frames.map(f => f.boneName));
    console.log(`  ${name}: 帧=${frames.length} 骨=${[...boneSet].join(",")}`);
    for (const bf of frames) {
      const q = bf.rotation;
      const len = Math.hypot(...q);
      if (Math.abs(len - 1) > 1e-3) throw new Error(`${name} 四元数模长 ${len} 非1 在 ${bf.boneName} ${bf.frameNumber}`);
    }
    // 帧号单调（按骨分组检查）
    const byBone = {};
    for (const bf of frames) {
      if (!byBone[bf.boneName]) byBone[bf.boneName] = [];
      byBone[bf.boneName].push(bf.frameNumber);
    }
    for (const bone in byBone) {
      const arr = byBone[bone].slice().sort((a, b) => a - b);
      for (let i = 1; i < arr.length; i++) {
        if (arr[i] < arr[i - 1]) throw new Error(`${name} ${bone} 帧号非单调`);
      }
      // 首尾闭合误差
      if (arr.includes(0) && arr.includes(bone === "walk" ? 60 : 90)) {
        const first = frames.find(f => f.boneName === bone && f.frameNumber === 0);
        const last = frames.find(f => f.boneName === bone && f.frameNumber === (name === "walk" ? 60 : 90));
        if (first && last) {
          const dp = Math.hypot(first.position[0] - last.position[0], first.position[1] - last.position[1], first.position[2] - last.position[2]);
          if (dp > 1e-3) console.warn(`  ${name} ${bone} 首尾位置不闭合 dp=${dp}`);
        }
      }
    }
    console.log(`  ${name} 自检 OK`);
  }
  check(idleFrames, "idle");
  check(walkFrames, "walk");
  check(stompFrames, "stomp");

  // ASCII 预览
  console.log("\n[gen-motion] ASCII 骨架预览 (walk 双脚 Z/Y):");
  for (let f = 0; f <= 60; f += 10) {
    const lf = walkFrames.find(b => b.boneName === "左足ＩＫ" && b.frameNumber === f);
    const rf = walkFrames.find(b => b.boneName === "右足ＩＫ" && b.frameNumber === f);
    console.log(`  f=${String(f).padStart(2)}  L(z=${lf.position[2].toFixed(2)} y=${lf.position[1].toFixed(2)})  R(z=${rf.position[2].toFixed(2)} y=${rf.position[1].toFixed(2)})`);
  }
}

selfCheck();
console.log("\n[gen-motion] 完成");

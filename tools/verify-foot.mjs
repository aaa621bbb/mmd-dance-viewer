import fs from "fs";
import zlib from "zlib";

// 读取 VMD 并提取脚 Y
function readVMD(path) {
  const buf = fs.readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let off = 0;
  const sig = new TextDecoder().decode(buf.subarray(0, 30));
  off = 30;
  const modelName = buf.subarray(off, off + 20);
  off += 20;
  const boneCount = dv.getUint32(off, true); off += 4;
  const bones = [];
  for (let i = 0; i < boneCount; i++) {
    const nameBytes = buf.subarray(off, off + 15); off += 15;
    // decode SJIS? We'll just keep raw
    const frame = dv.getUint32(off, true); off += 4;
    const x = dv.getFloat32(off, true); off += 4;
    const y = dv.getFloat32(off, true); off += 4;
    const z = dv.getFloat32(off, true); off += 4;
    const qx = dv.getFloat32(off, true); off += 4;
    const qy = dv.getFloat32(off, true); off += 4;
    const qz = dv.getFloat32(off, true); off += 4;
    const qw = dv.getFloat32(off, true); off += 4;
    off += 64; // interp
    bones.push({ nameBytes, frame, x, y, z, qx, qy, qz, qw });
  }
  return { sig, boneCount, bones };
}

function decodeSJIS(bytes) {
  try {
    return new TextDecoder("shift_jis").decode(bytes).replace(/\0.*$/, "");
  } catch (e) {
    return new TextDecoder().decode(bytes).replace(/\0.*$/, "");
  }
}

const vmd = readVMD("frontend/src/game/motions/walk.vmd");
console.log(`walk VMD bones=${vmd.boneCount}`);
const byBone = {};
for (const b of vmd.bones) {
  const name = decodeSJIS(b.nameBytes);
  if (!byBone[name]) byBone[name] = [];
  byBone[name].push(b);
}
for (const name of Object.keys(byBone)) {
  byBone[name].sort((a, b) => a.frame - b.frame);
  console.log(`  ${name}: ${byBone[name].length} frames`);
}

const left = byBone["左足ＩＫ"] || [];
const right = byBone["右足ＩＫ"] || [];

console.log("Left foot Y:");
for (const f of left) console.log(`  f=${f.frame} y=${f.y.toFixed(2)} z=${f.z.toFixed(2)}`);
console.log("Right foot Y:");
for (const f of right) console.log(`  f=${f.frame} y=${f.y.toFixed(2)} z=${f.z.toFixed(2)}`);

// 生成 PNG: 600x200, 白底，红=左脚Y，蓝=右脚Y
const W = 600, H = 200;
const data = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) {
  data[i * 4 + 0] = 255;
  data[i * 4 + 1] = 255;
  data[i * 4 + 2] = 255;
  data[i * 4 + 3] = 255;
}

function setPixel(x, y, r, g, b) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const idx = (y * W + x) * 4;
  data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255;
}

function drawLine(x0, y0, x1, y1, r, g, b) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    setPixel(Math.round(x0 + dx * t), Math.round(y0 + dy * t), r, g, b);
  }
}

// 归一化
const maxFrame = 60;
const maxY = 2;
function mapX(frame) { return Math.round((frame / maxFrame) * (W - 20) + 10); }
function mapY(y) { return Math.round(H - 10 - (y / maxY) * (H - 20)); }

// 网格
for (let x = 0; x < W; x += 50) for (let y = 0; y < H; y++) setPixel(x, y, 230, 230, 230);
for (let y = 0; y < H; y += 40) for (let x = 0; x < W; x++) setPixel(x, y, 230, 230, 230);

// 绘制
for (let i = 1; i < left.length; i++) {
  const a = left[i - 1], b = left[i];
  drawLine(mapX(a.frame), mapY(a.y), mapX(b.frame), mapY(b.y), 255, 0, 0);
}
for (let i = 1; i < right.length; i++) {
  const a = right[i - 1], b = right[i];
  drawLine(mapX(a.frame), mapY(a.y), mapX(b.frame), mapY(b.y), 0, 0, 255);
}

// PNG 编码
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
    crc32.table = table;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4);
  const combined = Buffer.concat([t, data]);
  crc.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, t, data, crc]);
}

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const ihdrChunk = chunk("IHDR", ihdr);

const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0; // filter
  for (let x = 0; x < W; x++) {
    const srcIdx = (y * W + x) * 4;
    const dstIdx = y * (W * 4 + 1) + 1 + x * 4;
    raw[dstIdx] = data[srcIdx];
    raw[dstIdx + 1] = data[srcIdx + 1];
    raw[dstIdx + 2] = data[srcIdx + 2];
    raw[dstIdx + 3] = data[srcIdx + 3];
  }
}
const compressed = zlib.deflateSync(raw);
const idatChunk = chunk("IDAT", compressed);
const iendChunk = chunk("IEND", Buffer.alloc(0));

const png = Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
fs.writeFileSync("tools/foot-y.png", png);
console.log("wrote tools/foot-y.png");

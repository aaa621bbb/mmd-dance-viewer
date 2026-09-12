#!/usr/bin/env node
// tools/dump-atlas.mjs — 把 atlas 存成 PNG，16格标号

import fs from "fs";
import { createCanvas } from "canvas"; // 可能没有 canvas 库，降级用纯 JS
// 尝试动态 import
let buildAtlasTexture;
try {
  // 由于 atlas.js 依赖 Babylon 全局，我们 mock
  globalThis.window = { BABYLON: {} };
  globalThis.document = { createElement: () => createCanvas(1024, 1024) };
  const mod = await import("../frontend/src/game/atlas.js");
  buildAtlasTexture = mod.buildAtlasTexture;
} catch (e) {
  console.error("需要 canvas 库或在浏览器环境运行", e);
  process.exit(1);
}

const canvas = createCanvas(1024, 1024);
buildAtlasTexture(canvas, 1024, 4);
const out = fs.createWriteStream("atlas_dump.png");
const stream = canvas.createPNGStream();
stream.pipe(out);
out.on("finish", () => console.log("wrote atlas_dump.png"));

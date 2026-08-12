// deploy-to-apk.mjs
// 把 frontend 构建产物(dist/) 同步到 Android APK assets(dist/)。
// 用法: 先 node build.mjs 构建出 dist/, 再 node deploy-to-apk.mjs
// 这样改 src/main.js -> node build.mjs -> 覆盖到 assets/dist -> 打包 APK
import { copyFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));          // frontend/
const src = join(here, "dist");
const dst = join(here, "..", "app", "src", "main", "assets", "dist");

if (!existsSync(src)) {
  console.error("请先运行 node build.mjs 生成 frontend/dist/");
  process.exit(1);
}

// 清掉旧的 dist 覆盖物, 再拷贝新的(避免残留文件)
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });

copyFileSync(join(src, "main.js"), join(dst, "main.js"));
console.log("deployed main.js -> app/src/main/assets/dist/main.js");

// index_bg.wasm 若存在也一并部署
if (existsSync(join(src, "index_bg.wasm"))) {
  copyFileSync(join(src, "index_bg.wasm"), join(dst, "index_bg.wasm"));
  console.log("deployed index_bg.wasm -> app/src/main/assets/dist/index_bg.wasm");
}

console.log("done");

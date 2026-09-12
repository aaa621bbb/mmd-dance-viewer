// deploy-to-apk.mjs
// 把 frontend 构建产物(dist/) 同步到 Android APK assets(dist/)。
import { copyFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "dist");
const dst = join(here, "..", "app", "src", "main", "assets", "dist");

if (!existsSync(src)) {
  console.error("请先运行 node build.mjs 生成 frontend/dist/");
  process.exit(1);
}

rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });

function copyRecursive(s, d) {
  mkdirSync(d, { recursive: true });
  for (const entry of readdirSync(s)) {
    const sp = join(s, entry);
    const dp = join(d, entry);
    const stat = statSync(sp);
    if (stat.isDirectory()) copyRecursive(sp, dp);
    else copyFileSync(sp, dp);
  }
}

copyRecursive(src, dst);
console.log("deployed dist -> app/src/main/assets/dist/");

// 同步 index.html
try {
  const srcHtml = join(here, "..", "app", "src", "main", "assets", "index.html");
  // 已经是源文件，不需要拷贝，但确保存在
  if (existsSync(srcHtml)) console.log("index.html exists");
} catch (e) {}

console.log("done");

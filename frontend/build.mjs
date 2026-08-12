// esbuild 打包: src/main.js -> dist/main.js + 资源(wasm)
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  outdir: "dist",
  outbase: "src",
  format: "esm",
  target: "es2020",
  platform: "browser",
  sourcemap: false,
  minify: false,
  logLevel: "info",
  loader: {
    ".wasm": "file",
    ".png": "file",
    ".jpg": "file",
    ".bin": "file",
  },
  assetNames: "assets/[name]-[hash]",
  define: {},
});

// babylon-mmd 单线程 SPR 物理运行时通过 `new URL('index_bg.wasm', import.meta.url)`
// 动态加载 wasm —— esbuild 不会自动复制这个文件, 需手动拷到 dist/ 与 main.js 同目录。
// (源: node_modules/babylon-mmd/esm/Runtime/Optimized/wasm/spr/index_bg.wasm)
try {
  const src = join(
    "node_modules/babylon-mmd/esm/Runtime/Optimized/wasm/spr/index_bg.wasm"
  );
  const dstDir = join("dist");
  mkdirSync(dstDir, { recursive: true });
  copyFileSync(src, join(dstDir, "index_bg.wasm"));
  console.log("copied index_bg.wasm -> dist/index_bg.wasm");
} catch (e) {
  console.error("WARN could not copy index_bg.wasm:", e.message);
}

console.log("done");

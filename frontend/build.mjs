// esbuild 打包: src/main.js -> dist/main.js + 资源(wasm)
// 支持 --target=android (默认) 和 --target=pc
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
let target = "android";
for (const a of args) {
  if (a.startsWith("--target=")) target = a.split("=")[1];
  if (a === "pc" || a === "android") target = a;
}

const outdir = target === "pc" ? "dist-pc" : "dist";
const isPC = target === "pc";

console.log(`building target=${target} outdir=${outdir} isPC=${isPC}`);

await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  outdir,
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
    ".vmd": "file",
  },
  assetNames: "assets/[name]-[hash]",
  define: {
    IS_PC: isPC ? "true" : "false",
    GAME_TARGET: `"${target}"`,
  },
});

try {
  const src = join("node_modules/babylon-mmd/esm/Runtime/Optimized/wasm/spr/index_bg.wasm");
  mkdirSync(outdir, { recursive: true });
  copyFileSync(src, join(outdir, "index_bg.wasm"));
  console.log(`copied index_bg.wasm -> ${outdir}/index_bg.wasm`);
} catch (e) {
  console.error("WARN could not copy index_bg.wasm:", e.message);
}

try {
  const srcDir = "src/game/motions";
  const dstDir = join(outdir, "motions");
  mkdirSync(dstDir, { recursive: true });
  if (existsSync(srcDir)) {
    for (const f of readdirSync(srcDir)) {
      copyFileSync(join(srcDir, f), join(dstDir, f));
      console.log(`copied ${join(srcDir, f)} -> ${join(dstDir, f)}`);
    }
  }
  const dst2 = join(outdir, "game/motions");
  mkdirSync(dst2, { recursive: true });
  if (existsSync(srcDir)) {
    for (const f of readdirSync(srcDir)) {
      copyFileSync(join(srcDir, f), join(dst2, f));
    }
  }
} catch (e) {
  console.error("copy motions fail", e.message);
}

console.log(`done target=${target}`);

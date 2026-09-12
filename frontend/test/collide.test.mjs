// test/collide.test.mjs — 碰撞系统 10 条单测，node --test
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CFG, WORLD } from "../src/game/config.js";
import { u } from "../src/game/scale.js";
import * as collide from "../src/game/collide.js";

const R = WORLD.RADIUS;
const H = WORLD.HEIGHT;
const SKIN = WORLD.SKIN;
const STEP_MAX = WORLD.STEP_MAX;

function makeWall(x, z, w, h, d, kind = "build") {
  // w,d 是 XZ 尺寸，h 是 Y 高
  return {
    minX: x - w / 2,
    maxX: x + w / 2,
    minY: 0,
    maxY: h,
    minZ: z - d / 2,
    maxZ: z + d / 2,
    kind,
  };
}

describe("collide.js — 格网哈希 + AABB 世界", () => {
  beforeEach(() => {
    collide.clearWorld();
    collide.resetMoveState();
    // 地面
    collide.addBox({ minX: -100, maxX: 100, minY: -1, maxY: 0, minZ: -100, maxZ: 100, kind: "ground" });
  });

  it("1. 正冲一面墙 100 帧 — 停在墙前 R+SKIN 内，不穿墙，无抖动", () => {
    // 墙在 x=2
    collide.addBox(makeWall(2, 0, 0.5, 2, 10));
    let pos = { x: 0, y: 0, z: 0 };
    const disp = { x: u(0.5), z: 0 }; // 每帧 0.5 PH 向 +X
    let lastX = pos.x;
    let maxJitterAfterHit = 0;
    let hit = false;
    for (let i = 0; i < 100; i++) {
      const newPos = collide.move(pos, disp, 0.016);
      // 不穿墙：x + R <= 墙 minX + SKIN
      const wallMinX = 2 - 0.25;
      assert.ok(newPos.x + R <= wallMinX + SKIN + 0.01, `穿墙: x=${newPos.x} R=${R} wallMin=${wallMinX}`);
      const jitter = Math.abs(newPos.x - lastX);
      // 检测是否已撞墙（位移变 0）
      if (hit) {
        maxJitterAfterHit = Math.max(maxJitterAfterHit, jitter);
      }
      if (jitter < 1e-6) hit = true;
      lastX = newPos.x;
      pos = newPos;
    }
    // 停在墙前
    const expected = (2 - 0.25) - R - SKIN;
    assert.ok(Math.abs(pos.x - expected) < 0.05, `未停在墙前: x=${pos.x} expected~${expected}`);
    assert.ok(maxJitterAfterHit < u(0.05), `撞墙后抖动过大: ${maxJitterAfterHit}`);
  });

  it("2. 斜 45° 冲墙 — 沿墙滑动，切向位移 ≥80%", () => {
    collide.addBox(makeWall(2, 0, 0.5, 2, 20));
    let pos = { x: 0, y: 0, z: 0 };
    const disp = { x: u(0.5), z: u(0.5) }; // 45°
    let totalTangential = 0;
    let total = 0;
    for (let i = 0; i < 60; i++) {
      const prev = { ...pos };
      pos = collide.move(pos, disp, 0.016);
      const dx = pos.x - prev.x;
      const dz = pos.z - prev.z;
      total += Math.hypot(dx, dz);
      // 切向是 Z 方向（沿墙）
      totalTangential += Math.abs(dz);
    }
    // 被墙挡住后，X 方向应接近 0，Z 方向应保留
    // 总位移中切向占比应 ≥80% 的直线位移？简化：最后阶段 Z 位移应持续
    assert.ok(totalTangential > 0, "无切向位移");
    // 计算被挡住后的切向保留：总 Z 位移 / 总直线位移(若无墙) ≈ 0.707，保留 ≥80% 意味着 Z 位移接近无墙时的 Z
    // 无墙时 60 帧 Z 位移 = 60*0.5PH =30PH 世界单位
    const expectedZ = 60 * u(0.5);
    const ratio = totalTangential / expectedZ;
    assert.ok(ratio >= 0.8, `切向保留不足: ${ratio} <0.8, tangential=${totalTangential} expectedZ=${expectedZ}`);
  });

  it("3. 冲 0.094 PH 台阶 — 能上去，y 正确抬升", () => {
    const curbH = WORLD.CURB_H; // 0.094 PH 世界单位
    // 台阶在 x=1~2，高度 curbH
    collide.addBox({ minX: 1, maxX: 3, minY: 0, maxY: curbH, minZ: -5, maxZ: 5, kind: "curb" });
    let pos = { x: 0, y: 0, z: 0 };
    const disp = { x: u(0.5), z: 0 }; // 加大步伐，确保能到达
    let wentUp = false;
    for (let i = 0; i < 120; i++) {
      pos = collide.move(pos, disp, 0.016);
      if (pos.y > curbH * 0.5) wentUp = true;
    }
    assert.ok(wentUp, `未能上台阶: y=${pos.y} curbH=${curbH} finalX=${pos.x}`);
    assert.ok(Math.abs(pos.y - curbH) < 0.01, `y 未正确抬升: y=${pos.y} curbH=${curbH}`);
  });

  it("4. 冲 0.4 PH 高的墙 — 上不去，被挡住", () => {
    const high = u(0.4);
    collide.addBox({ minX: 1, maxX: 3, minY: 0, maxY: high, minZ: -5, maxZ: 5, kind: "build" });
    let pos = { x: 0, y: 0, z: 0 };
    const disp = { x: u(0.3), z: 0 };
    for (let i = 0; i < 20; i++) {
      pos = collide.move(pos, disp, 0.016);
    }
    // 应该被挡在墙前，x <1 - R
    assert.ok(pos.x + R <= 1 + 0.01, `不应越过高墙: x=${pos.x} R=${R}`);
    assert.ok(pos.y === 0, `不应抬升: y=${pos.y}`);
  });

  it("5. 凹角内左右推 300 帧 — 不抖动", () => {
    // 两面墙形成凹角：墙A x=2, 墙B z=2
    collide.addBox(makeWall(2, 0, 0.5, 2, 10));
    collide.addBox(makeWall(0, 2, 10, 2, 0.5));
    let pos = { x: 0, y: 0, z: 0 };
    let maxDeltaAfterHit = 0;
    let hit = false;
    let lastPos = { ...pos };
    for (let i = 0; i < 300; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const disp = { x: u(0.2) * dir, z: u(0.2) * dir };
      const prev = { ...pos };
      pos = collide.move(pos, disp, 0.016);
      const d = Math.hypot(pos.x - prev.x, pos.z - prev.z);
      // 检测是否已进入凹角卡住区域（位移变小）
      if (hit) {
        maxDeltaAfterHit = Math.max(maxDeltaAfterHit, d);
      }
      // 若连续几次位移都很小，认为已卡在角落
      if (d < u(0.01)) hit = true;
      lastPos = { ...pos };
    }
    // 卡住后抖动应 <0.05 PH
    assert.ok(maxDeltaAfterHit < u(0.05) + 0.01, `凹角抖动过大: maxDelta=${maxDeltaAfterHit} 阈值=${u(0.05)}`);
  });

  it("6. 绕街角走一圈 600 帧 — 位置连续，无跳变 >0.2 PH", () => {
    // 模拟街角：一个建筑在 (2,2)
    collide.addBox(makeWall(2, 2, 1.5, 2, 1.5));
    let pos = { x: 0, y: 0, z: 0 };
    let maxJump = 0;
    let last = { ...pos };
    // 绕圈路径：先 +X 100帧，再 +Z 100，再 -X 100，再 -Z 100，再重复
    const steps = [
      { x: u(0.2), z: 0 },
      { x: 0, z: u(0.2) },
      { x: -u(0.2), z: 0 },
      { x: 0, z: -u(0.2) },
    ];
    for (let i = 0; i < 600; i++) {
      const phase = Math.floor(i / 150) % 4;
      const disp = steps[phase];
      pos = collide.move(pos, disp, 0.016);
      const jump = Math.hypot(pos.x - last.x, pos.z - last.z);
      maxJump = Math.max(maxJump, jump);
      last = { ...pos };
    }
    assert.ok(maxJump <= u(0.2) + 0.001, `跳变过大: ${maxJump} > ${u(0.2)}`);
  });

  it("7. 楼顶走到边沿 — 平滑转为下落并落地", () => {
    const roofH = u(5);
    collide.addBox({ minX: -2, maxX: 2, minY: 0, maxY: roofH, minZ: -2, maxZ: 2, kind: "build" });
    let pos = { x: 0, y: roofH, z: 0 }; // 站在楼顶
    collide.setVy(0);
    // 向外走，需要走出屋顶：屋顶半宽 2，半径 0.016，需要走到 2.016 之外，步长 0.3PH=0.016，约 126 帧
    const disp = { x: u(0.5), z: 0 };
    let fell = false;
    let landed = false;
    for (let i = 0; i < 300; i++) {
      pos = collide.move(pos, disp, 0.016);
      if (pos.y < roofH - 0.01) fell = true;
      if (fell && Math.abs(pos.y) < 0.001) landed = true;
    }
    assert.ok(fell, `未从楼顶掉落: y=${pos.y} x=${pos.x}`);
    assert.ok(landed, `未落地: y=${pos.y} x=${pos.x}`);
  });

  it("8. 随机游走 100000 步 — 永远在边界内，从不进入 AABB", () => {
    // 城市边界墙
    const half = 10;
    collide.addBox({ minX: -half, maxX: -half + 0.5, minY: 0, maxY: 5, minZ: -half, maxZ: half, kind: "wall" });
    collide.addBox({ minX: half - 0.5, maxX: half, minY: 0, maxY: 5, minZ: -half, maxZ: half, kind: "wall" });
    collide.addBox({ minX: -half, maxX: half, minY: 0, maxY: 5, minZ: -half, maxZ: -half + 0.5, kind: "wall" });
    collide.addBox({ minX: -half, maxX: half, minY: 0, maxY: 5, minZ: half - 0.5, maxZ: half, kind: "wall" });
    // 随机建筑
    const rng = () => Math.random();
    for (let i = 0; i < 20; i++) {
      const x = (rng() - 0.5) * 15;
      const z = (rng() - 0.5) * 15;
      const w = 1 + rng() * 2;
      const d = 1 + rng() * 2;
      collide.addBox({ minX: x - w / 2, maxX: x + w / 2, minY: 0, maxY: 2, minZ: z - d / 2, maxZ: z + d / 2, kind: "build" });
    }
    let pos = { x: 0, y: 0, z: 0 };
    collide.resetMoveState();
    for (let i = 0; i < 100000; i++) {
      const ang = Math.random() * Math.PI * 2;
      const mag = u(0.2);
      const disp = { x: Math.cos(ang) * mag, z: Math.sin(ang) * mag };
      const newPos = collide.move(pos, disp, 0.016);
      // 检查是否在边界内
      assert.ok(newPos.x >= -half - 0.01 && newPos.x <= half + 0.01, `出界 x=${newPos.x}`);
      assert.ok(newPos.z >= -half - 0.01 && newPos.z <= half + 0.01, `出界 z=${newPos.z}`);
      // 检查是否进入 AABB
      const inside = collide.insideAnyBox(newPos, R * 0.9);
      assert.ok(!inside, `进入 AABB 内部: pos=${JSON.stringify(newPos)} step=${i}`);
      pos = newPos;
    }
  });

  it("9. 冲城市边界 — 被挡住，不穿出", () => {
    const half = 5;
    collide.addBox({ minX: half, maxX: half + 1, minY: 0, maxY: 5, minZ: -10, maxZ: 10, kind: "wall" });
    let pos = { x: 0, y: 0, z: 0 };
    const disp = { x: u(1), z: 0 };
    for (let i = 0; i < 20; i++) {
      pos = collide.move(pos, disp, 0.016);
    }
    assert.ok(pos.x + R <= half + 0.01, `穿出边界: x=${pos.x} R=${R} half=${half}`);
  });

  it("10. clearWorld() 后 — 世界为空、内存释放", () => {
    collide.addBox(makeWall(1, 0, 1, 1, 1));
    collide.addBox(makeWall(2, 0, 1, 1, 1));
    assert.ok(collide.getBoxes().length > 0);
    collide.clearWorld();
    assert.equal(collide.getBoxes().length, 0);
    // query 应返回空
    const q = collide.query(0, 0);
    assert.equal(q.length, 0);
  });
});

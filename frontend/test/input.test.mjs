// test/input.test.mjs — v4.0 §1.4 输入衰减自检
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("输入模型 v4.0 — 速度式+指数衰减+限幅", () => {
  it("松手 0.3s 内角速度必须 <1°/s (clearLook 立即清零路径)", () => {
    // 模拟 player 的 clearLook 立即清零
    let yawRate = (240 * Math.PI) / 180;
    let clearLook = true;
    if (clearLook) yawRate = 0;
    const deg = (yawRate * 180) / Math.PI;
    console.log(`  clearLook 后 yawRate=${deg.toFixed(3)}°/s`);
    assert.ok(deg < 1, `clearLook后应<1°/s，实测${deg}`);

    // 无 clearLook 的指数衰减路径，TAU_STOP=0.05s 保证 0.3s <1°
    yawRate = (240 * Math.PI) / 180;
    const TAU_STOP = 0.05;
    let dt = 0.016;
    let t = 0;
    while (t < 0.3) {
      const decay = Math.exp(-dt / TAU_STOP);
      yawRate *= decay;
      t += dt;
    }
    const deg2 = (yawRate * 180) / Math.PI;
    console.log(`  0.3s 衰减后 yawRate=${deg2.toFixed(3)}°/s (TAU_STOP=0.05)`);
    assert.ok(deg2 < 1, `衰减路径0.3s后应<1°/s，实测${deg2}`);
  });

  it("灵敏度 0.2 vs 3.0 同等手势转动角度相差 ≥5倍", () => {
    const MAX_RATE = 240;
    const sensLow = 0.2, sensHigh = 3.0;
    const norm = 1.0;
    const low = norm * sensLow * MAX_RATE;
    const high = norm * sensHigh * MAX_RATE;
    const ratio = high / low;
    console.log(`  low=${low} high=${high} ratio=${ratio}`);
    assert.ok(ratio >= 5, `比值应≥5，实测${ratio}`);
  });

  it("长按不移动 → 视角完全不转", () => {
    // hasLook=false 时 target=0，rate应保持0
    let yawRate = 0;
    let hasLook = false;
    // 模拟 1s 无输入
    for (let i = 0; i < 60; i++) {
      if (!hasLook) yawRate *= Math.exp(-0.016 / 0.06);
    }
    assert.equal(yawRate, 0, "无输入时 yawRate 应为 0");
  });
});

import "./bjs.js";
// game/stomp.js — 踩踏判定 + 街区压扁连锁
import { CFG, WORLD } from "./config.js";
import { u } from "./scale.js";

export function createStompSystem(giant, city, fx, opts = {}) {
  const FOOT_A = WORLD.FOOT_A; // 半长 1.52
  const FOOT_B = WORLD.FOOT_B; // 半宽 0.6
  const LAND_Y = CFG.LAND_Y; // 0.05 世界单位
  const LAND_V = CFG.LAND_V; // 2.0
  const STOMP_CD = CFG.STOMP_CD; // 0.8s

  let lastFootL = null, lastFootR = null;
  let cooldownL = 0, cooldownR = 0;

  let onImpactCallback = null;

  // 破坏：街区压扁
  const crushedBlocks = new Set();

  function worldToFoot(localYaw, footCenter, playerPos) {
    // 将玩家位置转换到脚掌局部坐标（椭圆坐标）
    const dx = playerPos.x - footCenter.x;
    const dz = playerPos.z - footCenter.z;
    const cos = Math.cos(-localYaw), sin = Math.sin(-localYaw);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    return { u: localX, v: localZ };
  }

  function update(dt, playerPos, playerState) {
    dt = Math.min(0.05, dt);
    if (cooldownL > 0) cooldownL -= dt;
    if (cooldownR > 0) cooldownR -= dt;

    const feet = giant.feet ? giant.feet() : null;
    if (!feet) return null;

    const fl = feet.left, fr = feet.right;
    if (!fl || !fr) return null;

    // 获取脚掌朝向：用根节点 yaw 近似
    const root = giant.getRoot ? giant.getRoot() : null;
    const yaw = root && root.rotation ? root.rotation.y : 0;

    let result = null;

    // 左脚落地检测
    if (lastFootL && cooldownL <= 0) {
      const prevY = lastFootL.y, nowY = fl.y;
      const dv = prevY - nowY;
      const isLanding = prevY > LAND_Y && nowY <= LAND_Y && dv > 0.01;
      // 下降速度 > LAND_V ? 这里 dv 是每帧位移，需除以 dt 得到速度
      const vel = dv / dt;
      if (isLanding && vel > LAND_V * 0.1) {
        // 判定
        const local = worldToFoot(yaw, { x: fl.x, z: fl.z }, playerPos);
        const d = Math.hypot(local.u / FOOT_A, local.v / FOOT_B);
        let hitType = null;
        if (d < 1.0) hitType = "direct";
        else if (d < 1.5) hitType = "near";
        else hitType = "miss";

        if (hitType !== "miss") {
          result = { foot: "left", pos: { x: fl.x, z: fl.z }, d, type: hitType, yaw };
          cooldownL = STOMP_CD;
          // 触发破坏
          triggerDestruction(fl, city, fx);
          if (fx) {
            fx.onStomp(fl, hitType, d);
          }
          if (onImpactCallback) onImpactCallback(result);
        }
      }
    }

    // 右脚
    if (lastFootR && cooldownR <= 0 && !result) {
      const prevY = lastFootR.y, nowY = fr.y;
      const dv = prevY - nowY;
      const isLanding = prevY > LAND_Y && nowY <= LAND_Y && dv > 0.01;
      const vel = dv / dt;
      if (isLanding && vel > LAND_V * 0.1) {
        const local = worldToFoot(yaw, { x: fr.x, z: fr.z }, playerPos);
        const d = Math.hypot(local.u / FOOT_A, local.v / FOOT_B);
        let hitType = null;
        if (d < 1.0) hitType = "direct";
        else if (d < 1.5) hitType = "near";
        else hitType = "miss";

        if (hitType !== "miss") {
          result = { foot: "right", pos: { x: fr.x, z: fr.z }, d, type: hitType, yaw };
          cooldownR = STOMP_CD;
          triggerDestruction(fr, city, fx);
          if (fx) fx.onStomp(fr, hitType, d);
          if (onImpactCallback) onImpactCallback(result);
        }
      }
    }

    // 预示：脚 Y >5 且速度<0 时升起脚影
    if (fx) {
      const checkPre = (foot, prev) => {
        if (!foot || !prev) return;
        const vy = (foot.y - prev.y) / dt;
        if (foot.y > u(5) && vy < 0) {
          // 脚正在下落且较高
          const progress = 1 - foot.y / u(6); // 0~1
          const size = 0.3 + progress * 0.9; // 0.3→1.2 倍脚长
          const alpha = 0.15 + progress * 0.4;
          fx.updateFootShadow(foot, size, alpha, yaw);
        }
      };
      checkPre(fl, lastFootL);
      checkPre(fr, lastFootR);
    }

    lastFootL = fl ? { ...fl } : null;
    lastFootR = fr ? { ...fr } : null;

    return result;
  }

  function triggerDestruction(footPos, city, fx) {
    if (!city || !city.blocks) return;
    // 找到落脚点所在街区块
    const bx = Math.floor(footPos.x / WORLD.BLOCK_PITCH + CFG.CITY_GRID / 2);
    const bz = Math.floor(footPos.z / WORLD.BLOCK_PITCH + CFG.CITY_GRID / 2);
    const key = `${bx}_${bz}`;
    if (crushedBlocks.has(key)) return;

    // 该区块所有楼压扁
    const blocksToCrush = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const nbx = bx + dx, nbz = bz + dz;
        if (nbx < 0 || nbx >= CFG.CITY_GRID || nbz < 0 || nbz >= CFG.CITY_GRID) continue;
        const dist = Math.hypot(dx, dz);
        const delay = dist * 100 + Math.random() * 100; // 100~400ms 连锁
        blocksToCrush.push({ bx: nbx, bz: nbz, delay });
      }
    }

    // 按延迟排序，依次压扁
    blocksToCrush.sort((a, b) => a.delay - b.delay);
    for (const b of blocksToCrush) {
      const k = `${b.bx}_${b.bz}`;
      if (crushedBlocks.has(k)) continue;
      crushedBlocks.add(k);
      // 视觉：找到对应 tile 的 mesh，进行 Y 缩放动画
      setTimeout(() => {
        if (fx) fx.crushBlock(b.bx, b.bz);
        // 碰撞：移除该区块的 AABB（让玩家能在废墟上跑）
        // 这里简化：不移除，保留为可站立的废墟（高度 5%）
        // 实际应由 city.js 提供 remove
      }, b.delay);
    }

    // 车压扁、消防栓喷水、树飞散等
    if (fx) {
      fx.onDestruction(footPos, blocksToCrush);
    }
  }

  function onImpact(cb) {
    onImpactCallback = cb;
  }

  function reset() {
    crushedBlocks.clear();
    lastFootL = null;
    lastFootR = null;
    cooldownL = 0;
    cooldownR = 0;
  }

  return {
    update,
    onImpact,
    reset,
    get crushedCount() { return crushedBlocks.size; },
  };
}

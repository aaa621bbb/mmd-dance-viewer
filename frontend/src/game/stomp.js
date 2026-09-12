import "./bjs.js";
// game/stomp.js — 踩踏判定 + 落脚预清空 + 卡住自救 + 街区压扁连锁 v4.0 §6
import { CFG, WORLD } from "./config.js";
import { u } from "./scale.js";
import { removeBoxesInRadius } from "./collide.js";

export function createStompSystem(giant, city, fx, opts = {}) {
  const FOOT_A = WORLD.FOOT_A;
  const FOOT_B = WORLD.FOOT_B;
  const LAND_Y = CFG.LAND_Y;
  const STOMP_CD = CFG.STOMP_CD;

  let lastFootL = null, lastFootR = null;
  let cooldownL = 0, cooldownR = 0;
  let onImpactCallback = null;
  const crushedBlocks = new Set();

  // 预测与自救
  let predictTimer = 0;
  let stuckTimer = 0;
  let lastRootPos = null;
  let stuckHistory = []; // {t, x, z}
  let preCleared = new Set(); // 已预清空的块

  function worldToFoot(localYaw, footCenter, playerPos) {
    const dx = playerPos.x - footCenter.x;
    const dz = playerPos.z - footCenter.z;
    const cos = Math.cos(-localYaw), sin = Math.sin(-localYaw);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    return { u: localX, v: localZ };
  }

  function triggerDestruction(footPos, city, fx) {
    if (!city || !city.blocks) return;
    const bx = Math.floor(footPos.x / WORLD.BLOCK_PITCH + CFG.CITY_GRID / 2);
    const bz = Math.floor(footPos.z / WORLD.BLOCK_PITCH + CFG.CITY_GRID / 2);
    const key = `${bx}_${bz}`;
    if (crushedBlocks.has(key)) return;
    const blocksToCrush = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const nbx = bx + dx, nbz = bz + dz;
        if (nbx < 0 || nbx >= CFG.CITY_GRID || nbz < 0 || nbz >= CFG.CITY_GRID) continue;
        const dist = Math.hypot(dx, dz);
        const delay = dist * 100 + Math.random() * 100;
        blocksToCrush.push({ bx: nbx, bz: nbz, delay });
      }
    }
    blocksToCrush.sort((a, b) => a.delay - b.delay);
    for (const b of blocksToCrush) {
      const k = `${b.bx}_${b.bz}`;
      if (crushedBlocks.has(k)) continue;
      crushedBlocks.add(k);
      setTimeout(() => {
        if (fx) fx.crushBlock(b.bx, b.bz);
      }, b.delay);
    }
    if (fx) fx.onDestruction(footPos, blocksToCrush);
  }

  // 预清空：落脚窗口内的楼 0.8s前下沉压扁Y 5% 200ms隐藏+AABB移除
  function preClearAt(x, z, radius = u(3)) {
    // 移除碰撞
    const removed = removeBoxesInRadius(x, z, radius, ["build", "furn", "car"]);
    if (removed > 0) {
      // 视觉：触发灰尘
      if (fx && fx.spawnDust) {
        try { fx.spawnDust({ x, z }, radius); } catch (e) {}
      }
      // 街区压扁
      const bx = Math.floor(x / WORLD.BLOCK_PITCH + CFG.CITY_GRID / 2);
      const bz = Math.floor(z / WORLD.BLOCK_PITCH + CFG.CITY_GRID / 2);
      const key = `${bx}_${bz}`;
      if (!preCleared.has(key)) {
        preCleared.add(key);
        crushedBlocks.add(key);
        if (fx) {
          // 200ms 压扁动画
          setTimeout(() => { try { fx.crushBlock(bx, bz); } catch (e) {} }, 0);
        }
      }
    }
    return removed;
  }

  function predictFootWindows() {
    if (!giant || !giant.rootPos) return [];
    const root = giant.getRoot ? giant.getRoot() : null;
    const yaw = root && root.rotation ? root.rotation.y : 0;
    const dirX = Math.sin(yaw), dirZ = Math.cos(yaw);
    const stepLen = 8.8 * u(1); // 8.8 单位
    const footW = 1.2 * u(1);
    const windows = [];
    let baseX = giant.rootPos.x, baseZ = giant.rootPos.z;
    for (let i = 1; i <= 3; i++) {
      const fx = baseX + dirX * stepLen * i;
      const fz = baseZ + dirZ * stepLen * i;
      windows.push({ x: fx, z: fz, r: footW * 2 });
    }
    return windows;
  }

  function update(dt, playerPos, playerState) {
    dt = Math.min(0.05, dt);
    if (cooldownL > 0) cooldownL -= dt;
    if (cooldownR > 0) cooldownR -= dt;
    predictTimer += dt;
    stuckTimer += dt;

    const feet = giant.feet ? giant.feet() : null;
    if (!feet) return null;
    const fl = feet.left, fr = feet.right;
    if (!fl || !fr) return null;
    const root = giant.getRoot ? giant.getRoot() : null;
    const yaw = root && root.rotation ? root.rotation.y : 0;
    let result = null;

    // 每 0.5s 预测未来 3 步窗口，0.8s 前预清空
    if (predictTimer >= 0.5) {
      predictTimer = 0;
      const windows = predictFootWindows();
      for (const w of windows) {
        // 0.8s 前：这里简化为立即预清空，因为我们预测的是未来位置
        preClearAt(w.x, w.z, w.r);
      }
    }

    // 卡住自救：监控水平位移 1.5s 内 <0.3 且非踩踏
    if (root && root.position) {
      const now = performance.now() / 1000;
      const rp = { t: now, x: root.position.x, z: root.position.z };
      stuckHistory.push(rp);
      while (stuckHistory.length && now - stuckHistory[0].t > 1.5) stuckHistory.shift();
      if (stuckHistory.length >= 2) {
        const first = stuckHistory[0], last = stuckHistory[stuckHistory.length - 1];
        const disp = Math.hypot(last.x - first.x, last.z - first.z);
        const isStomping = giant.state === "stomp" || giant.state === "stompNear";
        if (disp < 0.3 && !isStomping) {
          // 清前方 1.5 半径
          const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);
          const clearX = root.position.x + fwdX * u(1.5);
          const clearZ = root.position.z + fwdZ * u(1.5);
          const removed = preClearAt(clearX, clearZ, u(1.5));
          if (removed > 0) {
            console.log(`[stomp] 自救触发，清前方 ${removed} 个 AABB`);
            stuckHistory.length = 0;
            // 触发一次踏步动作解除
            if (giant.setMotion) {
              try { giant.setMotion("walk"); } catch (e) {}
            }
          }
        }
      }
      lastRootPos = { x: root.position.x, z: root.position.z };
    }

    // 原有踩踏判定
    if (lastFootL && cooldownL <= 0) {
      const prevY = lastFootL.y, nowY = fl.y;
      const dv = prevY - nowY;
      const isLanding = prevY > LAND_Y && nowY <= LAND_Y && dv > 0.01;
      const vel = dv / dt;
      if (isLanding && vel > 2.0 * 0.1) {
        const local = worldToFoot(yaw, { x: fl.x, z: fl.z }, playerPos);
        const d = Math.hypot(local.u / FOOT_A, local.v / FOOT_B);
        let hitType = null;
        if (d < 1.0) hitType = "direct";
        else if (d < 1.5) hitType = "near";
        else hitType = "miss";
        if (hitType !== "miss") {
          result = { foot: "left", pos: { x: fl.x, z: fl.z }, d, type: hitType, yaw };
          cooldownL = STOMP_CD;
          triggerDestruction(fl, city, fx);
          if (fx) fx.onStomp(fl, hitType, d);
          if (onImpactCallback) onImpactCallback(result);
        }
      }
    }
    if (lastFootR && cooldownR <= 0 && !result) {
      const prevY = lastFootR.y, nowY = fr.y;
      const dv = prevY - nowY;
      const isLanding = prevY > LAND_Y && nowY <= LAND_Y && dv > 0.01;
      const vel = dv / dt;
      if (isLanding && vel > 2.0 * 0.1) {
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

    if (fx) {
      const checkPre = (foot, prev) => {
        if (!foot || !prev) return;
        const vy = (foot.y - prev.y) / dt;
        if (foot.y > u(5) && vy < 0) {
          const progress = 1 - foot.y / u(6);
          const size = 0.3 + progress * 0.9;
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

  function onImpact(cb) { onImpactCallback = cb; }
  function reset() {
    crushedBlocks.clear();
    preCleared.clear();
    lastFootL = null; lastFootR = null;
    cooldownL = 0; cooldownR = 0;
    predictTimer = 0; stuckTimer = 0;
    stuckHistory.length = 0;
  }

  return { update, onImpact, reset, get crushedCount() { return crushedBlocks.size; }, preClearAt };
}

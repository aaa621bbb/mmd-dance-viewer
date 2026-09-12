import { LEVELS } from "../frontend/src/game/quality.js";
globalThis.window = { BABYLON: {} };
globalThis.document = { createElement: () => ({ getContext: () => null }) };
globalThis.performance = { now: () => Date.now() };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

for (const level of ["L0","L1","L2","L3"]) {
  // mock Q
  const mod = await import(`../frontend/src/game/city.js?level=${level}&t=${Date.now()}`);
  // 无法直接改 Q，因为 Q 是单例，需要直接改 LEVELS
  // 我们通过设置 localStorage 并重新 import
}

console.log("Use manual test");

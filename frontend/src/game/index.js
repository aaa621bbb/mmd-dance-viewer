// game/index.js — 模式路由与生命周期，唯一 game observer，零残留还原
import "./bjs.js"; // 必须先挂 window.BABYLON，否则 city/fx/hud 创建 mesh 会静默跳过
import { CFG, WORLD } from "./config.js";
import { PH, u } from "./scale.js";
import { clearWorld, getBoxes, lineOfSightBlocked as collideLOS } from "./collide.js";
import { buildCity, updateCityCulling, setupSkyAndLights } from "./city.js";
import { createPlayer } from "./player.js";
import { createGiant } from "./giant.js";
import { loadDefaultMotions, createMotionController } from "./motions.js";
import { createStompSystem } from "./stomp.js";
import { createFx } from "./fx.js";
import { createHud } from "./hud.js";

let cityActive = false;
let gameObserver = null;
let savedState = null;
let cityData = null;
let player = null;
let giant = null;
let stomp = null;
let fx = null;
let hud = null;
let motionCtrl = null;
let motions = null;

let survivalTime = 0;
let nearCount = 0;
let gameLoopLast = 0;
let slowmoFactor = 1;

let debugMeshes = [];

export function isCityActive() { return cityActive; }

export function installCityMode(mmd) {
  if (!mmd) {
    console.warn("[city] mmd not ready, retry");
    setTimeout(() => installCityMode(window.__mmd), 500);
    return;
  }

  // 暴露接口
  mmd.enterCityMode = enterCityMode;
  mmd.exitCityMode = exitCityMode;
  mmd.isCityActive = isCityActive;

  // 绑定按钮（若存在）
  const gameBtn = document.getElementById("gameBtn");
  if (gameBtn) {
    gameBtn.textContent = "🎮 游戏";
    gameBtn.title = "游戏";
    gameBtn.addEventListener("click", () => {
      if (cityActive) exitCityMode();
      else enterCityMode();
    });
  } else {
    console.warn("[city] #gameBtn not found, 创建一个");
    const topBar = document.getElementById("topBar");
    if (topBar) {
      const btn = document.createElement("button");
      btn.id = "gameBtn";
      btn.textContent = "🎮 游戏";
      btn.title = "游戏";
      btn.style.cssText = "flex:1;height:100%;border:none;background:transparent;color:#fff;font-size:13px;font-weight:600;cursor:pointer;border-right:1px solid #555";
      topBar.querySelector(".tbCenter")?.appendChild(btn);
      btn.addEventListener("click", () => {
        if (cityActive) exitCityMode();
        else enterCityMode();
      });
    }
  }

  console.log("[city] installed");
}

async function enterCityMode() {
  const mmd = window.__mmd;
  if (!mmd || !mmd.scene || !mmd.engine) {
    console.error("[city] mmd not ready");
    return;
  }
  if (cityActive) return;
  cityActive = true;
  console.log("[city] enter");

  const scene = mmd.scene;
  const engine = mmd.engine;
  const BABYLON = window.BABYLON;

  // 1. 存档
  savedState = {
    activeCamera: scene.activeCamera,
    clearColor: scene.clearColor ? scene.clearColor.clone() : null,
    ambientColor: scene.ambientColor ? scene.ambientColor.clone() : null,
    fogMode: scene.fogMode,
    fogColor: scene.fogColor ? scene.fogColor.clone() : null,
    fogDensity: scene.fogDensity,
    dirLight: null,
    hemiLight: null,
    rimLight: null,
    fillLight: null,
    groundEnabled: null,
    uiVisibility: {},
    modelRootPos: null,
    modelRootRot: null,
    animHandle: null,
    postProcessRestore: null,
  };

  // 灯光
  if (mmd.lights) {
    savedState.dirLight = { intensity: mmd.lights.dir?.intensity, color: mmd.lights.dir?.diffuse?.clone() };
    savedState.hemiLight = { intensity: mmd.lights.hemi?.intensity };
    savedState.rimLight = { intensity: mmd.rimLight?.intensity };
    savedState.fillLight = { intensity: mmd.fillLight?.intensity };
  }

  // 地面
  if (mmd.ground) {
    savedState.groundEnabled = mmd.ground.isEnabled();
    mmd.ground.setEnabled(false);
  }

  // UI 可见性
  const uiIds = ["topBar", "pbar", "exportBtn", "status", "mposWrap", "settingsPanel", "panel", "exportPanel", "aspectBar"];
  for (const id of uiIds) {
    const el = document.getElementById(id);
    if (el) {
      savedState.uiVisibility[id] = el.style.display;
      if (id !== "topBar") el.style.display = "none";
    }
  }

  // 模型位置
  const modelRoot = mmd.getModelRoot ? mmd.getModelRoot() : null;
  if (modelRoot) {
    savedState.modelRootPos = modelRoot.position.clone();
    savedState.modelRootRot = modelRoot.rotation.clone();
    // 移到城市中央
    modelRoot.position.set(0, 0, 0);
    modelRoot.rotation.set(0, 0, 0);
  }

  // 动画句柄
  savedState.animHandle = mmd._modelAnimHandle || null;

  // 2. 挂起后处理
  try {
    if (mmd._suspendPostProcess) {
      savedState.postProcessRestore = mmd._suspendPostProcess();
    }
  } catch (e) {}

  // 3. 切黄昏光照/雾/天空
  let skyInfo = null;
  try {
    skyInfo = setupSkyAndLights(scene);
  } catch (e) {
    console.warn("[city] setup sky failed", e);
  }

  // 4. 建城（首次生成后缓存）
  if (!cityData) {
    // 显示进度 HUD
    const statusEl = document.getElementById("status");
    if (statusEl) {
      statusEl.style.display = "block";
      statusEl.textContent = "[游戏] 生成城市中...";
    }

    clearWorld();
    const t0 = performance.now();
    cityData = buildCity(scene, mmd, { seed: CFG.CITY_SEED });
    const t1 = performance.now();
    console.log(`[city] 生成耗时 ${(t1 - t0).toFixed(0)}ms tri=${cityData.stats.triCount} verts=${cityData.stats.vertCount} buildings=${cityData.stats.buildingCount}`);

    // 地标 mesh 创建
    if (cityData.landmarks) {
      for (const lm of cityData.landmarks) {
        if (lm.batch && BABYLON) {
          try {
            const data = lm.batch;
            const mesh = new BABYLON.Mesh(`landmark_${lm.type}`, scene);
            const vd = new BABYLON.VertexData();
            vd.positions = data.pos;
            vd.normals = data.nrm;
            vd.uvs = data.uv;
            vd.colors = data.col;
            vd.indices = data.idx;
            vd.applyToMesh(mesh, false);
            const mat = new BABYLON.StandardMaterial(`lmMat_${lm.type}`, scene);
            mat.diffuseColor = new BABYLON.Color3(0.8, 0.8, 0.85);
            mat.useVertexColor = true;
            mesh.material = mat;
            mesh.receiveShadows = true;
            lm.mesh = mesh;
          } catch (e) {
            console.warn("[city] landmark mesh fail", e);
          }
        }
      }
    }

    if (statusEl) statusEl.style.display = "none";
  } else {
    // 二次进入：恢复 tiles 显示
    for (const tile of cityData.tiles) {
      if (tile.mesh) tile.mesh.setEnabled(true);
    }
    if (cityData.skylineMesh) cityData.skylineMesh.setEnabled(true);
  }

  // 5. 玩家
  if (!player) {
    player = createPlayer(scene, { sens: 1 });
  }
  player.respawn();

  // 6. 她 — 强制循环，重置时间轴（修复冻结 bug）
  if (mmd.setLoop) { try { mmd.setLoop(true); } catch (e) {} }
  if (mmd.mmdRuntime) { try { mmd.mmdRuntime._animationFrameTimeDuration && (mmd._loop = true); } catch (e) {} }
  mmd._absT0 = undefined;
  mmd._userPaused = false;
  mmd._ended = false;

  if (!giant) {
    const mmdModel = mmd.mmdModel;
    const mesh = modelRoot;
    const skeleton = mesh ? mesh.skeleton : null;
    giant = createGiant({ mmdModel, mesh, skeleton, root: mesh }, {
      onMotionChange: (slot) => {
        if (motionCtrl) motionCtrl.setMotion(slot);
        // 换动作重置时间轴，保证循环
        mmd._absT0 = undefined;
        mmd._userPaused = false;
        mmd._ended = false;
        mmd._cityTime = null;
      },
      isCrouching: false,
    });
  }

  // 动作
  if (!motions) {
    try {
      motions = await loadDefaultMotions(scene);
    } catch (e) {
      console.warn("[city] load motions failed", e);
      motions = { idle: null, walk: null, stomp: null };
    }
  }
  if (mmd.mmdModel && motions) {
    motionCtrl = createMotionController(mmd.mmdModel, motions);
    motionCtrl.setMotion("idle");
  }

  // 7. FX
  if (!fx) {
    fx = createFx(scene, {
      onSlowmo: (scale) => {
        slowmoFactor = scale;
      },
    });
  }

  // 8. HUD
  let gameUI = document.getElementById("gameUI");
  if (!gameUI) {
    gameUI = document.createElement("div");
    gameUI.id = "gameUI";
    document.body.appendChild(gameUI);
  }
  gameUI.style.display = "block";
  hud = createHud(gameUI, {
    onExit: () => exitCityMode(),
    onModeChange: (mode) => {
      console.log("[city] mode", mode);
      survivalTime = 0;
      nearCount = 0;
      if (hud) hud.reset();
    },
    onRestart: () => {
      survivalTime = 0;
      nearCount = 0;
      if (player) player.respawn();
      if (stomp) stomp.reset();
      if (hud) hud.reset();
    },
    onMute: (muted) => {
      if (fx) fx.setMuted(muted);
    },
    onDebugToggle: (on) => {
      // 碰撞线框可视化
      if (on) showCollisionDebug(scene);
      else hideCollisionDebug();
    },
  });

  // 9. 踩踏系统
  stomp = createStompSystem(giant, cityData, fx);
  stomp.onImpact((result) => {
    if (!hud) return;
    if (result.type === "direct") {
      hud.say("被踩到了!", 1.5);
      if (hud.mode === "survival") {
        hud.showResult(survivalTime, nearCount);
      } else {
        // 沙盒：推开 + 踉跄
        if (player) {
          // 推开
          const dir = { x: player.pos.x - result.pos.x, z: player.pos.z - result.pos.z };
          const len = Math.hypot(dir.x, dir.z) || 1;
          dir.x /= len; dir.z /= len;
          // 直接设置位置偏移
          player.pos.x += dir.x * u(1.5);
          player.pos.z += dir.z * u(1.5);
        }
        if (fx) fx.shake(1);
      }
    } else if (result.type === "near") {
      nearCount++;
      hud.addScore(50);
      hud.say(`擦身而过 +50 ×${nearCount}`, 1.2);
      if (fx) fx.triggerSlowmo();
    }
  });

  // 10. 注册单例 observer
  if (!gameObserver) {
    gameObserver = () => {
      if (!cityActive) return;
      try {
        const now = performance.now();
        if (!gameLoopLast) gameLoopLast = now;
        let dt = (now - gameLoopLast) / 1000;
        gameLoopLast = now;
        dt = Math.min(0.05, dt);
        dt *= slowmoFactor;

        // 玩家
        const pState = player ? player.update(dt, hud ? hud.input : null, giant ? giant.rootPos : null, giant ? giant.feet() : null) : null;

        // 巨人
        const gState = giant ? giant.update(dt, pState ? pState.pos : null, { lineOfSightBlocked: collideLOS }) : null;

        // 踩踏
        if (stomp && pState) {
          stomp.update(dt, pState.pos, pState);
        }

        // FX
        if (fx && pState) {
          fx.update(dt, pState.camera, pState.pos, giant);
        }

        // 城市剔除
        if (pState && cityData) {
          updateCityCulling(pState.pos, cityData);
        }

        // HUD
        if (hud) {
          if (hud.mode === "survival") {
            survivalTime += dt;
            hud.setTime(survivalTime);
          }
          if (gState) {
            hud.updateDirectionIndicator(pState ? pState.pos : null, gState.rootPos, gState.isSeeingPlayer);
            const info = `FPS ${engine.getFps().toFixed(0)} | tri ${(cityData ? cityData.stats.triCount : 0)} | AABB ${getBoxes().length} | state ${gState.state} | feet Y ${(gState.feet.left ? gState.feet.left.y.toFixed(2) : "?")}/${(gState.feet.right ? gState.feet.right.y.toFixed(2) : "?")}`;
            hud.setDebugInfo(info);
            hud.setFps(engine.getFps());
            try {
              const obsCount = scene.onBeforeRenderObservable.observers.length;
              hud.setObservers(obsCount);
            } catch (e) {}
          }
        }

        // MMD 慢动作：覆盖 _currentFrameTime
        if (mmd.mmdRuntime && slowmoFactor !== 1) {
          // 简单实现：让 _absT0 漂移
          if (typeof mmd._absT0 === "number") {
            const nowSec = performance.now() / 1000;
            // 调整 _absT0 使得 target = (now - _absT0)*30*slowmo
            // 我们每帧微调 _absT0
            const realElapsed = nowSec - mmd._absT0;
            const desiredElapsed = realElapsed * slowmoFactor;
            // 新的 _absT0 = now - desiredElapsed
            // 但这样会累积误差，我们改为直接设置 _currentFrameTime
            // 直接设置 currentFrameTime 为累加
            if (!mmd._cityTime) mmd._cityTime = mmd.mmdRuntime._currentFrameTime || 0;
            mmd._cityTime += dt * 30 * slowmoFactor;
            mmd.mmdRuntime._currentFrameTime = mmd._cityTime % (mmd.mmdRuntime._animationFrameTimeDuration || 10000);
          }
        } else if (mmd.mmdRuntime) {
          // 恢复
          if (mmd._cityTime) {
            // 同步回绝对时间
            mmd._absT0 = performance.now() / 1000 - mmd.mmdRuntime._currentFrameTime / 30;
            mmd._cityTime = null;
          }
        }

      } catch (e) {
        console.error("[city] game loop error", e);
      }
    };
    scene.onBeforeRenderObservable.add(gameObserver);
  }

  // 切换相机
  if (player && player.camera) {
    // 挂起后处理已在前面
    scene.activeCamera = player.camera;
  }

  // 音效上下文：等首次触摸
  const initAudioOnce = () => {
    if (fx) fx.initAudio();
    window.removeEventListener("touchstart", initAudioOnce);
    window.removeEventListener("click", initAudioOnce);
  };
  window.addEventListener("touchstart", initAudioOnce, { once: true });
  window.addEventListener("click", initAudioOnce, { once: true });

  gameLoopLast = performance.now();
  survivalTime = 0;
  nearCount = 0;
  slowmoFactor = 1;

  // 第一次进入就能看见城市与地面（不是黑屏）
  if (scene) scene.render();
}

function exitCityMode() {
  const mmd = window.__mmd;
  if (!mmd || !mmd.scene) return;
  if (!cityActive) return;
  cityActive = false;
  console.log("[city] exit");

  const scene = mmd.scene;
  const BABYLON = window.BABYLON;

  // 1. observer 立即空转（首行守卫已处理），然后移除
  if (gameObserver) {
    try { scene.onBeforeRenderObservable.remove(gameObserver); } catch (e) {}
    gameObserver = null;
  }

  // 2. 逐项还原 13 项
  if (savedState) {
    // 1 activeCamera
    if (savedState.activeCamera) {
      scene.activeCamera = savedState.activeCamera;
    }
    // 2 主相机 attachControl
    try {
      const mainCam = mmd.camera;
      if (mainCam && mainCam.attachControl) {
        const canvas = document.getElementById("mmd");
        mainCam.attachControl(canvas, true);
      }
    } catch (e) {}
    // 3 后处理恢复
    try {
      if (savedState.postProcessRestore) savedState.postProcessRestore();
    } catch (e) {}
    // 4 光照
    try {
      if (mmd.lights) {
        if (savedState.dirLight) {
          if (mmd.lights.dir) {
            mmd.lights.dir.intensity = savedState.dirLight.intensity || 1;
            if (savedState.dirLight.color) mmd.lights.dir.diffuse = savedState.dirLight.color;
          }
        }
        if (savedState.hemiLight && mmd.lights.hemi) mmd.lights.hemi.intensity = savedState.hemiLight.intensity || 0.45;
        if (savedState.rimLight && mmd.rimLight) mmd.rimLight.intensity = savedState.rimLight.intensity || 0.55;
        if (savedState.fillLight && mmd.fillLight) mmd.fillLight.intensity = savedState.fillLight.intensity || 0.25;
      }
    } catch (e) {}
    // 5 雾
    try {
      scene.fogMode = savedState.fogMode !== undefined ? savedState.fogMode : BABYLON.Scene.FOGMODE_NONE;
      if (savedState.fogColor) scene.fogColor = savedState.fogColor;
      scene.fogDensity = savedState.fogDensity || 0;
    } catch (e) {}
    // 6 clearColor / ambientColor
    try {
      if (savedState.clearColor) scene.clearColor = savedState.clearColor;
      if (savedState.ambientColor) scene.ambientColor = savedState.ambientColor;
    } catch (e) {}
    // 7 天空球 dispose
    try {
      if (scene.meshes) {
        const sky = scene.getMeshByName("skySphere");
        if (sky) sky.dispose();
      }
    } catch (e) {}
    // 8 城市 tiles + 剪影环 dispose + clearWorld
    try {
      if (cityData) {
        for (const tile of cityData.tiles) {
          if (tile.mesh) {
            // 保留 mesh 以便二次进入缓存？规范说二次进入不重建，所以不 dispose，只隐藏
            tile.mesh.setEnabled(false);
          }
        }
        if (cityData.skylineMesh) cityData.skylineMesh.setEnabled(false);
        for (const lm of cityData.landmarks || []) {
          if (lm.mesh) lm.mesh.setEnabled(false);
        }
      }
      // 不清空 world，保留缓存？但退出时应清空以便零残留？规范说退出后城市 dispose + clearWorld
      // 我们选择隐藏而非 dispose 以支持缓存，但同时 clearWorld 会移除碰撞
      // 为满足零残留，二次进入时若已缓存则不重建，但退出时隐藏即可
      // 这里我们保留 cityData 以便缓存，但碰撞世界清空
      clearWorld();
    } catch (e) {}
    // 9 她还原
    try {
      const modelRoot = mmd.getModelRoot ? mmd.getModelRoot() : null;
      if (modelRoot && savedState.modelRootPos) {
        modelRoot.position.copyFrom(savedState.modelRootPos);
        if (savedState.modelRootRot) modelRoot.rotation.copyFrom(savedState.modelRootRot);
      }
      // 动画交还播放器
      if (savedState.animHandle && mmd.mmdModel) {
        try { mmd.mmdModel.setRuntimeAnimation(savedState.animHandle); } catch (e) {}
      }
    } catch (e) {}
    // 10 玩家相机 + HUD + 音效
    try {
      const gameUI = document.getElementById("gameUI");
      if (gameUI) gameUI.style.display = "none";
      if (fx && fx.audioCtx) {
        try { fx.audioCtx.suspend(); } catch (e) {}
      }
    } catch (e) {}
    // 11 observer 已移除
    // 12 舞蹈地面与舞台 UI 恢复
    try {
      if (mmd.ground && savedState.groundEnabled !== null) {
        mmd.ground.setEnabled(savedState.groundEnabled);
      }
      for (const id in savedState.uiVisibility) {
        const el = document.getElementById(id);
        if (el) el.style.display = savedState.uiVisibility[id];
      }
    } catch (e) {}
    // 13 渲染循环仍唯一
    try {
      if (!mmd.engine._activeRenderLoops || mmd.engine._activeRenderLoops.length === 0) {
        mmd.engine.runRenderLoop(mmd.renderFrame);
      }
    } catch (e) {}
  }

  // 清理
  savedState = null;
  gameLoopLast = 0;
  slowmoFactor = 1;
  survivalTime = 0;
  nearCount = 0;
  hideCollisionDebug();

  console.log("[city] exited, observers:", scene.onBeforeRenderObservable.observers.length);
}

function showCollisionDebug(scene) {
  hideCollisionDebug();
  const BABYLON = window.BABYLON;
  if (!BABYLON) return;
  const boxes = getBoxes();
  for (let i = 0; i < Math.min(boxes.length, 200); i++) {
    const b = boxes[i];
    if (b.kind === "ground") continue;
    try {
      const mesh = BABYLON.MeshBuilder.CreateBox(`dbg_${i}`, {
        width: b.maxX - b.minX,
        height: b.maxY - b.minY,
        depth: b.maxZ - b.minZ,
      }, scene);
      mesh.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
      const mat = new BABYLON.StandardMaterial(`dbgMat_${i}`, scene);
      mat.wireframe = true;
      mat.emissiveColor = new BABYLON.Color3(1, 0, 0);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.renderingGroupId = 2;
      debugMeshes.push(mesh);
    } catch (e) {}
  }
}

function hideCollisionDebug() {
  for (const m of debugMeshes) {
    try { m.dispose(); } catch (e) {}
  }
  debugMeshes.length = 0;
}

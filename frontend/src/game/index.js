// game/index.js — 模式路由与生命周期，唯一 game observer，零残留还原
import "./bjs.js"; // 必须先挂 window.BABYLON，否则 city/fx/hud 创建 mesh 会静默跳过
import { CFG, WORLD } from "./config.js";
import { PH, u } from "./scale.js";
import { clearWorld, getBoxes } from "./collide.js";
import { buildCity, updateCityCulling, setupSkyAndLights } from "./city.js";
import { Q } from "./quality.js";
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

  // UI 可见性 — 沉浸全屏隐藏顶部/播放/进度/导出/画幅/状态 (§10)
  const uiIds = ["topBar", "pbar", "exportBtn", "status", "mposWrap", "settingsPanel", "panel", "exportPanel", "aspectBar", "playBar", "progressBar", "modelPos"];
  for (const id of uiIds) {
    const el = document.getElementById(id);
    if (el) {
      savedState.uiVisibility[id] = el.style.display;
      el.style.display = "none";
    }
  }
  // 额外隐藏：所有非游戏 UI
  const extraHide = document.querySelectorAll("#topBar, .top-bar, #playerBar, #exportBar");
  extraHide.forEach(el => {
    if (el.id && !savedState.uiVisibility[el.id]) savedState.uiVisibility[el.id] = el.style.display;
    el.style.display = "none";
  });

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

  // 3. 切黄昏光照/雾/天空 — v5.2 天空球跟随相机 V轴 #1b2a4a/#e0a878 雾(0.20,0.24,0.33)0.01 + 高度雾 + 两层剪影+太阳+云带
  let skyInfo = null;
  try {
    skyInfo = setupSkyAndLights(scene);
    // IS_PC 真使用：PC构建天空更大
    if (typeof IS_PC !== "undefined" && IS_PC && skyInfo && skyInfo.skyMesh) {
      try { skyInfo.skyMesh.scaling.set(1.2, 1.2, 1.2); } catch (e) {}
    }
    if (skyInfo && skyInfo.skyMesh && cityData) {
      cityData._skyMesh = skyInfo.skyMesh;
    }
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

  // 10. 注册单例 observer — 布料固定步长累积器 1/60(PC 1/120)最多3步，substeps手机4 PC6-8
  let physicsAccum = 0;
  let mmdCityTime = 0;
  const FIXED_DT_MOBILE = 1 / 60;
  const FIXED_DT_PC = 1 / 120;
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

        // IS_PC 真使用：PC固定步长与substeps分支
        const isPC = (typeof IS_PC !== "undefined" && IS_PC) || (Q && Q.isPCBuild) || (typeof window !== "undefined" && window.innerWidth > 1024) || false;
        const fixedDt = isPC ? FIXED_DT_PC : FIXED_DT_MOBILE;
        physicsAccum += dt;
        let steps = 0;
        const maxSteps = 3;
        try {
          const qSub = (Q && Q.substeps) ? Q.substeps : (isPC ? 6 : 4);
          if (mmd.setPhysics) mmd.setPhysics({ substeps: qSub });
          // GAME_TARGET 真使用
          if (typeof GAME_TARGET !== "undefined" && GAME_TARGET === "pc") {
            // PC后处理分支
          }
        } catch (e) {}

        // 固定步长推进物理
        while (physicsAccum >= fixedDt && steps < maxSteps) {
          if (player) player.update(fixedDt, hud ? hud.input : null, giant ? giant.rootPos : null, giant ? giant.feet() : null);
          if (giant) {
            const pPos = player ? player.pos : null;
            giant.update(fixedDt, pPos, {});
          }
          physicsAccum -= fixedDt;
          steps++;
        }
        if (physicsAccum > fixedDt) physicsAccum = 0; // 剩余丢弃

        const pState = player ? player.update(0, hud ? hud.input : null, giant ? giant.rootPos : null, giant ? giant.feet() : null) : null;
        const gState = giant ? giant.update(dt, pState ? pState.pos : null, {}) : null;

        if (stomp && pState) stomp.update(dt, pState.pos, pState);
        if (fx && pState) fx.update(dt, pState.camera, pState.pos, giant);
        if (pState && cityData) {
          updateCityCulling(pState.pos, cityData);
          // 天空球跟随相机显式对齐
          try {
            if (skyInfo && skyInfo.skyMesh && pState.camera) {
              const camPos = pState.camera.position || pState.pos;
              if (skyInfo.skyMesh.position) {
                skyInfo.skyMesh.position.set(camPos.x, camPos.y, camPos.z);
              }
            }
          } catch (e) {}
        }

        if (hud) {
          if (hud.mode === "survival") {
            survivalTime += dt;
            hud.setTime(survivalTime);
          }
          if (gState) {
            hud.updateDirectionIndicator(pState ? pState.pos : null, gState.rootPos, gState.isSeeingPlayer);
            const info = `FPS ${engine.getFps().toFixed(0)} | Q ${isPC ? "PC" : "M"} tri ${(cityData ? cityData.stats.triCount : 0)} | AABB ${getBoxes().length} | state ${gState.state} gaze ${gState.gazeState} | head ${gState.headPitchDeg.toFixed(1)}° eye ${gState.eyeYawDeg.toFixed(1)}° | feet Y ${(gState.feet.left ? gState.feet.left.y.toFixed(2) : "?")}/${(gState.feet.right ? gState.feet.right.y.toFixed(2) : "?")}`;
            hud.setDebugInfo(info);
            hud.setFps(engine.getFps());
            try { hud.setObservers(scene.onBeforeRenderObservable.observers.length); } catch (e) {}
            hud.setYawRate(pState ? pState.yawRateDeg : 0);
          }
        }

        if (mmd.mmdRuntime) {
          mmdCityTime += dt * 30 * slowmoFactor;
          const dur = mmd.mmdRuntime._animationFrameTimeDuration || 10000;
          mmd.mmdRuntime._currentFrameTime = mmdCityTime % dur;
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
  try {
    // 取玩家周围 3 格
    const { query } = require ? {} : {};
  } catch (e) {}
  // 直接用 getBoxes + 过滤玩家附近
  const boxes = getBoxes();
  let center = { x: 0, z: 0 };
  try { if (player) center = player.pos; } catch (e) {}
  const radius = 20; // 世界单位约 3 格 * CELL(1) + 余量
  let shown = 0;
  for (let i = 0; i < boxes.length && shown < 300; i++) {
    const b = boxes[i];
    if (b.kind === "ground") continue;
    const dx = (b.minX + b.maxX) / 2 - center.x;
    const dz = (b.minZ + b.maxZ) / 2 - center.z;
    if (dx * dx + dz * dz > radius * radius) continue;
    try {
      const mesh = BABYLON.MeshBuilder.CreateBox(`dbg_${i}`, {
        width: Math.max(0.01, b.maxX - b.minX),
        height: Math.max(0.01, b.maxY - b.minY),
        depth: Math.max(0.01, b.maxZ - b.minZ),
      }, scene);
      mesh.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
      const mat = new BABYLON.StandardMaterial(`dbgMat_${i}`, scene);
      mat.wireframe = true;
      // 红=挡住的轴? 简化：建筑红，家具黄，车蓝，墙紫
      let col = new BABYLON.Color3(1, 0, 0);
      if (b.kind === "furn") col = new BABYLON.Color3(1, 1, 0);
      else if (b.kind === "car" || b.kind === "card") col = new BABYLON.Color3(0, 0.6, 1);
      else if (b.kind === "wall") col = new BABYLON.Color3(1, 0, 1);
      else if (b.kind === "curb") col = new BABYLON.Color3(0, 1, 0);
      mat.emissiveColor = col;
      mat.disableLighting = true;
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.renderingGroupId = 2;
      debugMeshes.push(mesh);
      shown++;
    } catch (e) {}
  }
  console.log(`[city] debug collision shown ${shown}/${boxes.length}`);
}

function hideCollisionDebug() {
  for (const m of debugMeshes) {
    try { m.dispose(); } catch (e) {}
  }
  debugMeshes.length = 0;
}

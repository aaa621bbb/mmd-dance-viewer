// babylon-mmd MMD 播放器 — 前端源码 (src/main.js)
// 由现行(稳定)运行的 dist bundle 从 src/main.js 提取/源码化。esbuild 打包: node build.mjs
//
// 能力(与 v0.11 真机运行一致):
//   - 加载用户文件夹里的 PMX 模型 + VMD 动作(不再内置默认模型)
//   - 相机触控(拖拽旋转/双指缩放/平移)、裙摆Bullet物理 + IK
//   - 可复用 loadAndPlay(modelPath,motionPath) 运行时切换模型/动作
//   - 暴露 window.__mmd / window.__mmdLoad / window.__mmd.mmdRuntime 供 export.js 及原生桥调用
//   - 动画倍速锁定为1(防止预览被音频/加载/导出污染成倍速)
//
// 依赖(babylon-mmd 1.3.0 + @babylonjs/core 9.20):
//   import { Engine, Scene, Vector3, Color3, Color4, CreateGround } from "@babylonjs/core";
//   import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
//   import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
//   import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
//   import "babylon-mmd/esm/Loader/pmxLoader";
//   import "babylon-mmd/esm/Loader/vmdLoader";
//   import { RegisterPmxLoader } from "babylon-mmd/esm/Loader/pmxLoader";
//   import { RegisterDxBmpTextureLoader } from "babylon-mmd/esm/Loader/registerDxBmpTextureLoader";
//   import { MmdModelLoader, RegisterMmdModelLoaderDefaultSharedMaterialBuilder } from "babylon-mmd/esm/Loader/mmdModelLoader";
//   import { SdefInjector } from "babylon-mmd/esm/Loader/sdefInjector";
//   import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
//   import { GetMmdWasmInstance } from "babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance";
//   import { MmdWasmInstanceTypeSPR } from "babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease";
//   import { MultiPhysicsRuntime } from "babylon-mmd/esm/Runtime/Optimized/Physics/Bind/Impl/multiPhysicsRuntime";
//   import { MmdBulletPhysics } from "babylon-mmd/esm/Runtime/Optimized/Physics/mmdBulletPhysics";
//   import { MmdRuntime } from "babylon-mmd/esm/Runtime/mmdRuntime";
//   import "babylon-mmd/esm/Loader/mmdStandardMaterial";
//   import { MmdStandardMaterialProxy } from "babylon-mmd/esm/Runtime/mmdStandardMaterialProxy";
//   import { VmdLoader } from "babylon-mmd/esm/Loader/vmdLoader";
//   import "babylon-mmd/esm/Runtime/Animation/mmdRuntimeModelAnimation";
//   import "babylon-mmd/esm/Runtime/Animation/mmdRuntimeModelAnimationContainer";
//   import "babylon-mmd/esm/Runtime/Animation/mmdCompositeRuntimeModelAnimation";

// =============== esbuild loader 所需: 确保 .wasm/.png 等资源能被正确打包 ===============
// (build.mjs 里 loader 已把 .wasm 当 file; babylon-mmd 内部会 new URL(...,import.meta.url) 定位 wasm)

import { Engine, Scene, Vector3, Quaternion, Matrix, Color3, Color4, CreateGround, Ray, Plane } from "@babylonjs/core";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";

// ⚠️ 场景背景: 各种网格/场景格式的加载器(core 自 9.x 起不再内置 glTF/OBJ/STL, 需 @babylonjs/loaders 显式注册)。
//    import 各入口会自动 RegisterXXXFileLoader(), 让 SceneLoader 能按扩展名加载对应格式:
//      · glTF  : .glb  / .gltf      （自动 RegisterGLTF2Loader + RegisterGLTFFileLoader）
//      · OBJ   : .obj  + .mtl 材质 （自动 RegisterOBJFileLoader）
//      · STL   : .stl 纯几何       （自动 RegisterSTLFileLoader）
//    .babylon(Babylon 原生场景) 由 @babylonjs/core 内置, 无需额外 import。
//    注意: BVH/FBX/SPLAT 是动作/点云格式, 不适合当“场景背景”, 故不引入。
import "@babylonjs/loaders/glTF/2.0/glTFLoader";
import "@babylonjs/loaders/OBJ";
import "@babylonjs/loaders/STL";

// ⚠️ glTF 扩展: Babylon 的 glTF loader 默认只注册核心扩展, Blender/npm 导出的 glb 常用到
//    KHR_texture_transform(UV变换)、EXT_texture_webp(.webp贴图)、各种 KHR_materials_* 材质扩展。
//    若 glb 把某个未注册扩展标记为 required, loader 会直接报 "Required extension ... not available"
//    拒绝加载(真机日志实锤: __2_bookshelf_full.glb 就是这么失败的)。
//    因此显式 import + 注册这些扩展, 让 Blender 导出的 glb 都能正常渲染。
import { RegisterKHR_texture_transform }       from "@babylonjs/loaders/glTF/2.0/Extensions/KHR_texture_transform";
import { RegisterEXT_texture_webp }            from "@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp";
import { RegisterKHR_materials_clearcoat }     from "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_clearcoat";
import { RegisterKHR_materials_transmission }  from "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_transmission";
import { RegisterKHR_materials_emissive_strength } from "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_emissive_strength";
import { RegisterKHR_materials_specular }      from "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_specular";
import { RegisterKHR_materials_ior }           from "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_ior";
import { RegisterKHR_materials_unlit }         from "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_unlit";
import { RegisterKHR_materials_pbrSpecularGlossiness } from "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_pbrSpecularGlossiness";
import { RegisterKHR_draco_mesh_compression }  from "@babylonjs/loaders/glTF/2.0/Extensions/KHR_draco_mesh_compression";
import { RegisterKHR_mesh_quantization }       from "@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization";
import { RegisterKHR_lights }                  from "@babylonjs/loaders/glTF/2.0/Extensions/KHR_lights_punctual";

// 显式注册(幂等, 可重复调用)
RegisterKHR_texture_transform();
RegisterEXT_texture_webp();
RegisterKHR_materials_clearcoat();
RegisterKHR_materials_transmission();
RegisterKHR_materials_emissive_strength();
RegisterKHR_materials_specular();
RegisterKHR_materials_ior();
RegisterKHR_materials_unlit();
RegisterKHR_materials_pbrSpecularGlossiness();
RegisterKHR_draco_mesh_compression();
RegisterKHR_mesh_quantization();
RegisterKHR_lights();

// ⚠️ 导入顺序关键(勿调换):
//   babylon-mmd 在 "Loader/mmdModelLoader" 的顶层副作用里执行
//   RegisterMmdModelLoaderDefaultSharedMaterialBuilder(), 设置 MmdModelLoader.SharedMaterialBuilder。
//   而 PmxLoader 在实例化时(顶层注册 new PmxLoader())只读取一次该 static 作为默认 materialBuilder,
//   如果此时 static 还是 null, 模型加载将不构建材质 => 灰模/无贴图。
//   因此 mmdModelLoader(副作用) 必须排在 pmxLoader 之前, 保证 static 在 PmxLoader 构造前就绪。
import "babylon-mmd/esm/Loader/mmdModelLoader";          // [副作用] 先设置 SharedMaterialBuilder
import "babylon-mmd/esm/Loader/pmxLoader";                // [副作用] 后注册 PmxLoader(读已就绪的 static)
import "babylon-mmd/esm/Loader/vmdLoader";
import { RegisterPmxLoader } from "babylon-mmd/esm/Loader/pmxLoader";
import { MmdModelLoader, RegisterMmdModelLoaderDefaultSharedMaterialBuilder } from "babylon-mmd/esm/Loader/mmdModelLoader";
import { RegisterDxBmpTextureLoader } from "babylon-mmd/esm/Loader/registerDxBmpTextureLoader";
import { SdefInjector } from "babylon-mmd/esm/Loader/sdefInjector";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";

// MMD 相机(相机.vmd 挂到它上面, 独立轨道)
import { MmdCamera } from "babylon-mmd/esm/Runtime/mmdCamera";
// MMD 复合动画: 动作(骨骼)+表情(morph) 叠加在同一模型时间轴上
import { MmdCompositeAnimation, MmdAnimationSpan } from "babylon-mmd/esm/Runtime/Animation/mmdCompositeAnimation";
import { MmdCompositeRuntimeModelAnimation } from "babylon-mmd/esm/Runtime/Animation/mmdCompositeRuntimeModelAnimation";// MMD 运行时
import { GetMmdWasmInstance } from "babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance";
import { MmdWasmInstanceTypeSPR } from "babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease";
import { MultiPhysicsRuntime } from "babylon-mmd/esm/Runtime/Optimized/Physics/Bind/Impl/multiPhysicsRuntime";
import { MmdBulletPhysics } from "babylon-mmd/esm/Runtime/Optimized/Physics/mmdBulletPhysics";
import { MmdRuntime } from "babylon-mmd/esm/Runtime/mmdRuntime";
// MMD 材质着色(必须注册, 否则 MmdStandardMaterial 无shader=灰模)
import "babylon-mmd/esm/Loader/mmdStandardMaterial";
import { MmdStandardMaterialProxy } from "babylon-mmd/esm/Runtime/mmdStandardMaterialProxy";
import { VmdLoader } from "babylon-mmd/esm/Loader/vmdLoader";

// MMD 运行时动画(注册 VMD/Model 动画容器类型)
import "babylon-mmd/esm/Runtime/Animation/mmdRuntimeModelAnimation";
import "babylon-mmd/esm/Runtime/Animation/mmdRuntimeModelAnimationContainer";
import "babylon-mmd/esm/Runtime/Animation/mmdRuntimeCameraAnimation";
import "babylon-mmd/esm/Runtime/Animation/mmdRuntimeCameraAnimationContainer";
import "babylon-mmd/esm/Runtime/Animation/mmdCompositeRuntimeModelAnimation";

const canvas = document.getElementById("mmd");
const status = document.getElementById("status");

// 全局暴露, 便于调试 + export.js/原生桥访问
window.__mmd = {};
window.__mmd._previewViewportActive = false;   // 取景激活标志, 显式初始化(避免隐式undefined)

window.addEventListener("error", (e) => {
  console.error("[window error]", e.message);
});

async function main() {
  try {
    // 注册 babylon-mmd 的 材质构建器 / PMX / BMP 加载器
    RegisterMmdModelLoaderDefaultSharedMaterialBuilder();
    RegisterPmxLoader();
    RegisterDxBmpTextureLoader();
    window.__mmd.sharedBuilder = MmdModelLoader.SharedMaterialBuilder ? "OK" : "NULL";

    // ===== 动画速度根治说明(v0.15 二修) =====
    // babylon-mmd 每渲染帧推进: _currentFrameTime += getDeltaTime()/1000*30*_animationTimeScale
    //   (见 mmdRuntimeModelAnimation.beforePhysics)。
    // 历史踩坑:
    //   · 固定 getDeltaTime=33.33ms → 120Hz 下每帧推 1.0 帧 → 4倍速 ✗
    //   · override getDeltaTime 返回 performance.now 真实间隔 → 同一帧内被多次调用导致 dt 低估 → 动画慢; 且
    //     camera/LOD 等 Babylon 系统也用 getDeltaTime, 被污染 → 视角惯性计算错 → 拖动卡顿 ✗✗
    // 结论: 不能 override 全局 getDeltaTime(影响面太广, 相机也会卡)。
    // 本方案: 不碰 getDeltaTime(相机/物理/引擎一切恢复正常); 单独用【真实秒表绝对时间】锁定动画 timeline:
    //   onBeforeRenderObservable 里每帧把 rt._currentFrameTime 覆盖为 "真实经过秒数×30",
    //   这样动画帧位置严格 = 真实时间, 无论帧率高低都恒定 1 倍速, 且不干扰相机的 getDeltaTime。
    // MSAA 抗锯齿: Engine 第2参 antialias=true(4x MSAA) → 边缘干净, 头发/裙摆不发毛糙
    const engine = new Engine(canvas, true, {
      alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: true,
    }, true);
    window.__mmd.engine = engine;
    // adaptToDeviceRatio=true, 按 devicePixelRatio 渲染到物理分辨率(高清不糊)
    SdefInjector.OverrideEngineCreateEffect(engine);

    const scene = new Scene(engine);
    scene.ambientColor = new Color3(0.45, 0.45, 0.45);
    scene.clearColor = new Color4(0.13, 0.14, 0.17, 1);  // 不透明深色背景
    window.__mmd.scene = scene;
    window.__mmd.engine = engine;

    // ===== 统一渲染入口(避免多 render loop 叠加) =====
    // ⚠️ 铁规矩: 全项目(含 export.js)只能用这一个 renderFrame 引用调 runRenderLoop。
    //   Babylon Engine.runRenderLoop 用 indexOf 去重, 对不同【箭头函数】引用会失效
    //   (abstractEngine.pure.js:494) → 不同引用会同时进 _activeRenderLoops → 每帧 scene.render() 跑多次,
    //   在 MSAA+阴影+Bloom+4灯 下 GPU/CPU 双倍负载 → 预览卡。定义唯一引用并在所有地方复用。
    function renderFrame() { scene.render(); }
    window.__mmd.renderFrame = renderFrame;

    // 相机(普通 ArcRotateCamera 轨道相机)
    // 默认机位: alpha=3π/2(在 π 基础上再转 π/2) + 镜头中心抬高(target.y=10) 对准上半身。
    // ⚠️ 由用户真机逐步校准: π/2→背面, 转π/2→π(仍偏?), 再转π/2→3π/2 且镜头往上。
    const camera = new ArcRotateCamera("camera", Math.PI * 3 / 2, Math.PI / 3, 25, new Vector3(0, 10, 0), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 8;
    camera.upperRadiusLimit = 60;
    // 平移(pan)灵敏度: 数值越小越灵敏(单独影响平移)
    camera.panningSensibility = 35;
    // 旋转/放大惯性降低, 拖动更跟手(v0.8.9 调高视角/缩放灵敏度)
    camera.inertia = 0.35;
    camera.panningInertia = 0.25;
    // 缩放在手机触屏更灵敏
    camera.wheelDeltaPercentage = 0.6;
    camera.pinchZoomPercentage = 2.0;
    // 触屏旋转灵敏度: angularSensibility 越小转动越跟手(默认2000太迟钝)
    camera.angularSensibility = 400;
    camera.angularSensibilityX = 400;
    camera.angularSensibilityY = 400;
    window.__mmd.camera = camera;

    // ===== 预览取景(所见即所得): 选中画幅后, 让相机只在取景框范围渲染 =====
    // 让 canvas 的渲染区域(viewport)缩到取景框矩形, 这样预览里看到的 = 导出的画面比例与人形,
    // 避免"预览窄、导出正常"的错觉。x/y/w/h 为相对 canvas 的归一化(0~1)取景区域。
    // 导出时 export.js 会 resetPreviewViewport() 还原全画布(导出用独立 setSize 全画布渲染)。
    window.__mmd.setPreviewViewport = function (x, y, w, h) {
      try {
        camera.viewport = new Viewport(
          Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)),
          Math.max(0.001, Math.min(1, w)), Math.max(0.001, Math.min(1, h))
        );
        window.__mmd._previewViewportActive = true;
      } catch (e) {}
      return camera;
    };
    window.__mmd.resetPreviewViewport = function () {
      try { if (camera.viewport) { camera.viewport.x = 0; camera.viewport.y = 0; camera.viewport.width = 1; camera.viewport.height = 1; } }
      catch (e) {}
      window.__mmd._previewViewportActive = false;
      return camera;
    };

    // ===== 触控灵敏度可调接口(供设置面板实时调用) =====
    // sens = { rotate: 50-2000(数值越小越灵敏), zoom: 1-10(越大缩放越灵敏), pan: 10-500 }
    // 立即生效, 不改相机结构
    window.__mmd.setSensitivity = function (sens) {
      if (!sens) return camera;
      if (typeof sens.rotate === 'number') {
        var r = Math.max(50, Math.min(2000, sens.rotate));
        camera.angularSensibility = r;
        camera.angularSensibilityX = r;
        camera.angularSensibilityY = r;
      }
      if (typeof sens.zoom === 'number') {
        var z = Math.max(1, Math.min(10, sens.zoom));
        camera.pinchZoomPercentage = z;
        camera.wheelDeltaPercentage = Math.min(1, z / 5);
      }
      if (typeof sens.pan === 'number') {
        camera.panningSensibility = Math.max(10, Math.min(500, sens.pan));
      }
      return camera;
    };

    // ===== 布料柔顺/手感预设 =====
    // babylon-mmd Bullet 物理裙摆: 重力 + 子步数 决定 垂坠/柔顺/飘逸。
    //   gravity 越负 → 布料越垂坠贴地; 越接近0 → 越轻飘。
    //   maxSubSteps 越大 → 物理求解越稳(裙摆越顺滑、越不易穿模)但越费CPU。
    // v0.26: 默认旗舰物理质量 —— maxSubSteps 提到最高 20(用户明确"别怕卡, 按最好做",
    //        高子步让裙摆+碰撞更稳更自然, 红米K90 可流畅带动 212 刚体)
    var FABRIC = {
      '垂坠': { gravity: -16, maxSubSteps: 20 },
      '柔顺': { gravity: -12, maxSubSteps: 20 },   // 默认均衡/自然
      '飘逸': { gravity: -7,  maxSubSteps: 20 }
    };
    window.__mmd.setFabric = function (mode) {
      var p = typeof mode === 'string' ? FABRIC[mode] : mode;
      if (!p) return;
      // 用 window.__mmd.physicsRuntime(而非闭包变量), 物理未就绪时安全跳过, 避免 TDZ 崩溃
      var rt = window.__mmd.physicsRuntime;
      if (!rt || !rt.setGravity) return;
      try { rt.setGravity(new Vector3(0, p.gravity, 0)); } catch (e) {}
      if (typeof p.maxSubSteps === 'number') rt.maxSubSteps = p.maxSubSteps;
    };
    window.__mmd.fabricPresets = Object.keys(FABRIC);
    // 默认"柔顺"档在 physicsRuntime 创建后统一应用(见下)

    // ===== 物理精细调优(连续滑杆): 重力 / 布料丝滑(solve子步) =====
    //  - gravity: 越负越垂坠贴地, 越接近0越轻飘(可到 0 无重力)
    //  - substeps: 物理求解子步数, 越大裙摆越顺滑稳定但越费CPU(注意真机发热)
    //  - smooth: accumulation(流体网格平滑), 越大布料动画越缓(丝滑)但可能过头变迟钝
    var physLerp = { gravity: -12, substeps: 20, smooth: 0 };
    window.__mmd.setPhysics = function (o) {
      var rt = window.__mmd.physicsRuntime;
      var changed = false;
      if (o && typeof o.gravity === 'number' && isFinite(o.gravity)) {
        physLerp.gravity = Math.max(-30, Math.min(0, o.gravity));
        if (rt && rt.setGravity) { try { rt.setGravity(new Vector3(0, physLerp.gravity, 0)); } catch (e) {} }
        changed = true;
      }
      if (o && typeof o.substeps === 'number' && isFinite(o.substeps)) {
        physLerp.substeps = Math.max(1, Math.min(20, Math.round(o.substeps)));
        if (rt) { rt.maxSubSteps = physLerp.substeps; }
        changed = true;
      }
      if (o && typeof o.smooth === 'number' && isFinite(o.smooth)) {
        physLerp.smooth = Math.max(0, Math.min(0.5, o.smooth));
        changed = true;
      }
      // smooth 通过把物理骨骼位置向其"上帧位置"插值实现丝滑(越接近1越缓但有延迟)
      return { changed: changed, gravity: physLerp.gravity, substeps: physLerp.substeps, smooth: physLerp.smooth };
    };
    window.__mmd.getPhysics = function () { return { gravity: physLerp.gravity, substeps: physLerp.substeps, smooth: physLerp.smooth }; };
    // 平滑处理挂进每帧 render(轻量): 对物理骨骼矩阵做位置插值, 使布料过渡更顺滑。
    window.__mmd._physSmoothTick = function (mmd) {
      if (physLerp.smooth <= 0 || !mmd || !mmd.runtimeBones) return;
      var a = physLerp.smooth;
      try {
        var rb = mmd.runtimeBones;
        for (var i = 0; i < rb.length; i++) {
          // 仅对带物理刚体的骨骼做丝滑插值
          if (!rb[i].rigidBodyIndices || rb[i].rigidBodyIndices.length === 0) continue;
          var off = i * 16, wt = mmd.worldTransformMatrices;
          if (!wt) continue;
          var x = wt[off + 12], y = wt[off + 13], z = wt[off + 14];
          if (!rb[i]._smPrev) rb[i]._smPrev = [x, y, z];
          var pv = rb[i]._smPrev;
          var nx = pv[0] + (x - pv[0]) * a, ny = pv[1] + (y - pv[1]) * a, nz = pv[2] + (z - pv[2]) * a;
          wt[off + 12] = nx; wt[off + 13] = ny; wt[off + 14] = nz;
          pv[0] = x; pv[1] = y; pv[2] = z;
        }
      } catch (e) {}
    };
    // 灯光 / 画面立体化(连续滑杆): 轮廓背光强度 + 对比度
    window.__mmd.setLook = function (o) {
      var ok = false;
      if (o && typeof o.rim === 'number' && isFinite(o.rim)) {
        try { rim.intensity = Math.max(0, Math.min(2.5, o.rim)); } catch (e) {}
        ok = true;
      }
      if (o && typeof o.contrast === 'number' && isFinite(o.contrast)) {
        try { scene.imageProcessingConfiguration.contrast = Math.max(0.5, Math.min(2, o.contrast)); } catch (e) {}
        ok = true;
      }
      if (o && typeof o.exposure === 'number' && isFinite(o.exposure)) {
        try { scene.imageProcessingConfiguration.exposure = Math.max(0.2, Math.min(3, o.exposure)); } catch (e) {}
        ok = true;
      }
      if (o && typeof o.shadow === 'number' && isFinite(o.shadow)) {
        window.__mmd._shadowIntensity = o.shadow;
        try { if (shadowGen && shadowGen.setDarkness) { shadowGen.setDarkness(Math.max(0.1, Math.min(1, o.shadow))); } } catch (e) {}
        ok = true;
      }
      return ok;
    };
    // ===== v0.23 SSAO 接触阴影(人物接地/轮廓立体) =====
    // 已并入独立 5 项渲染增强系统(见 fxAces/fxSsao 等)。旧 setSSAO 移除。

    // 灯光(PC级立体布光): 主光 + 补光 + 轮廓背光
    const dir = new DirectionalLight("dir", new Vector3(0.4, -1, 0.3), scene);   // 主光(正前方偏上)
    dir.intensity = 1;
    const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);       // 环境天光
    hemi.intensity = 0.45;
    const rim = new DirectionalLight("rim", new Vector3(-0.35, 0.2, -1), scene);  // 轮廓背光(从背后勾出头发/身形边缘)
    rim.intensity = 0.55;
    const fill = new DirectionalLight("fill", new Vector3(-0.5, 0.1, 0.4), scene);// 侧补光(减弱阴影死黑)
    fill.intensity = 0.25;
    window.__mmd.lights = { dir, hemi, rim, fill };

    // ===== v0.23 渲染增强系统：默认原始卡通，5 项独立可选开关 =====
    // 用户要求：默认一个不选 = 改动前的原始卡通画质；5 项渲染增强各自独立可开/关叠加。
    //   ①  aces      ACES 电影色调映射（根治过曝/电影感色彩）
    //   ②  envlight  环境感灯光（头顶+轮廓光，受光层次立体，替代真反射）
    //   ③  fresnel   菲涅尔边缘光（发丝/轮廓厚涂立体）
    //   ④  ssao      SSAO 接触阴影（人物接地/褶皱加深）
    //   ⑤  specular  柔和光泽（皮肤头发润泽反光）
    // 每项 apply*/revert* 可逆；applyRenderFx(state) 根据状态先还原再逐个套用。
    scene.imageProcessingConfiguration.isEnabled = true;
    var RM_IDC = scene.imageProcessingConfiguration;
    // 默认：原始卡通 = 不派色调映射、对比度/曝光 1.0
    RM_IDC.toneMappingEnabled = false;
    RM_IDC.contrast = 1.0;
    RM_IDC.exposure = 1.0;
    RM_IDC.curvesEnabled = false;
    RM_IDC.vignetteEnabled = false;
    // 灯光默认强度备份(供 eanvlight 开关还原)
    var LIGHT_DEF = { dir: 1.0, hemi: 0.45, rim: 0.55, fill: 0.25 };
    // 渲染增强状态(全关 = 原始卡通)
    var renderFx = { aces: false, envlight: false, fresnel: false, ssao: false, specular: false };

    // ---- ① ACES ----
    function fxAces(on) {
      try {
        RM_IDC.toneMappingEnabled = on;
        if (on) { RM_IDC.toneMappingType = 3; RM_IDC.contrast = 1.1; RM_IDC.exposure = 0.85; }
        else { RM_IDC.toneMappingType = 0; RM_IDC.contrast = 1.0; RM_IDC.exposure = 1.0; }
      } catch (e) {}
    }
    // ---- ② 环境感灯光 ----
    function fxEnvlight(on) {
      try {
        if (on) {  // 强化头顶半球光→环境受光层次 + 主光 + 轮廓背光
          if (hemi) { hemi.direction.set(0, 1, 0); hemi.intensity = 0.85; }
          if (dir) dir.intensity = 1.1;
          if (rim) rim.intensity = 1.5;
          if (fill) fill.intensity = 0.12;
        } else {  // 还原为默认布光(原始卡通)
          if (hemi) { hemi.direction.set(0, 1, 0); hemi.intensity = LIGHT_DEF.hemi; }
          if (dir) dir.intensity = LIGHT_DEF.dir;
          if (rim) rim.intensity = LIGHT_DEF.rim;
          if (fill) fill.intensity = LIGHT_DEF.fill;
        }
      } catch (e) {}
    }
    // ---- ③ 菲涅尔边缘光 ----
    function fxFresnel(on) {
      try {
        // 遍历当前场景模型材质
        var sceneMats = scene.materials || [];
        for (var i = 0; i < sceneMats.length; i++) {
          var m = sceneMats[i];
          if (!m || m.getClassName() !== 'StandardMaterial' || !m.diffuseTexture) continue;
          try {
            if (on) {
              if (m._emissiveFresnelParameters) { m._emissiveFresnelParameters.isEnabled = true; m._emissiveFresnelParameters.bias = 0.5; m._emissiveFresnelParameters.power = 3; }
              else if (m.emissiveColor) m.emissiveColor.set(0.12, 0.12, 0.14);
            } else {
              if (m._emissiveFresnelParameters) m._emissiveFresnelParameters.isEnabled = false;
              else if (m.emissiveColor) m.emissiveColor.scaleInPlace(0);
            }
          } catch (e) {}
        }
      } catch (e) {}
    }
    // ---- ④ SSAO ----
    // ⚠️ ratio=0.5 半分辨率 + 默认 blur 在暗部/接触面会产生明显块状噪点(马赛克) →
    //   调成 ratio=0.8(更高采样分辨率) + 增大模糊半径(平滑噪点), 根治暗处马赛克感。
    // ⚠️⚠️ 关键(2026-08-09 用户反馈): 旧逻辑关闭时只 disabled=true, 没有从 scene 移除 →
    //   SSAO pipeline 的 postProcess/renderTarget 残留污染场景 →
    //   (a) 关闭后阴影处黑色马赛克不消失; (b) 切换活跃相机(进探索)后 SSAO 崩坏 → 画面卡死"点啥没反应"。
    //   修复: 开启才创建, 关闭【彻底 dispose + 从 renderPipelineManager 移除】, 完全还原。
    var ssaoPipeline = null, ssaoToggle = false;
    function fxSsao(on) {
      try {
        if (on) {
          if (!ssaoPipeline) {
            ssaoPipeline = new SSAO2RenderingPipeline("ssao", scene, 0.8, [camera]);
            // 提升采样平滑度, 压制暗部斑块
            try { ssaoPipeline.blurKernelSize = 24; } catch (e) {}
            // ⚠️ 卡通模型脸部是平滑曲面, 默认 totalStrength(≈1.0) 会把细微起伏当成障碍
            //   → 整脸/印堂过度遮蔽发黑。降到 0.45 压掉脸黑, 仍保留接触阴影立体感。
            try { ssaoPipeline.totalStrength = 0.45; } catch (e) {}
            try { ssaoPipeline.radius = 0.9; } catch (e) {}
            try { ssaoPipeline.areaLightApproximation = true; } catch (e) {}
            // 提采样数 + 双边软化: 专治暗部/接触面黑色马赛克噪点(磨平不生硬)
            try { ssaoPipeline.samples = 16; } catch (e) {}
            try { ssaoPipeline.bilateralSamples = 32; } catch (e) {}
            try { ssaoPipeline.bilateralSoften = 0.6; } catch (e) {}
          }
          ssaoPipeline.disabled = false;
          ssaoToggle = true;
        } else {
          _disposeSsao();
        }
      } catch (e) {
        try { if (window.AndroidFile && window.AndroidFile.log) window.AndroidFile.log('ssao fail ' + (e && e.message || e)); } catch (e2) {}
      }
    }
    // 彻底销毁 SSAO pipeline 并从场景渲染链移除(可逆/防泄漏/防污染)
    function _disposeSsao() {
      try {
        if (ssaoPipeline) {
          ssaoPipeline.disabled = true;
          try { if (scene && scene.postProcessRenderPipelineManager && scene.postProcessRenderPipelineManager.removePipeline) scene.postProcessRenderPipelineManager.removePipeline("ssao"); } catch (e) {}
          try { ssaoPipeline.dispose(); } catch (e) {}
          ssaoPipeline = null;
        }
      } catch (e) {}
      ssaoToggle = false;
    }
    // 场景在探索(切活跃相机)前调用: 临时禁用基于相机的 postProcess(SSAO 绑定主 camera, 切走会崩)。
    //   返回一个函数, 退出探索后调用以按用户设置恢复。
    window.__mmd._suspendPostProcess = function () {
      var hadSsao = !!ssaoPipeline && !ssaoPipeline.disabled;
      if (hadSsao) _disposeSsao();   // 切活跃相机前彻底移除(防 SSAO 崩坏)
      return function () { try { if (hadSsao && renderFx.ssao) fxSsao(true); } catch (e) {} };
    };
    // ---- ⑤ 柔和光泽 specular ----
    function fxSpecular(on) {
      try {
        var sceneMats = scene.materials || [];
        for (var i = 0; i < sceneMats.length; i++) {
          var m = sceneMats[i];
          if (!m || m.getClassName() !== 'StandardMaterial' || !m.diffuseTexture) continue;
          try {
            if (on) { if (m.specularColor) m.specularColor.set(0.18, 0.18, 0.20); if (typeof m.specularPower === 'number') m.specularPower = 40; }
            else { if (m.specularColor) m.specularColor.set(0, 0, 0); }  // MMD 默认无高光
          } catch (e) {}
        }
      } catch (e) {}
    }
    // 统一入口: 传入需要设为的 5 项布尔(可只传要改的键), 依状态还原+套用
    window.__mmd.applyRenderFx = function (newFx) {
      if (newFx) for (var k in newFx) if (k in renderFx) renderFx[k] = !!newFx[k];
      fxAces(renderFx.aces);
      fxEnvlight(renderFx.envlight);
      fxFresnel(renderFx.fresnel);
      fxSsao(renderFx.ssao);
      fxSpecular(renderFx.specular);
      return { on: renderFx };
    };
    window.__mmd.getRenderFx = function () { return { aces: renderFx.aces, envlight: renderFx.envlight, fresnel: renderFx.fresnel, ssao: renderFx.ssao, specular: renderFx.specular }; };

    // 贴图采样: 三线性(mipmap)+各向异性过滤 → 靠近看贴图不发糊、斜视角不发虚
    // (采样模式常量: LINEAR=1, BILINEAR=2, TRILINEAR=3)
    var TRILINEAR = 3;
    function applyHighQualityFiltering(tex) {
      if (!tex || !tex.updateSamplingMode) return;
      try {
        tex.updateSamplingMode(TRILINEAR);
        tex.anisotropicFilteringLevel = 8;
      } catch (e) {}
    }
    // 对场景已有贴图生效 + 挂到 __mmd 供新加载模型时调用
    window.__mmd._applyTexFilter = applyHighQualityFiltering;
    if (scene.textures) scene.textures.forEach(applyHighQualityFiltering);

    // 地面
    const ground = CreateGround("ground", { width: 40, height: 40, subdivisions: 2, updatable: false }, scene);
    // 地面材质(可调颜色/透明度)
    const groundMat = new StandardMaterial("groundMat", scene);
    groundMat.diffuseColor = new Color3(0.2, 0.22, 0.26);
    ground.material = groundMat;
    window.__mmd.rimLight = rim;
    window.__mmd.fillLight = fill;

    // ===== 渲染/环境控制接口(灯光+背景+地面+RAY氛围) =====
    // setScene({ dir:0-3主光强度, fill:0-2补光, ambient:0-1环境光,
    //            bg:[r,g,b]背景色, ground:[r,g,b,a]地面色, bloom:0-1泛光强度 })
    window.__mmd.setScene = function (o) {
      if (!o) return;
      if (typeof o.dir === 'number') dir.intensity = Math.max(0, Math.min(3, o.dir));
      if (typeof o.fill === 'number') hemi.intensity = Math.max(0, Math.min(2, o.fill));
      if (typeof o.ambient === 'number') scene.ambientColor = new Color3(o.ambient, o.ambient, o.ambient);
      if (Array.isArray(o.bg)) {
        var bg = o.bg;
        scene.clearColor = new Color4(
          clamp01(bg[0]), clamp01(bg[1]), clamp01(bg[2]), 1
        );
      }
      if (Array.isArray(o.ground)) {
        var g = o.ground;
        groundMat.diffuseColor = new Color3(clamp01(g[0]), clamp01(g[1]), clamp01(g[2]));
        if (g.length > 3) groundMat.alpha = clamp01(g[3]);
      }
      if (typeof o.bloom === 'number') setBloom(o.bloom);
      return scene;
    };
    function clamp01(x) { return Math.max(0, Math.min(1, x)); }

    // Bloom 泛光默认温和开启(0.3): R3-like 柔光氛围, 不过度发糊; 可在设置面板关闭
    setBloom(0.3);

    // 地面接触阴影: 主光投射到地面, 让角色"踩实"不悬浮, 立体感/临场感(R3-like)
    // 用 dir 主光生成阴影, 仅地面接收; 模型 mesh 过多时阴影可能略重, 强度可控
    // ⚠️ 阴影贴图分辨率(2026-08-09): 1024 → 2048, 根治"导出 2160×3840 高清视频时
    //    阴影边缘被放大成明显块状/马赛克"的问题; PCF 使边缘更柔和不锯齿。
    var shadowGen = null;
    var SHADOW_MAP = 2048;
    function setupGroundShadow() {
      try {
        if (!dir || shadowGen) return;
        shadowGen = new ShadowGenerator(SHADOW_MAP, dir);
        shadowGen.usePercentageCloserFiltering = true;
        shadowGen.useBlurExponentialShadowMap = true;
        shadowGen.blurKernel = 24;
        shadowGen.contactHardeningLightSize = 0.05;   // PCF 柔化
        try { shadowGen.setDarkness(0.45); } catch (e) {}
        ground.receiveShadows = true;
        shadowGen.getShadowMap().renderList = [];
        window.__mmd._shadow = shadowGen;
      } catch (e) {
        try { if (window.AndroidFile && window.AndroidFile.log) window.AndroidFile.log('shadow init fail: ' + e); } catch (e2) {}
      }
    }
    setupGroundShadow();
    // 导出开始/结束时 可调阴影质量(可选; 默认已用2048)
    window.__mmd._setShadowQuality = function (size) {
      try { if (shadowGen && shadowGen.getShadowMap && shadowGen.getShadowMap().setMapSize) shadowGen.getShadowMap().setMapSize(size || SHADOW_MAP); } catch (e) {}
    };
    // 新模型加载后把其 mesh 加入阴影投影
    window.__mmd._applyShadowRenderList = function (meshes) {
      var sg = window.__mmd._shadow;
      if (!sg || !sg.getShadowMap() || !meshes) return;
      try {
        meshes.forEach(function (m) {
          if (m && m.castShadows !== false) { m.castShadows = true; sg.getShadowMap().renderList.push(m); }
        });
      } catch (e) {}
    };

    // RAY-like Bloom 泛光(柔和光晕氛围, 可开关/调强度, 0=关)
    var bloomPP = null;
    function setBloom(strength) {
      if (strength <= 0) {
        if (bloomPP) { bloomPP.dispose(); bloomPP = null; }
        return;
      }
      if (!bloomPP) {
        var bl = new GlowLayer("bloom", scene);
        bl.intensity = Math.min(1, strength);
        bloomPP = bl;
      } else {
        bloomPP.intensity = Math.min(1, strength);
      }
    }

    // ===== 渲染模式(模型质感): 默认卡通 / 类RAY光泽 =====
    // 类RAY光泽 = 程序化柔光环境反射 + 模型 sphere 高光 + 材质光泽,
    //   让皮肤/头发/衣服更油润立体(近似 ray-mmd 的光泽气质), 可一键切换回原版平涂卡通。
    var glossEnv = null;          // 程序化环境立方体贴图(类RAY光泽时用)
    var curRenderMode = 'default';
    // 默认灯光强度快照(光泽模式会微调主光, 退回默认时还原)
    var RM_DEF_DIR = dir.intensity, RM_DEF_HEMI = hemi.intensity;

    function makeGlossEnv() {
      if (glossEnv) return glossEnv;
      var SIZE = 64;
      function mkF(v) { var b = new Uint8Array(SIZE * SIZE * 4); for (var i = 0; i < SIZE * SIZE; i++) { b[i*4]=v; b[i*4+1]=v; b[i*4+2]=v; b[i*4+3]=255; } return b; }
      // 6面对应 +X,-X,+Y,-Y,+Z,-Z; 顶部亮(柔光主源), 四周中亮, 底部暗
      // 顶面别太高(会反射过曝发白), 用柔和梯度
      var faces = [mkF(110), mkF(95), mkF(170), mkF(50), mkF(130), mkF(95)];
      try { glossEnv = engine.createRawCubeTexture(faces, SIZE, 5, 0, true, false, 3, null); } catch (e) { glossEnv = null; }
      return glossEnv;
    }

    // 对单个材质应用/还原 类RAY光泽
    // ⚠️ v0.21.6 两次教训:
    //  (1) 之前按 MmdStandardMaterial 特有属性(ignoreDiffuseWhenToonTextureIsNull)过滤,
    //      但实际加载的材质是 StandardMaterial(无该属性) → specular/sphere 一直没生效,
    //      画面变化只来自"灯光+环境贴图增强", 调高就发白 → 你看着"差别不大又很白"。
    //  (2) 正确做法: 对 StandardMaterial 用 specularColor/specularPower 出集中高光。
    //      灯光/环境保持温和, 靠 specular 本身而非整体提亮。
    var GLOSS_SPEC = [0.12, 0.10, 0.09];   // 弱暖色高光点缀(只出现在受光面高光点, 不整片泛白)
    var GLOSS_POWER = 60;                   // 很高 → 极小高光点, 更立体不泛白
    function applyGlossToMat(m) {
      if (!m || typeof m.getClassName !== 'function') return;
      if (m.getClassName() !== 'StandardMaterial') return;
      try {
        if (m.specularColor) m.specularColor.set(GLOSS_SPEC[0], GLOSS_SPEC[1], GLOSS_SPEC[2]);
        if (typeof m.specularPower === 'number') m.specularPower = GLOSS_POWER;
        // sphere 贴图(部分材质有): 只给极弱的油润水光, 绝不叠加成白
        if (m.sphereTexture && m.sphereTextureAdditiveColor) {
          m.sphereTextureBlendMode = 2;   // Add
          m.sphereTextureAdditiveColor.set(0.05, 0.05, 0.05, 1);
        }
      } catch (e) {}
    }
    function clearGlossFromMat(m) {
      if (!m || typeof m.getClassName !== 'function') return;
      if (m.getClassName() !== 'StandardMaterial') return;
      try {
        if (m.specularColor) m.specularColor.set(0, 0, 0);   // 还原 MMD 平涂
        if (typeof m.specularPower === 'number') m.specularPower = 0;
        if (m.sphereTexture && m.sphereTextureAdditiveColor) m.sphereTextureAdditiveColor.set(0, 0, 0, 1);
      } catch (e) {}
    }
    // 应用到场景里全部已加载的 Mmd 材质
    function applyGlossToAll(on) {
      var fn = on ? applyGlossToMat : clearGlossFromMat;
      try { (scene.materials || []).forEach(function (m) { fn(m); }); } catch (e) {}
    }

    // 渲染模式切换入口(供设置面板/AI调用)
    window.__mmd.setRenderMode = function (mode) {
      var on = (mode === 'gloss');
      curRenderMode = on ? 'gloss' : 'default';
      try {
        if (on) {
          // ⚠️ v0.21.6 方向修正: "类RAY光泽" = 立体感(明暗对比), 不是镜子反光。
          //   之前加环境反射(scene.environmentTexture)把暗部也提亮 → 人物发白/抹平立体。
          //   改为: 去掉环境反射, 拉开灯光明暗对比 + 强化轮廓背光 → 受光面亮/背光面暗, 立体。
          scene.environmentTexture = null;
          scene.environmentIntensity = 1;
          // 注意: 之前 dir 也增强(×1.35) → 亮色衣服受光面直接过曝变白。
          // 立体感靠"压暗补光"而不是"抬高主光" → 亮面不会被推到255, 不泛白。
          dir.intensity = RM_DEF_DIR;                                    // 主光保持默认(不过曝)
          hemi.intensity = Math.max(0.24, (RM_DEF_HEMI || 0.45) * 0.55);  // 天光明显压暗 → 暗部立体
          rim.intensity = Math.min(1.3, rim.intensity * 1.7);            // 轮廓背光增强 → 边缘立体
          applyGlossToAll(true);   // 弱 specular 点缀受光面
        } else {
          scene.environmentTexture = null;
          scene.environmentIntensity = 1;
          dir.intensity = RM_DEF_DIR;
          hemi.intensity = RM_DEF_HEMI;
          rim.intensity = Math.min(1.2, rim.intensity / 1.6);
          applyGlossToAll(false);
        }
      } catch (e) {}
      window.__mmd._renderMode = curRenderMode;
      return curRenderMode;
    };
    window.__mmd.getRenderMode = function () { return curRenderMode; };
    // 新模型加载后按当前模式补应用光泽(供 loadAndPlay hook)
    window.__mmd._applyRenderModeToModel = function (container) {
      if (curRenderMode !== 'gloss') return;
      try { (container.materials || []).forEach(applyGlossToMat); } catch (e) {}
    };

    // ===== v0.23 渲染增强: 菲涅尔边缘光 + 轻微镜面质感(真发改渲染, 非调参预设) =====
    // 给模型材质加菲涅尔参数 → 从边缘看更亮(轮廓厚涂/发丝发光感) + specular 微高光(受光面油润)。
    // 相比"调灯光强度", 这是直接改材质渲染行为, 让卡通模型有体积感和立体边缘。
    window.__mmd._applyRenderEnhance = function (container) {
      // 新模型加载后: 按当前渲染增强开关状态, 对新模型材质套用菲涅尔/光泽(若已开启)。
      // (与 applyRenderFx 走同一套 fxFresnel/fxSpecular 逻辑, 保证一致性)
      try {
        if (renderFx.fresnel) fxFresnel(true);
        if (renderFx.specular) fxSpecular(true);
      } catch (e) {}
    };
    window.__mmd.dirLight = dir;
    window.__mmd.hemiLight = hemi;
    window.__mmd.ground = ground;

    status.textContent = "[1/4] 加载物理 & MMD运行时 ...";

    // 单线程 release Bullet 物理实例(内建裙摆刚体/约束/IK)
    // ⚠️ v0.21.9 健壮性: 若物理 wasm 加载失败(沙箱/低端环境/跨源受限), 降级为"无物理"
    //   (MMD 模型无裙摆物理, 但加载/动画/相机/探索全部照常可玩), 而不是整个应用白屏中断。
    let mmdWasmInstance = null, physicsRuntime = null;
    try {
      mmdWasmInstance = await GetMmdWasmInstance(new MmdWasmInstanceTypeSPR(), 1);
      physicsRuntime = new MultiPhysicsRuntime(mmdWasmInstance);
      physicsRuntime.register(scene);
      window.__mmd.physicsRuntime = physicsRuntime;
      window.__mmd.wasmInstance = mmdWasmInstance;
    } catch (ePhys) {
      mmdWasmInstance = null; physicsRuntime = null;
      try { if (window.AndroidFile && window.AndroidFile.log) window.AndroidFile.log('physics disabled: ' + (ePhys && ePhys.message || '')); } catch (e2) {}
    }
    status.textContent = physicsRuntime ? "[2/4] 加载 MMD 运行时(含裙摆物理) ..." : "[2/4] 加载 MMD 运行时(物理降级:无裙摆) ...";

    const mmdRuntime = physicsRuntime ? new MmdRuntime(scene, new MmdBulletPhysics(physicsRuntime)) : new MmdRuntime(scene, null);
    mmdRuntime.register(scene);

    // 应用默认布料手感(此时 physicsRuntime/mmdRuntime 已就绪, setFabric 才能访问到 physicsRuntime)
    if (window.__mmd.setFabric) { try { window.__mmd.setFabric('柔顺'); } catch (eFab) {} }

    const statusEl = status;
    // 不再内置默认模型/动作(用户在自己文件夹里选, 省 APK 体积)。
    let currentModelPath = null;
    let defaultMotionPath = null;
    let mmdModel = null;
    let loadedMesh = null;
    // ===== 多模型支持: modelList 承载所有已加载模型; mmdModel/loadedMesh 是"当前选中"的别名 =====
    // 每个元素: { mmdModel, mesh, path, name }
    var modelList = [];
    var activeModelIdx = -1;   // 当前选中/操作的模型下标(-1=无)
    function activeModel() { return activeModelIdx >= 0 && activeModelIdx < modelList.length ? modelList[activeModelIdx] : null; }
    function syncActiveAliases() {
      var am = activeModel();
      mmdModel = am ? am.mmdModel : null;
      loadedMesh = am ? am.mesh : null;
      currentModelPath = am ? am.path : null;
      window.__mmd.mmdModel = mmdModel;
      if (am) { try { var s0=String(am.path).split('/'); currentLoads.model = s0[s0.length-1]; } catch(e){} }
      else { currentLoads.model = null; }
    }
    function setActiveModel(idx) {
      if (idx < 0 || idx >= modelList.length) return false;
      // 先把当前 active 模型的动画状态存回它自己
      var old = activeModel();
      if (old) { old.ms = { bone: motionState.bone, morph: motionState.morph, camera: motionState.camera, animHandle: window.__mmd._modelAnimHandle, motionName: currentLoads.motion, morphName: currentLoads.morph, cameraName: currentLoads.camera }; }
      activeModelIdx = idx; syncActiveAliases();
      // 恢复新 active 模型自己的动画状态
      var nc = modelList[idx];
      if (nc && nc.ms) {
        motionState.bone = nc.ms.bone; motionState.morph = nc.ms.morph; motionState.camera = nc.ms.camera;
        window.__mmd._modelAnimHandle = nc.ms.animHandle;
        // 同步 Scene Info 显示名(与动画状态一致)
        currentLoads.motion = nc.ms.motionName || null;
        currentLoads.morph = nc.ms.morphName || null;
        currentLoads.camera = nc.ms.cameraName || null;
      } else {
        motionState.bone = null; motionState.morph = null; motionState.camera = null;
        window.__mmd._modelAnimHandle = null;
        currentLoads.motion = null; currentLoads.morph = null; currentLoads.camera = null;
      }
      try { applyMotionsToModel(); } catch (e) {}
      return true;
    }

    // ===== 删除模型: 从场景卸载并移出 modelList =====
    // 返回 { ok, count, name }。删除 active 时自动切到相邻模型, 并恢复该模型的动画状态。
    function removeModel(idxOrName) {
      if (!modelList.length) return { ok:false, error:'no model' };
      var idx = -1;
      if (typeof idxOrName === 'number') idx = idxOrName;
      else if (typeof idxOrName === 'string') { for (var i=0;i<modelList.length;i++) if (modelList[i].name === idxOrName) { idx = i; break; } }
      else idx = activeModelIdx;   // 默认删 active
      if (idx < 0 || idx >= modelList.length) return { ok:false, error:'bad idx' };
      var removed = modelList[idx];
      var wasActive = (idx === activeModelIdx);
      // 释放被删模型(scene 中卸载)
      try { if (window.__mmd.mmdRuntime && removed.mmdModel && window.__mmd.mmdRuntime.destroyMmdModel) window.__mmd.mmdRuntime.destroyMmdModel(removed.mmdModel); } catch (e) {}
      try { if (removed.mesh && removed.mesh.dispose) removed.mesh.dispose(); } catch (e) {}
      modelList.splice(idx, 1);
      // 修正 active 索引, 并正确恢复新 active 模型的动画状态
      if (modelList.length === 0) {
        activeModelIdx = -1;
        // 全删空: 清空全部动画轨道(防止残留引用到已销毁对象)
        motionState.bone = null; motionState.morph = null; motionState.camera = null;
        window.__mmd._modelAnimHandle = null;
        currentLoads.model = null; currentLoads.motion = null; currentLoads.morph = null; currentLoads.camera = null;
      } else {
        var newIdx;
        if (wasActive) newIdx = Math.min(idx, modelList.length - 1);   // 删除 active 自身 → 切相邻
        else if (activeModelIdx > idx) newIdx = activeModelIdx - 1;    // 删 active 之前的模型 → 索引前移
        else newIdx = activeModelIdx;                                  // 删 active 之后的模型 → active 不变
        activeModelIdx = newIdx;
        if (wasActive) {
          // ⚠️ 被删 active 的动画轨道已随模型销毁 → 先清空, 再恢复相邻模型自己的 .ms(防残留套错模型)
          motionState.bone = null; motionState.morph = null; motionState.camera = null;
          window.__mmd._modelAnimHandle = null;
          currentLoads.motion = null; currentLoads.morph = null; currentLoads.camera = null;
          var nm = modelList[newIdx];
          if (nm && nm.ms) {
            motionState.bone = nm.ms.bone; motionState.morph = nm.ms.morph; motionState.camera = nm.ms.camera;
            window.__mmd._modelAnimHandle = nm.ms.animHandle;
            currentLoads.motion = nm.ms.motionName || null;
            currentLoads.morph = nm.ms.morphName || null;
            currentLoads.camera = nm.ms.cameraName || null;
          }
        }
        // 非 active 删除(不管在 active 前/后): 当前 active 没变, motionState 本就属于它, 无需清。
      }
      syncActiveAliases();
      window.__mmd._activeModelIdx = activeModelIdx;
      window.__mmd._modelCount = modelList.length;
      try { applyMotionsToModel(); } catch (e) {}
      return { ok:true, count: modelList.length, name: (removed && removed.name) || '' };
    }

    // ===== 三件套(动作/表情/相机)管理: 分别挂、共用同一时间轴(_currentFrameTime) =====
    var motionState = { bone: null, morph: null, camera: null };   // 存各轨道的 MmdAnimation(bindable)
    // 当前已加载内容的【显示名】(Scene Information 用; name 为空表示该轨道未加载)
    var currentLoads = { model: null, motion: null, morph: null, camera: null, scene: null, bgm: null };
    let mmdCamNode = null;                                          // MMD 相机节点(承接 相机.vmd)

    function ensureMmdCam() {
      if (!mmdCamNode) {
        mmdCamNode = new MmdCamera("mmdCam", new Vector3(0, 10, 0), scene);
        window.__mmd.mmdCam = mmdCamNode;
        // 必须注册为 runtime animatable, 否则相机动画不会被 _currentFrameTime 驱动/同步
        try {
          if (window.__mmd.mmdRuntime && window.__mmd.mmdRuntime.addAnimatable) {
            window.__mmd.mmdRuntime.addAnimatable(mmdCamNode);
          }
        } catch (e) { try { if (window.AndroidFile && window.AndroidFile.log) window.AndroidFile.log('addAnimatable cam err '+e); } catch (e2) {} }
      }
      return mmdCamNode;
    }

    /** VMD 属于哪种: 骨骼/表情/相机(用帧计数判断, 不依赖文件名). */
    function animKind(anim) {
      var bone = 0, morph = 0, cam = 0;
      try {
        if (anim.boneTracks) for (var i = 0; i < anim.boneTracks.length; i++) bone += (anim.boneTracks[i].boneFrames || []).length;
        if (anim.morphTracks) for (var j = 0; j < anim.morphTracks.length; j++) morph += (anim.morphTracks[j].morphFrames || []).length;
        if (anim.cameraTrack && anim.cameraTrack.cameraFrames) cam = anim.cameraTrack.cameraFrames.length;
      } catch (e) {}
      return { bone: bone, morph: morph, cam: cam };
    }

    /** 重新组装模型的复合动画(骨骼+表情叠加), 挂回模型. */
    function applyMotionsToModel() {
      if (!mmdModel) return;
      try {
        // 清理旧的模型动画(先移除再 dispose, 防泄漏)
        var old = window.__mmd._modelAnimHandle;
        if (old) {
          try { mmdModel.setRuntimeAnimation(null); } catch (e) {}
          try { old.dispose && old.dispose(); } catch (e) {}
          window.__mmd._modelAnimHandle = null;
        }
        if (!motionState.bone && !motionState.morph) { return; }
        var comp = new MmdCompositeAnimation("mmd-dance");
        if (motionState.bone) comp.addSpan(new MmdAnimationSpan(motionState.bone));
        if (motionState.morph) comp.addSpan(new MmdAnimationSpan(motionState.morph));
        var handle = MmdCompositeRuntimeModelAnimation.Create(comp, mmdModel);
        mmdModel.setRuntimeAnimation(handle);
        window.__mmd._modelAnimHandle = handle;
      } catch (e) {
        // 兜底: composite 失败则退化为单动画(以当前骨骼或表情为准)
        try {
          var single = motionState.bone || motionState.morph;
          if (single) { var h = mmdModel.createRuntimeAnimation(single); mmdModel.setRuntimeAnimation(h); window.__mmd._modelAnimHandle = h; }
        } catch (e2) {}
      }
    }

    /** 加载一个外部 vmd 并按类型挂到对应轨道(动作/表情/相机). url 可选. */
    async function loadMotionTrack(url, track) {
      if (!url) return { ok: false, error: "no url" };
      statusEl.textContent = "[加载" + (track === 'bone' ? '动作' : track === 'morph' ? '表情' : '相机') + "] " + url;
      try {
        var vmd = new VmdLoader(scene);
        var anim = await vmd.loadAsync("motion", url);
        var kind = animKind(anim);
        var fname = url; try { var s = String(url).split('/'); fname = s[s.length-1]; } catch (e) {}
        if (track === 'camera' || (!track && kind.cam > 0)) {
          // 相机轨道(独立于模型轨道)
          var cam = ensureMmdCam();
          try { cam.setRuntimeAnimation(null); } catch (e) {}
          var ch = cam.createRuntimeAnimation(anim);
          cam.setRuntimeAnimation(ch);
          motionState.camera = anim;
          currentLoads.camera = fname;
          // 切换到 MMD 相机视角
          scene.activeCamera = cam;
          window.__mmd.usingMmdCam = true;
          statusEl.textContent = "[相机] " + url;
          return { ok: true, kind: 'camera' };
        }
        // 模型轨道: 按实际内容归到 动作(骨骼)/表情(morph)
        if (track === 'morph' || (!track && kind.bone === 0 && kind.morph > 0)) {
          motionState.morph = anim;
          currentLoads.morph = fname;
        } else if (track === 'bone' || (!track && kind.bone > 0)) {
          motionState.bone = anim;
          currentLoads.motion = fname;
        }
        applyMotionsToModel();
        window.__mmd._absT0 = undefined;   // 重新标定时间轴起点(不动已播放进度)
        window.__mmd._userPaused = false; window.__mmd._ended = false;   // 换动作回到播放态
        statusEl.textContent = "[动作] " + url;
        return { ok: true, kind: kind.bone > 0 ? (kind.morph > 0 ? 'both' : 'bone') : 'morph' };
      } catch (e) {
        statusEl.textContent = "[加载失败] " + (e && e.message || e);
        try { if (window.AndroidFile && window.AndroidFile.log) window.AndroidFile.log('loadMotionTrack fail: ' + (e && e.message || e)); } catch (e3) {}
        return { ok: false, error: (e && e.message) || String(e) };
      }
    }

    /** 切换回自由手动镜头(取消相机.vmd). */
    function useFreeCamera() {
      if (window.__mmd.usingMmdCam) {
        try { mmdCamNode && mmdCamNode.setRuntimeAnimation(null); } catch (e) {}
        scene.activeCamera = camera;   // 外层 ArcRotateCamera
        window.__mmd.usingMmdCam = false;
        window.__mmd.mmdCamActive = false;
      }
    }

    // ===== 可复用: 加载模型+动作(支持运行时切换) =====
    async function loadAndPlay(modelPath, motionPath) {
      if (!modelPath) { statusEl.textContent = "[请先选择模型]"; return { ok: false, error: "no model path" }; }
      // 先加载新模型, 成功后再 dispose 旧的(加载失败保留现有画面, 避免"连默认模型都消失")
      let newMesh = null, newMmdModel = null;
      try {
        statusEl.textContent = "[加载模型] " + modelPath;
        const container = await LoadAssetContainerAsync(modelPath, scene);
        container.addAllToScene();
        // 对刚加载的模型贴图应用高质量过滤(三线性+各向异性) → 清晰不糊
        if (window.__mmd._applyTexFilter) {
          try { (container.textures || []).forEach(window.__mmd._applyTexFilter); } catch (e) {}
        }
        // 把新模型 mesh 加入投影 → 地面接触阴影(踩实不悬浮)
        if (window.__mmd._applyShadowRenderList) {
          try { window.__mmd._applyShadowRenderList(container.meshes || []); } catch (e) {}
        }
        // 按当前渲染模式补应用光泽(若切到"类RAY光泽")
        if (window.__mmd._applyRenderModeToModel) {
          try { window.__mmd._applyRenderModeToModel(container); } catch (e) {}
        }
        // v0.23 渲染增强: 菲涅尔边缘光 + 镜面质感(改材质渲染行为, 立体厚涂感)
        if (window.__mmd._applyRenderEnhance) {
          try { window.__mmd._applyRenderEnhance(container); } catch (e) {}
        }
        newMesh = container.meshes[0];
        newMmdModel = mmdRuntime.createMmdModel(newMesh, { materialProxyConstructor: MmdStandardMaterialProxy });

        // 多模型: 追加到 modelList(不 dispose 旧的), 新模型设为"选中"
        engine.stopRenderLoop();
        // 切换 active 前, 先把当前选中模型的动画状态存回它自己(否则切走后丢失)
        var _prevActive = activeModel();
        if (_prevActive) { _prevActive.ms = { bone: motionState.bone, morph: motionState.morph, camera: motionState.camera, animHandle: window.__mmd._modelAnimHandle, motionName: currentLoads.motion, morphName: currentLoads.morph, cameraName: currentLoads.camera }; }
        var mname2 = modelPath; try { var ms2 = String(modelPath).split('/'); mname2 = ms2[ms2.length-1]; } catch (e) {}
        modelList.push({ mmdModel: newMmdModel, mesh: newMesh, path: modelPath, name: mname2 });
        activeModelIdx = modelList.length - 1;
        loadedMesh = newMesh;
        mmdModel = newMmdModel;
        currentModelPath = modelPath;
        currentLoads.model = mname2;
        window.__mmd.mmdModel = mmdModel;

        // 重置本模型三件套轨道(共用时间轴, 但同一模型换装时刷新)
        motionState.bone = null; motionState.morph = null; motionState.camera = null;
        window.__mmd._modelAnimHandle = null;
        // 新模型默认无动作/表情/相机(除非下面传入 motionPath 再挂)
        currentLoads.motion = null; currentLoads.morph = null; currentLoads.camera = null;
        window.__mmd._activeModelIdx = activeModelIdx;
        window.__mmd._modelCount = modelList.length;

        if (motionPath) {   // 首次 loadAndPlay 带默认动作 → 按内容归轨道
          if (typeof motionPath === 'string' || (motionPath && motionPath.length > 0)) {
            var u = typeof motionPath === 'string' ? motionPath : null;
            await loadMotionTrack(u || (Array.isArray(motionPath) ? motionPath[0] : motionPath), null);
          }
        }

        window.__mmd._absT0 = undefined;   // 速度绝对时间重新标定
        window.__mmd._userPaused = false; window.__mmd._ended = false;
        statusEl.textContent = "[播放中] " + modelPath;
        engine.runRenderLoop(renderFrame);
        return { ok: true, name: modelPath };
      } catch (e) {
        try { engine.runRenderLoop(renderFrame); } catch (e2) {}
        statusEl.textContent = "[加载失败] " + (e && e.message || e);
        // 原生日志, 定位外部模型加载失败原因
        try { if (window.AndroidFile && window.AndroidFile.log) window.AndroidFile.log('loadAndPlay fail: ' + (e && e.message || e)); } catch (e3) {}
        return { ok: false, error: (e && e.message) || String(e) };
      }
    }

    // 暴露 mmdRuntime(export.js 依赖它读动画状态)
    window.__mmd.mmdRuntime = mmdRuntime;

    // ===== 场景背景: 加载 .glb/.gltf 换成跳舞背景(PMX 模型保留) =====
    // 用一个模块级数组维护当前已加载的场景容器, 切场景时先释放旧的, 避免背景叠加。
    // loadScene(url) — url 为 http://mmdext/场景/xxx.glb 等完整地址(与模型同走原生文件桥代理)。
    var sceneContainers = [];   // 当前场景已加载的 AssetContainer(仅场景背景用; 不含 PMX)
    window.__mmd.sceneContainers = sceneContainers;
    var skyMeshes = [];         // 当前场景中被识别为"天空/超大球"的 mesh(可一键隐藏/显示)
    var _skyIgnore = true;      // 默认忽略场景里的白色大球/天空球
    window.__mmd.getSkySphereIgnore = function () { return _skyIgnore; };

    // 从已加载场景中识别"天空球/超大背景球体": 名称含 天空/天球/sky 关键词, 或尺寸异常巨大的球。
    // 识别后统一记入 skyMeshes 供开关隐藏/显示(解决"场景外围白色大球包裹挡住视角")。
    function scanSkyMeshes(container) {
      if (!container || !container.meshes) return [];
      const found = [];
      const meshes = container.meshes;
      // 1) 名称关键词(最可靠)
      const kw = /天空|天球|sky|sphere_bg|背景球/i;
      for (let i = 0; i < meshes.length; i++) {
        const m = meshes[i];
        if (!m || m.isDisposed()) continue;
        const n = (m.name || '') + ' ' + (m.parent ? (m.parent.name || '') : '');
        if (kw.test(n)) found.push(m);
      }
      // 2) 尺寸兜底: 找出所有非无限大 mesh 的包围球半径, 若最大半径远超场景尺度则视为背景大球
      if (found.length === 0) {
        let best = null, bestR = 120;   // 半径阈值: 人物约几~十几, 室内<30, 天空球通常>120
        for (let i = 0; i < meshes.length; i++) {
          const m = meshes[i];
          if (!m || m.isDisposed()) continue;
          try {
            const r = m.getBoundingInfo().boundingSphere.radiusWorld;
            if (!isFinite(r)) continue;
            if (r > bestR) { bestR = r; best = m; }
          } catch (e) {}
        }
        if (best) found.push(best);
      }
      return found;
    }
    window.__mmd.scanSkyMeshes = scanSkyMeshes;

    // 切换"忽略天空球": on=true 隐藏标记的大球; false 恢复显示。
    window.__mmd.setSkySphereIgnore = function (on) {
      _skyIgnore = !!on;
      for (let i = 0; i < skyMeshes.length; i++) {
        try { if (skyMeshes[i] && !skyMeshes[i].isDisposed()) skyMeshes[i].setEnabled(!_skyIgnore); } catch (e) {}
      }
      return _skyIgnore;
    };
    window.__mmd.loadScene = async function (url) {
      if (!url) { statusEl.textContent = "[场景] 未提供文件"; return { ok: false, error: "no url" }; }
      try {
        statusEl.textContent = "[加载场景] " + url;
        // 先加载新的, 成功后再释放旧的(加载失败保留现有场景, 不闪空)
        const container = await LoadAssetContainerAsync(url, scene);
        container.addAllToScene();
        // 场景 mesh 也享受高质量贴图过滤(三线性+各向异性 → 清晰不糊)
        if (window.__mmd._applyTexFilter) {
          try { (container.textures || []).forEach(window.__mmd._applyTexFilter); } catch (e) {}
        }
        // 场景 mesh 计入接触阴影(阴影落到背景地面, 人物更"实")
        if (window.__mmd._applyShadowRenderList) {
          try { window.__mmd._applyShadowRenderList(container.meshes || []); } catch (e) {}
        }
        // 识别并(可选)隐藏天空球: 解决场景外围白色大球包裹挡住视角
        skyMeshes = scanSkyMeshes(container);
        if (_skyIgnore) {
          for (let i = 0; i < skyMeshes.length; i++) {
            try { if (skyMeshes[i] && !skyMeshes[i].isDisposed()) skyMeshes[i].setEnabled(false); } catch (e) {}
          }
        }
        // 释放旧的场景容器(重复加载/切场景时)
        for (let i = 0; i < sceneContainers.length; i++) {
          try { if (sceneContainers[i] && sceneContainers[i].dispose) sceneContainers[i].dispose(); } catch (e) {}
        }
        sceneContainers.length = 0;
        sceneContainers.push(container);
        window.__mmd.currentScenePath = url;
        try { var ss = String(url).split('/'); currentLoads.scene = ss[ss.length-1]; } catch (e) {}
        statusEl.textContent = "[场景] 已加载 " + url;
        return { ok: true, name: url };
      } catch (e) {
        statusEl.textContent = "[场景加载失败] " + (e && e.message || e);
        try { if (window.AndroidFile && window.AndroidFile.log) window.AndroidFile.log('loadScene fail: ' + (e && e.message || e)); } catch (e3) {}
        return { ok: false, error: (e && e.message) || String(e) };
      }
    };
    // 清空已加载的场景背景(回到纯色地面状态)
    window.__mmd.clearScene = function () {
      for (let i = 0; i < sceneContainers.length; i++) {
        try { if (sceneContainers[i] && sceneContainers[i].dispose) sceneContainers[i].dispose(); } catch (e) {}
      }
      sceneContainers.length = 0;
      window.__mmd.currentScenePath = null;
      statusEl.textContent = "[场景] 已清空";
    };

    // ===== 自由探索模式(第一人称视角) =====
    // 需求: ①第一人称视角、低眼位 ②任意方向移动/飞行(z轴等) ③可站地面 ④穿墙/不穿墙切换
    //      ⑤横竖屏都可 ⑥左手摇杆移动、右半屏拖拽转视角 ⑦进入隐藏UI、有退出按钮
    //      ⑧保留已加载的模型场景, 近距离环绕观察环境
    var expCamera = null;          // 探索相机(独立 UniversalCamera, v0.21.9 起不复用主 ArcRotateCamera, 根治自转)
    var expActive = false;         // 是否处于探索模式
    var expRenderObs = null;       // 单例探索 observer(循环复用, 避免重复 add/remove 失效累积)
    var expLastT = null;           // 探索 observer 的时间戳
    var expEyeH = 0.05;            // 低眼位(贴近地面, 第一人称沉浸感)
    var expWalkSpeed = 0.03;       // 行走速度 m/s(慢速, 适合近距离观察)
    var expFlySpeed = 0.09;        // 飞行速度 m/s(行走×3)
    var expSpeed = expWalkSpeed;   // 实际使用的行走速度
    var expSens = 1.0;             // 探索视角灵敏度(转动系数, 0.2~4, 默认1; 越大转越快) v0.21.10+回溯补回
    var expFlying = false;         // 是否在飞行(浮空移动)
    var expNoClip = false;         // 穿墙开关(默认不穿墙, 有碰撞)
    var expInput = { moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0, vert: 0 };  // 每帧输入(UI写入)
    // ===== 探索诊断(结构化, 便于定位黑屏/自转/方向/不动) =====
    var expDbgFrame = 0;
    var expDbgLastT = 0;           // 上次打摘要的墙钟
    var expDbgBaseYaw = null;      // 本轮摘要开始时 yaw(用于无输入时检测自转)
    var expDbgNoInputT = 0;        // 连续无输入(转向)的累计时间
    function expLog(msg) {
      try { if (window.AndroidFile && window.AndroidFile.log) window.AndroidFile.log('[exp] ' + msg); } catch (e) {}
    }
    // 方向自检: 进入探索时把相机实测的 前/右/上 世界方向打出来, 立即暴露方向约定对错(不靠用户反馈反了再猜)
    function expDumpDir(tag, c) {
      try {
        var f = c.getDirection(new Vector3(0,0,1)), r = c.getDirection(new Vector3(1,0,0)), u = c.getDirection(new Vector3(0,1,0));
        expLog(tag + ' dir f=('+f.x.toFixed(2)+','+f.y.toFixed(2)+','+f.z.toFixed(2)+') r=('+r.x.toFixed(2)+','+r.y.toFixed(2)+','+r.z.toFixed(2)+') u=('+u.x.toFixed(2)+','+u.y.toFixed(2)+','+u.z.toFixed(2)+') rot=('+c.rotation.x.toFixed(3)+','+c.rotation.y.toFixed(3)+')\n  => 判读: 面朝+Z且上+Y且右正确时 手动对照 期望(前0,0,1/右1,0,0/上0,1,0)');
      } catch (e) { expLog('expDumpDir err ' + (e&&e.message||e)); }
    }
    // 每秒摘要: 位置/朝向/输入/是否在无输入时自转
    function expSummary() {
      var c = expCamera; if (!c) return;
      var now = performance.now();
      var hasInput = (expInput.lookDX !== 0 || expInput.lookDY !== 0 || expInput.moveX !== 0 || expInput.moveZ !== 0);
      if (expDbgBaseYaw === null) { expDbgBaseYaw = c.rotation.y; expDbgNoInputT = 0; }
      var yawDrift = (c.rotation.y - expDbgBaseYaw);
      var driftDeg = (yawDrift * 180 / Math.PI);
      expLog('每秒 pos=(' + c.position.x.toFixed(2) + ',' + c.position.y.toFixed(2) + ',' + c.position.z.toFixed(2)
        + ') yawDeg=' + (c.rotation.y * 180 / Math.PI).toFixed(1)
        + ' pitchDeg=' + (c.rotation.x * 180 / Math.PI).toFixed(1)
        + ' input{mx=' + expInput.moveX + ',mz=' + expInput.moveZ + ',ldx=' + expInput.lookDX + ',ldy=' + expInput.lookDY + '}'
        + (hasInput ? ' [手在输入]' : (Math.abs(driftDeg) > 5 ? ' [⚠️自转!无输入yaw变了' + driftDeg.toFixed(1) + '°]' : ' [无输入·yaw稳定]')));
      expDbgBaseYaw = c.rotation.y;
      expDbgNoInputT = 0;
    }

    // 向下射线找地面高度(用于站立): 用 scene.pickWithRay(引擎内置, 单次选择最近 mesh, 高效且不扰动网格)
    function expGroundY(x, y, z) {
      try {
        var origin = new Vector3(x, y, z);
        var ray = new Ray(origin, new Vector3(0, -1, 0), 500);
        var hit = scene.pickWithRay(ray, function(m) {
          // 只检测场景/模型 mesh, 排除光源/相机/ground 等无关项
          return m && m.isEnabled && m.isVisible && m.renderingGroupId === 0;
        });
        if (hit && hit.pickedPoint) return hit.pickedPoint.y;
      } catch (e) {}
      return null;
    }

    // 前进方向是否撞墙(不穿墙时用): 用 scene.pickWithRay
    function expCollideDist(pos, moveVec) {
      if (expNoClip) return 1;   // 穿墙: 全放行
      try {
        var len = moveVec.length();
        if (len < 0.0001) return 1;
        var ray = new Ray(pos, moveVec.clone().normalize(), len + 0.2);
        var hit = scene.pickWithRay(ray, function(m) {
          return m && m.isEnabled && m.isVisible && m.renderingGroupId === 0;
        });
        if (hit && hit.pickedPoint) {
          var d = Vector3.Distance(pos, hit.pickedPoint);
          var t = Math.max(0, (d - 0.1) / len);
          return t;
        }
      } catch (e) {}
      return 1;
    }

    // 每帧更新探索相机(由探索专用 render loop 或 Observer 调用)
    // ⚠️ v0.21.9 改用【独立 UniversalCamera】(第一人称正交相机):
    //   UniversalCamera 只有 position + rotation(yaw/pitch), 没有 ArcRotateCamera 的
    //   alpha/beta/radius/target"绕点旋转"机制 + 内置 PointerInput → 不会发生"视角自转"。
    //   这是对"真机高帧率下 ArcRotate 复用方案仍转圈"的根治(ArcRotate 复用 + detach/inertia/
    //   _expYaw 覆盖 多次修都压不住, 根因是该相机类型的轨道旋转机制 + 内置输入在多 observer 时序下拉锯)。
    function expUpdate(dt) {
      // ⚠️ 双保险: 即使探索 observer 移除失败, expActive=false 也立即短路, 不再强改相机。
      if (!expCamera || !expActive) return;
      var dtS = dt / 1000; if (dtS <= 0) dtS = 0.016; dtS = Math.min(0.05, dtS);
      var cam = expCamera;
      var player = expCamera._playerPos || new Vector3(0, expEyeH, 0);   // 玩家脚底位置
      // 1) 转向: 水平角 yaw(绕Y) + 俯仰 pitch(绕X)。只读写本相机自己维护的 _expYaw/_pitch,
      //   与主相机 alpha 完全无关; 无输入时 yaw/pitch 恒定 → 视角定死, 物理不可能自转。
      var yaw = (typeof cam._expYaw === 'number') ? cam._expYaw : (-Math.PI/2);
      var pitch = cam._pitch || 0;         // 垂直俯仰(内部维护)
      // 右划(lookDX>0)= 右转。UniversalCamera rotation.y: 从+Y俯视, 正角度=逆时针。
      // 正确手性: 面朝 +Z, up=+Y, 屏幕右 = up×forward = +Y×+Z = +X。
      //   yaw 增大(+Z→+X)= 视线右转 → 右划应 yaw 增大 → 用 "+="。
      if (expInput.lookDX) {
        var ddx = expInput.lookDX * 0.006 * expSens;                    // 灵敏度调制
        var ddxLim = 0.03 * expSens;                                    // 限幅随灵敏度(更高灵敏度可转更快)
        ddx = Math.max(-ddxLim, Math.min(ddxLim, ddx));
        yaw += ddx;
      }
      if (expInput.lookDY) {
        // 🔨 上下反修正(2026-08-09, 基于v0.21.10回溯): 下滑(lookDY>0)应低头。
        //   已用 Babylon Matrix 数学验证: UniversalCamera rotation.x(pitch) 增大 → 前方Y负 → 低头。
        //   故下滑(正)→ pitch 应增大 → 用 "+"。v0.21.10 这里用 "-" 是反的(下滑反而抬头)。
        var ddy = expInput.lookDY * 0.004 * expSens;                    // 灵敏度调制
        var ddyLim = 0.03 * expSens;
        ddy = Math.max(-ddyLim, Math.min(ddyLim, ddy));
        cam._pitch = Math.max(-1.2, Math.min(1.2, (cam._pitch||0) + ddy)); pitch = cam._pitch;
      }
      expInput.lookDX = 0; expInput.lookDY = 0;

      // 2) 前进方向: 先应用 yaw/pitch 到相机 rotation(令 getDirection 反映最新朝向), 再取方向。
      cam._expYaw = yaw;
      cam.rotation.y = yaw; cam.rotation.x = pitch;
      var fwdV = cam.getDirection(new Vector3(0, 0, 1));   // 相机局部 +Z = 看向方向(世界)
      var rgtV = cam.getDirection(new Vector3(1, 0, 0));   // 相机局部 +X = 屏幕右(世界; 手性: up×fwd=+Y×+z=+X)
      var fwdX = fwdV.x, fwdZ = fwdV.z;
      var rgtX = rgtV.x, rgtZ = rgtV.z;
      var spd = expFlying ? expFlySpeed : expSpeed;
      var mvx = 0, mvz = 0;
      if (expInput.moveZ) { mvx += fwdX * expInput.moveZ; mvz += fwdZ * expInput.moveZ; }
      if (expInput.moveX) { mvx += rgtX * expInput.moveX; mvz += rgtZ * expInput.moveX; }
      var mag = Math.sqrt(mvx*mvx + mvz*mvz);
      if (mag > 1) { mvx /= mag; mvz /= mag; }

      // 3) 移动(含碰撞): 碰撞射线每 3 帧做一次(性能: 场景 700+ mesh, 逐帧射线卡)
      var moveVec = new Vector3(mvx * spd * dtS, 0, mvz * spd * dtS);
      expCamera._expF = (expCamera._expF || 0) + 1;
      var doCol = (expCamera._expF % 3 === 0);
      var allow = 1;
      if (doCol) {
        allow = expCollideDist(player.add(new Vector3(0, expEyeH, 0)), moveVec);
        player.x += moveVec.x * allow; player.z += moveVec.z * allow;
      } else {
        player.x += moveVec.x; player.z += moveVec.z;
      }

      // 4) 上下(飞行时升降; 落地时锁眼高)
      if (expFlying) { player.y += expInput.vert * spd * 0.8 * dtS; }
      expInput.vert = 0;

      // 5) 站立/地面(每 3 帧做一次)
      if (!expFlying && doCol) {
        var gy = expGroundY(player.x, player.y + expEyeH + 0.1, player.z);
        if (gy !== null) { player.y = gy; }   // 脚底贴地
        else { player.y = 0; }
      }

      // 6) 组装第一人称相机: position = 眼位(脚底 + 眼高), rotation 已在第2步设好。
      //    UniversalCamera 仅需这两项, scene.render 每帧自动用最新 position/rotation 生成 view matrix。
      //    ⚠️ 不做手动 getWorldMatrix()/getViewMatrix(): 那会强制每帧重算相机缓存, 高帧率+复杂场景
      //      下产生额外成本, 且场景 render 本就会用最新值(黑屏防护已在 enterExplore 进入时强制初始化过一次)。
      cam.position.set(player.x, player.y + expEyeH, player.z);

      // 诊断: 每秒打一次摘要(位置/朝向/输入/自转检测)
      expDbgFrame++;
      if (expDbgLastT === 0) expDbgLastT = performance.now();
      var _now = performance.now();
      if (_now - expDbgLastT >= 1000) { expDbgLastT = _now; expSummary(); }
    }

    // 进入探索模式
    window.__mmd.enterExplore = function () {
      if (expActive) return;
      expActive = true;
      // 兜底: 清除上次探索可能残留的输入(双保险, 防重进转圈)
      expInput.moveX = 0; expInput.moveZ = 0; expInput.lookDX = 0; expInput.lookDY = 0; expInput.vert = 0;
      // ⚠️ v0.21.9 根治转圈: 探索用【独立 UniversalCamera】(第一人称正交相机), 不复用主 ArcRotateCamera。
      //   主相机是轨道相机(alpha/beta/radius/target 绕点旋转) + 内置 PointerInput, 真机高帧率下
      //   与手动驱动拉锯 → 自转。UniversalCamera 只有 position + rotation, 物理上无法自转。
      //   主相机状态无需保存/还原(我们不动它); 退出时 dispose 探索相机即可。
      try { if (expCamera && expCamera.dispose) expCamera.dispose(); } catch (e) {}
      var expC = new UniversalCamera("expCam", new Vector3(0, expEyeH, 0), scene);
      scene.addCamera(expC);
      expCamera = expC;
      // 出生点: 【固定原点】(0, eyeH, 0)。用户明确"出生点就在原本的位置, 不是被模型挡住的"。
      //   之前尝试移到 AABB 外侧/相机外侧被用户否决, 保持原始行为。
      var spawn = new Vector3(0, expEyeH, 0);
      // ⚠️ 切换活跃相机到 expCam 前, 先挂起基于相机的 postProcess(SSAO 绑主 camera, 切走会崩坏→画面卡死)
      var _ppRestore = null;
      try { _ppRestore = window.__mmd._suspendPostProcess ? window.__mmd._suspendPostProcess() : null; } catch (e) {}
      if (typeof _ppRestore === 'function') {
        window.__mmd._expPostProcRestore = _ppRestore;   // 退出探索时恢复
      }
      expCamera._expYaw = 0;   // 视线朝 +Z = 模型正脸(与主相机机位一致)
      expCamera._pitch = 0;
      // 玩家实际站立点(expUpdate 用它做碰撞/移动基准)
      expCamera._playerPos = spawn.clone();
      expCamera.rotation.set(0, 0, 0);
      expCamera.position.copyFrom(spawn);
      expCamera.fov = 0.9;        // 略广角, 第一人称观察更开阔
      expCamera.minZ = 0.01; expCamera.maxZ = 2000;
      // 主动初始化 view/world 矩阵缓存, 防止首帧黑屏/滞后(此前"新建相机黑屏"的根因就是未初始化缓存)
      try {
        expCamera._expYaw = 0; expCamera.rotation.set(0, 0, 0);
        expCamera.position.copyFrom(spawn);
        expCamera.update();                       // 同步相机内部状态(含 view 缓存)
        expCamera.getWorldMatrix(); expCamera.getViewMatrix();
      } catch (e3) {}
      expLog('enterExplore OK spawn=(' + spawn.x.toFixed(2) + ',' + spawn.y.toFixed(2) + ',' + spawn.z.toFixed(2) + ') cam=UniversalCamera');
      // 主相机 detach 输入(避免其内置 PointerInput 与探索相机竞争; 退出时 attach 还原)。
      try { camera.detachControl(canvas); } catch (e4) {}
      // 切到探索相机, 复用主 render loop; 探索更新挂在 onBeforeRender
      scene.activeCamera = expCamera;
      expLog('activeCamera switched to expCam active=' + (scene.activeCamera === expCamera));
      try { expDumpDir('enter', expCamera); } catch (e8) {}
      // 单例探索 observer: 首次 add, 之后复用同一回调(带 expActive 守卫, remove 失败也安全)。
      //   ⚠️ 勿每次 enter 都新建回调 add —— 会叠加多个 observer, 且旧 remove 易失效导致退出后残留。
      if (!expRenderObs) {
        expRenderObs = function () {
          if (!expActive) return;   // 已退出则完全空转(双保险, 即使 remove 失败也不改相机)
          var now = performance ? performance.now() : Date.now();
          if (expLastT === null) expLastT = now;
          var dt = now - expLastT; expLastT = now;
          try { expUpdate(dt); } catch (e) {
            expLog('expUpdate ERR ' + (e && e.message || e));
            expInput.lookDX = 0; expInput.lookDY = 0;   // 出错清输入, 防继续污染
          }
        };
        scene.onBeforeRenderObservable.add(expRenderObs);
      }
      if (!engine._activeRenderLoops || engine._activeRenderLoops.length === 0) {
        engine.runRenderLoop(renderFrame);
      }
      window.__mmd._expActive = true;
      return { ok: true, eyeH: expEyeH };
    };

    // 退出探索模式
    window.__mmd.exitExplore = function () {
      if (!expActive) return;
      expActive = false;
      // 移除单例 observer; 若失败也无害(expRenderObs 内部有 expActive 守卫, 空转不改相机)
      if (expRenderObs) { try { scene.onBeforeRenderObservable.remove(expRenderObs); } catch (e) {} }
      // v0.21.9: 探索用独立 UniversalCamera, 主相机从头到尾没被动过(无 _expSavedCam 需还原)。
      //   直接 dispose 探索相机, 恢复主相机为 activeCamera。
      if (expCamera) {
        try { scene.removeCamera(expCamera); } catch (e) {}
        try { expCamera.dispose(); } catch (e) {}
      }
      expCamera = null;
      scene.activeCamera = window.__mmd.usingMmdCam ? (mmdCamNode || camera) : camera;   // 还原主相机/MMD相机
      // 重新挂回主相机内置 touch/pointer 输入(与 enterExplore 的 detachControl 对应),
      //   否则退出后无法拖动改视角。无条件 attach(内部会先 detach 旧监听, 重复调用安全)。
      try { camera.attachControl(canvas, true); } catch (e4) {}
      if (!engine._activeRenderLoops || engine._activeRenderLoops.length === 0) {
        engine.runRenderLoop(renderFrame);
      }
      window.__mmd._expActive = false;
      // 恢复被挂起的 postProcess(SSAO 等, 按用户渲染增强设置)
      try {
        if (window.__mmd._expPostProcRestore) { window.__mmd._expPostProcRestore(); window.__mmd._expPostProcRestore = null; }
      } catch (e) {}
      expLog('exitExplore OK active=' + (scene.activeCamera === camera));
      return { ok: true };
    };
    window.__mmd.isExploreActive = function () { return expActive; };

    // UI 输入接口: UI 每帧写 moveX(横)/moveZ(纵)/lookDX/lookDY/vert
    window.__mmd.setExploreInput = function (o) {
      if (!expActive) return;
      if (o && typeof o.moveX === 'number') expInput.moveX = o.moveX;
      if (o && typeof o.moveZ === 'number') expInput.moveZ = o.moveZ;
      if (o && typeof o.lookDX === 'number') expInput.lookDX = o.lookDX;
      if (o && typeof o.lookDY === 'number') expInput.lookDY = o.lookDY;
      if (o && typeof o.vert === 'number') expInput.vert = o.vert;
    };
    window.__mmd.setExploreNoClip = function (on) { expNoClip = !!on; return expNoClip; };
    window.__mmd.getExploreNoClip = function () { return expNoClip; };
    window.__mmd.setExploreFlying = function (on) { expFlying = !!on; return expFlying; };
    window.__mmd.getExploreFlying = function () { return expFlying; };
    window.__mmd.setExploreEye = function (h) { if (h > 0) expEyeH = h; return expEyeH; };
    window.__mmd.getExploreEye = function () { return expEyeH; };
    window.__mmd.setExploreSpeed = function (walk) {
      if (typeof walk === 'number' && isFinite(walk)) expWalkSpeed = Math.max(0.01, Math.min(3, walk));
      expSpeed = expWalkSpeed;
      expFlySpeed = expWalkSpeed * 3;
      return expWalkSpeed;
    };
    window.__mmd.getExploreSpeed = function () { return expWalkSpeed; };
    // 探索视角灵敏度(转动系数): 1=默认, 0.2~4 (v0.21.11功能回溯补回)
    window.__mmd.setExploreSens = function (v) {
      if (typeof v === 'number' && isFinite(v)) expSens = Math.max(0.2, Math.min(4, v));
      return expSens;
    };
    window.__mmd.getExploreSens = function () { return expSens; };
    window.__mmd.getExploreFlySpeed = function () { return expFlySpeed; };

    // ============================================================================
    // 模块 A：巨人踩城
    // ============================================================================
    function disposeDeep(rootNode) {
      try {
        var children = rootNode.getChildren ? rootNode.getChildren() : [];
        for (var i = children.length - 1; i >= 0; --i) {
          var c = children[i];
          try { disposeDeep(c); } catch (e) {}
          if (c && c.material) { try { c.material.dispose(); } catch (e) {} }
          try { if (c.dispose) c.dispose(); } catch (e) {}
        }
      } catch (e) {}
      if (rootNode && rootNode.material) { try { rootNode.material.dispose(); } catch (e) {} }
    }
    function simpleMeshMat(scene, color, emissive) {
      var m = new StandardMaterial("cityMat_" + Math.random(), scene);
      m.diffuseColor = color;
      m.specularColor = new Color3(0, 0, 0);
      if (emissive) m.emissiveColor = emissive;
      return m;
    }
    function makeHumanMeshes(parent, color, scene, scale) {
      scale = scale || 1;
      var root = new TransformNode("cityPerson", scene);
      root.parent = parent;
      var mat = simpleMeshMat(scene, color);

      var torso = MeshBuilder.CreateBox("p_torso", { width: 0.35 * scale, height: 0.62 * scale, depth: 0.2 * scale }, scene);
      torso.parent = root; torso.position.y = 0.95 * scale; torso.material = mat;
      var head = MeshBuilder.CreateSphere("p_head", { diameter: 0.26 * scale, segments: 6 }, scene);
      head.parent = root; head.position.y = 1.42 * scale; head.material = mat;
      var legMat = simpleMeshMat(scene, color.scale(0.75));
      var lLeg = MeshBuilder.CreateBox("p_ll", { width: 0.11 * scale, height: 0.62 * scale, depth: 0.13 * scale }, scene);
      lLeg.parent = root; lLeg.position.set(-0.08 * scale, 0.35 * scale, 0); lLeg.material = legMat;
      var rLeg = MeshBuilder.CreateBox("p_rl", { width: 0.11 * scale, height: 0.62 * scale, depth: 0.13 * scale }, scene);
      rLeg.parent = root; rLeg.position.set(0.08 * scale, 0.35 * scale, 0); rLeg.material = legMat;
      var armMat = simpleMeshMat(scene, color.scale(0.85));
      var lArm = MeshBuilder.CreateBox("p_la", { width: 0.09 * scale, height: 0.48 * scale, depth: 0.1 * scale }, scene);
      lArm.parent = root; lArm.position.set(-0.25 * scale, 1.0 * scale, 0); lArm.material = armMat;
      var rArm = MeshBuilder.CreateBox("p_ra", { width: 0.09 * scale, height: 0.48 * scale, depth: 0.1 * scale }, scene);
      rArm.parent = root; rArm.position.set(0.25 * scale, 1.0 * scale, 0); rArm.material = armMat;
      root._body = torso; root._head = head;
      return root;
    }
    function cityMatColor(c) { return new Color3(c.r, c.g, c.b); }

    var city = {
      active: false, root: null, giantRoot: null, player: null, cam: null, obs: null,
      input: { moveX: 0, moveZ: 0, sprint: false, dodge: false },
      keys: { up: false, down: false, left: false, right: false, sprint: false },
      invincible: false, died: false, elapsed: 0, timeLimit: 60,
      state: "idle", windupT: 0, stompT: 0, cooldown: 0, lastHit: -10, footSide: 1,
      obstacles: [], npcs: [], savedVis: true, savedAnimHandle: null, savedUserPaused: null,
      savedRootPos: null, savedRootRot: null, savedPhys: null, savedIk: null,
      cityScale: 0.16, observe: false
    };
    window.__mmdCity = {};

    function cityStatus(msg) {
      try { if (statusEl) statusEl.textContent = msg; } catch (e) {}
    }
    function cityAddBox(cx, cz, w, d, h, color, emissive) {
      var box = MeshBuilder.CreateBox("cityBuild", { width: w, height: h, depth: d }, scene);
      box.parent = city.root;
      box.position.set(cx, h / 2, cz);
      box.material = simpleMeshMat(scene, color, emissive);
      city.obstacles.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
      return box;
    }
    function cityAddLamp(cx, cz) {
      var pole = MeshBuilder.CreateCylinder("cityLampPole", { height: 5, diameterTop: 0.12, diameterBottom: 0.2 }, scene);
      pole.parent = city.root; pole.position.set(cx, 2.5, cz);
      pole.material = simpleMeshMat(scene, new Color3(0.12, 0.12, 0.13));
      var lamp = MeshBuilder.CreateBox("cityLampHead", { width: 0.9, height: 0.25, depth: 0.35 }, scene);
      lamp.parent = city.root; lamp.position.set(cx, 4.95, cz);
      lamp.material = simpleMeshMat(scene, new Color3(0.35, 0.35, 0.38), new Color3(0.15, 0.15, 0.16));
    }
    function cityAddTree(cx, cz) {
      var trunk = MeshBuilder.CreateCylinder("cityTreeTrunk", { height: 2.3, diameterTop: 0.28, diameterBottom: 0.38 }, scene);
      trunk.parent = city.root; trunk.position.set(cx, 1.15, cz);
      trunk.material = simpleMeshMat(scene, new Color3(0.3, 0.2, 0.12));
      var crown = MeshBuilder.CreateSphere("cityTreeCrown", { diameter: 2.0, segments: 5 }, scene);
      crown.parent = city.root; crown.position.set(cx, 2.9, cz);
      crown.material = simpleMeshMat(scene, new Color3(0.15 + Math.random() * 0.12, 0.32 + Math.random() * 0.18, 0.14));
    }
    function cityBuildScene() {
      city.root = new TransformNode("cityRoot", scene);
      city.root.scaling.set(city.cityScale, city.cityScale, city.cityScale);

      // 主路面 / 人行道
      var ground = MeshBuilder.CreateGround("cityGround", { width: 120, height: 120, subdivisions: 1 }, scene);
      ground.parent = city.root; ground.position.y = 0.001;
      ground.material = simpleMeshMat(scene, new Color3(0.12, 0.14, 0.16));
      var roadMat = simpleMeshMat(scene, new Color3(0.22, 0.24, 0.28));
      var rx = MeshBuilder.CreateGround("cityRoadX", { width: 120, height: 11, subdivisions: 1 }, scene);
      rx.parent = city.root; rx.position.y = 0.005; rx.material = roadMat;
      var rz = MeshBuilder.CreateGround("cityRoadZ", { width: 11, height: 120, subdivisions: 1 }, scene);
      rz.parent = city.root; rz.position.y = 0.006; rz.material = roadMat;

      // 建筑（低多边形长方体）
      var palette = [
        new Color3(0.24, 0.28, 0.34), new Color3(0.30, 0.26, 0.30),
        new Color3(0.20, 0.32, 0.38), new Color3(0.32, 0.28, 0.22),
        new Color3(0.26, 0.26, 0.38)
      ];
      var seedBlocks = [
        [-34, -20, 13, 11, 18], [-12, -22, 12, 12, 24], [12, -24, 12, 12, 20], [34, -20, 13, 11, 26],
        [-34, 20, 13, 11, 22], [-12, 22, 12, 12, 19], [12, 24, 12, 12, 25], [34, 20, 13, 11, 20],
        [-40, -40, 14, 14, 30], [40, -40, 14, 14, 28], [-40, 40, 14, 14, 24], [40, 40, 14, 14, 32],
        [-52, 0, 14, 20, 34], [52, 0, 14, 20, 28]
      ];
      for (var i = 0; i < seedBlocks.length; ++i) {
        var b = seedBlocks[i];
        cityAddBox(b[0], b[1], b[2], b[3], b[4], palette[i % palette.length]);
        // 侧楼小窗
        var win = MeshBuilder.CreatePlane("cityWin", { width: 0.3, height: 0.4 }, scene);
        win.parent = city.root; win.position.set(b[0], b[4] * 0.5 + 0.6, b[1] + b[3] / 2 + 0.01);
        win.rotation.y = 0;
        win.material = simpleMeshMat(scene, new Color3(0.4, 0.45, 0.48), new Color3(0.28, 0.32, 0.33));
      }

      // 路灯 / 树（沿路）
      var lampPts = [[-16, 7], [16, 7], [-16, -7], [16, -7], [7, -16], [7, 16], [-7, -16], [-7, 16]];
      for (var j = 0; j < lampPts.length; ++j) cityAddLamp(lampPts[j][0], lampPts[j][1]);
      var treePts = [[-26, 8], [26, 8], [-26, -8], [26, -8], [8, -26], [8, 26], [-8, -26], [-8, 26]];
      for (var k = 0; k < treePts.length; ++k) cityAddTree(treePts[k][0], treePts[k][1]);
    }
    function cityPlayerWorld() {
      if (!city.player) return new Vector3(0, 0.1, 0);
      var p = city.player.position;
      return new Vector3(p.x * city.cityScale, 0.08 * city.cityScale + p.y * city.cityScale, p.z * city.cityScale);
    }
    function cityPlayerLocal() {
      return city.player ? city.player.position.clone() : new Vector3(0, 0, 0);
    }
    function cityGiantLocal() {
      if (!city.giantRoot) return new Vector3(0, 0, 0);
      return new Vector3(city.giantRoot.position.x / city.cityScale, 0, city.giantRoot.position.z / city.cityScale);
    }
    function cityCollide(x, z) {
      var r = 0.4;
      for (var i = 0; i < city.obstacles.length; ++i) {
        var o = city.obstacles[i];
        var nx = Math.max(o.minX, Math.min(o.maxX, x));
        var nz = Math.max(o.minZ, Math.min(o.maxZ, z));
        var dx = x - nx, dz = z - nz;
        if (dx * dx + dz * dz < r * r) return true;
      }
      return false;
    }
    function cityGiantAvoid(px, pz) {
      for (var i = 0; i < city.obstacles.length; ++i) {
        var o = city.obstacles[i];
        var nx = Math.max(o.minX, Math.min(o.maxX, px));
        var nz = Math.max(o.minZ, Math.min(o.maxZ, pz));
        var dx = px - nx, dz = pz - nz;
        if (dx * dx + dz * dz < 2.6 * 2.6) return true;
      }
      return false;
    }
    function citySpawnNpcs() {
      var colors = [new Color3(0.9, 0.65, 0.2), new Color3(0.3, 0.75, 0.5), new Color3(0.75, 0.35, 0.5), new Color3(0.4, 0.55, 0.85)];
      var pts = [[-8, 4], [8, -4], [4, 8], [-4, -8], [16, 9], [-16, -9], [9, -20], [-9, 20]];
      for (var i = 0; i < pts.length; ++i) {
        var npc = makeHumanMeshes(city.root, colors[i % colors.length], scene, 1);
        npc.position.set(pts[i][0], 0, pts[i][1]);
        city.npcs.push({ root: npc, flattened: false });
      }
    }
    function cityReset() {
      city.elapsed = 0; city.died = false; city.state = "idle"; city.cooldown = 0; city.windupT = 0; city.stompT = 0;
      if (city.player) {
        city.player.position.set(0, 0, -6);
        city.player.rotation.y = 0;
        city.player.rotation.x = 0; city.player.rotation.z = 0;
        if (city.player._body) city.player._body.scaling.y = 1;
        if (city.player._head) city.player._head.scaling.y = 1;
      }
      for (var i = 0; i < city.npcs.length; ++i) {
        var n = city.npcs[i];
        n.flattened = false;
        if (n.root._body) n.root._body.scaling.y = 1;
      }
      if (city.giantRoot) {
        city.giantRoot.position.set(0, 0, 12 * city.cityScale);
        city.giantRoot.rotation.set(0, Math.PI, 0);
      }
      cityStatus("躲避巨人的脚步，存活 " + city.timeLimit + " 秒");
    }
    function cityEnter() {
      if (city.active) return { ok: false, error: "already active" };
      var m = activeModel();
      if (!m || !m.mmdModel) return { ok: false, error: "请先加载一个 PMX 模型" };
      city.active = true;
      var md = m.mmdModel;
      var root = m.mesh || window.__mmd.getModelRoot();
      city.giantRoot = root;
      city.savedRootPos = root.position.clone();
      city.savedRootRot = root.rotation.clone();
      city.savedAnimHandle = window.__mmd._modelAnimHandle; window.__mmd._modelAnimHandle = null;
      city.savedUserPaused = window.__mmd._userPaused; window.__mmd._userPaused = true;
      try { md.setRuntimeAnimation(null); } catch (e) {}
      city.savedPhys = Uint8Array.from(md.rigidBodyStates); md.rigidBodyStates.fill(0);
      city.savedIk = Uint8Array.from(md.ikSolverStates); md.ikSolverStates.fill(0);
      city.savedVis = ground.isVisible; ground.isVisible = false;
      city._boneCache = {};
      if (md.runtimeBones) {
        for (var bi = 0; bi < md.runtimeBones.length; ++bi) city._boneCache[md.runtimeBones[bi].name] = md.runtimeBones[bi];
      }
      city.obstacles.length = 0; city.npcs.length = 0;
      cityBuildScene();
      citySpawnNpcs();
      city.player = makeHumanMeshes(city.root, new Color3(0.88, 0.3, 0.25), scene, 1);
      city.player.position.set(0, 0, -6);
      city.giantRoot.position.set(0, 0, 12 * city.cityScale);

      var pw = cityPlayerWorld();
      city.cam = new ArcRotateCamera("cityCam", -Math.PI / 2, 1.05, 3.2, pw, scene);
      city.cam.lowerRadiusLimit = 1.2; city.cam.upperRadiusLimit = 10;
      city.cam.inertia = 0.3;
      scene.addCamera(city.cam);
      scene.activeCamera = city.cam;
      try { camera.detachControl(canvas); } catch (e) {}

      cityReset();
      city.obs = function () {
        try { cityTick(); } catch (e) { try { if (window.AndroidFile && window.AndroidFile.log) window.AndroidFile.log("cityTick err " + (e && e.message || e)); } catch (e2) {} }
      };
      scene.onBeforeRenderObservable.add(city.obs, 0, true);
      if (!engine._activeRenderLoops || engine._activeRenderLoops.length === 0) engine.runRenderLoop(renderFrame);
      window.__mmd._physSmoothTick = function () {};
      return { ok: true };
    }
    function cityExit() {
      if (!city.active) return { ok: false, error: "not active" };
      city.active = false;
      try { if (city.obs) scene.onBeforeRenderObservable.remove(city.obs); } catch (e) {}
      try { if (city.cam && scene.removeCamera) scene.removeCamera(city.cam); } catch (e) {}
      try { if (city.cam) city.cam.dispose(); } catch (e) {}
      disposeDeep(city.root);
      try { if (city.root) city.root.dispose(); } catch (e) {}
      var oldCityBoneCache = city._boneCache;
      city.root = null; city.player = null; city._boneCache = null;
      city.obstacles.length = 0; city.npcs.length = 0;

      var m = activeModel();
      var md = m && m.mmdModel;
      if (md && city.giantRoot) {
        try { if (city.savedPhys) md.rigidBodyStates.set(city.savedPhys); } catch (e) {}
        try { if (city.savedIk) md.ikSolverStates.set(city.savedIk); } catch (e) {}
        if (city.savedRootPos) city.giantRoot.position.copyFrom(city.savedRootPos);
        if (city.savedRootRot) city.giantRoot.rotation.copyFrom(city.savedRootRot);
        if (city.savedAnimHandle && md.setRuntimeAnimation) {
          try { md.setRuntimeAnimation(city.savedAnimHandle); window.__mmd._modelAnimHandle = city.savedAnimHandle; } catch (e) {}
        } else {
          window.__mmd._modelAnimHandle = null;
          if (oldCityBoneCache) {
            for (var bn in oldCityBoneCache) {
              var cb = oldCityBoneCache[bn];
              try { if (cb.linkedBone.setRotationQuaternion) cb.linkedBone.setRotationQuaternion(Quaternion.Identity(), 0); } catch (e2) {}
            }
          }
        }
        window.__mmd._userPaused = city.savedUserPaused;
        window.__mmd._absT0 = undefined;
      }
      try { ground.isVisible = city.savedVis; } catch (e) {}
      scene.activeCamera = window.__mmd.usingMmdCam ? (mmdCamNode || camera) : camera;
      try { camera.attachControl(canvas, true); } catch (e) {}
      window.__mmd._physSmoothTick = function (mmd) {
        if (physLerp.smooth <= 0 || !mmd || !mmd.runtimeBones) return;
        // 恢复原布料平滑逻辑(见函数定义处, 这里只做兼容兜底)
        try {
          var a = physLerp.smooth, rb = mmd.runtimeBones;
          for (var i = 0; i < rb.length; i++) {
            if (!rb[i].rigidBodyIndices || rb[i].rigidBodyIndices.length === 0) continue;
            var off = i * 16, wt = mmd.worldTransformMatrices;
            if (!wt) continue;
            var x = wt[off + 12], y = wt[off + 13], z = wt[off + 14];
            if (!rb[i]._smPrev) rb[i]._smPrev = [x, y, z];
            var pv = rb[i]._smPrev;
            var nx = pv[0] + (x - pv[0]) * a, ny = pv[1] + (y - pv[1]) * a, nz = pv[2] + (z - pv[2]) * a;
            wt[off + 12] = nx; wt[off + 13] = ny; wt[off + 14] = nz;
            pv[0] = x; pv[1] = y; pv[2] = z;
          }
        } catch (e) {}
      };
      if (!engine._activeRenderLoops || engine._activeRenderLoops.length === 0) engine.runRenderLoop(renderFrame);
      return { ok: true };
    }
    function cityTick() {
      if (!city.active) return;
      var dt = Math.min(0.05, engine.getDeltaTime() / 1000 || 0.016);

      city.elapsed += dt;
      var sprint = city.input.sprint || city.keys.sprint;
      var speed = 5.0 * (sprint ? 1.25 : 1);
      var mx = city.input.moveX + (city.keys.right ? 1 : 0) - (city.keys.left ? 1 : 0);
      var mz = city.input.moveZ + (city.keys.up ? 1 : 0) - (city.keys.down ? 1 : 0);
      var mag = Math.sqrt(mx * mx + mz * mz);
      if (mag > 1) { mx /= mag; mz /= mag; }

      if (!city.died) {
        var old = city.player.position.clone();
        var nx = old.x + mx * speed * dt;
        var nz = old.z + mz * speed * dt;
        if (!cityCollide(nx, old.z)) { city.player.position.x = nx; }
        if (!cityCollide(city.player.position.x, nz)) { city.player.position.z = nz; }
        if (mx !== 0 || mz !== 0) {
          city.player.rotation.y = Math.atan2(mx, mz);
          city.player.rotation.x = 0; city.player.rotation.z = 0;
        }
      }

      // 巨人追/踩
      var gl = cityGiantLocal();
      var pl = cityPlayerLocal();
      var dxL = pl.x - gl.x, dzL = pl.z - gl.z;
      var distL = Math.sqrt(dxL * dxL + dzL * dzL);
      var giantSpeed = 2.8 + Math.min(0.6, city.elapsed * 0.012);
      var nowAbs = performance.now() / 1000;

      if (!city.died) {
        if (city.state === "stomp") {
          city.stompT += dt;
          var fy = 0.8 * (1 - Math.min(1, city.stompT / 0.36));
          city.giantRoot.position.y = fy;
          var fwd = new Vector3(Math.sin(city.giantRoot.rotation.y), 0, Math.cos(city.giantRoot.rotation.y));
          var foot = city.giantRoot.position.clone().add(fwd.scale(0.5)).add(new Vector3(fwd.z, 0, -fwd.x).scale(0.24 * city.footSide));
          var playerCenterW = cityPlayerWorld();
          if (city.stompT >= 0.28) {
            var hitW = (foot.x - playerCenterW.x) * (foot.x - playerCenterW.x) + (foot.z - playerCenterW.z) * (foot.z - playerCenterW.z)
              < (1.6 * city.cityScale) * (1.6 * city.cityScale);
            if (hitW) {
              if (!city.invincible) {
                city.died = true;
                city.player._body.scaling.y = 0.12;
                city.player._head.scaling.y = 0.1;
                cityStatus("被巨人踩到了！点“重开”再来一次");
              } else if (nowAbs - city.lastHit > 2.0) {
                city.lastHit = nowAbs;
                var away = new Vector3(playerCenterW.x - foot.x, 0, playerCenterW.z - foot.z);
                if (away.lengthSquared() < 0.0001) away.set(1, 0, 0);
                away.normalize().scaleInPlace(3);
                city.player.position.x += away.x / city.cityScale;
                city.player.position.z += away.z / city.cityScale;
                city.player.rotation.x = -0.35; city.player.rotation.z = 0.25;
                cityStatus("无敌：被震开但没死");
              }
            }
            // NPC 踩扁
            for (var k = 0; k < city.npcs.length; ++k) {
              var np = city.npcs[k];
              if (np.flattened) continue;
              var nxW = np.root.position.x * city.cityScale, nzW = np.root.position.z * city.cityScale;
              var ddx = foot.x - nxW, ddz = foot.z - nzW;
              if (ddx * ddx + ddz * ddz < (1.4 * city.cityScale) * (1.4 * city.cityScale)) {
                np.flattened = true; np.root._body.scaling.y = 0.08;
              }
            }
          }
          if (city.stompT >= 0.4) { city.state = "cooldown"; city.cooldown = 1.0; city.stompT = 0; city.giantRoot.position.y = 0; }
        } else if (city.state === "cooldown") {
          city.cooldown -= dt;
          if (city.cooldown <= 0) city.state = "chase";
        } else if (city.state === "windup") {
          city.windupT += dt;
          city.giantRoot.rotation.z = -0.08 * city.footSide;
          city.giantRoot.position.y = 0.05;
          if (city.windupT >= 0.8) { city.state = "stomp"; city.stompT = 0; city.giantRoot.rotation.z = 0; }
        } else {
          if (distL < 7.5) { city.state = "windup"; city.windupT = 0; city.footSide = Math.random() > 0.5 ? 1 : -1; }
          else {
            var dirW = new Vector3(pl.x * city.cityScale - city.giantRoot.position.x, 0, pl.z * city.cityScale - city.giantRoot.position.z);
            var len = dirW.length();
            if (len > 0.001) {
              dirW.scaleInPlace(1 / len);
              var step = giantSpeed * dt;
              var nextX = city.giantRoot.position.x + dirW.x * step;
              var nextZ = city.giantRoot.position.z + dirW.z * step;
              var glNextX = nextX / city.cityScale, glNextZ = nextZ / city.cityScale;
              if (!cityGiantAvoid(glNextX, glNextZ)) {
                city.giantRoot.position.x = nextX; city.giantRoot.position.z = nextZ;
              } else {
                // 简单绕障
                var angTmp = city.giantRoot.rotation.y + 0.6;
                var altF = new Vector3(Math.sin(angTmp), 0, Math.cos(angTmp));
                var altX = city.giantRoot.position.x + altF.x * step, altZ = city.giantRoot.position.z + altF.z * step;
                if (!cityGiantAvoid(altX / city.cityScale, altZ / city.cityScale)) {
                  city.giantRoot.position.x = altX; city.giantRoot.position.z = altZ;
                } else {
                  city.giantRoot.position.x += dirW.x * step * 0.6; city.giantRoot.position.z += dirW.z * step * 0.6;
                }
              }
              var targetYaw = Math.atan2(dirW.x, dirW.z);
              var yawDiff = targetYaw - city.giantRoot.rotation.y;
              while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
              while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
              city.giantRoot.rotation.y += yawDiff * Math.min(1, dt * 4);
              city.giantRoot.position.y = 0.16 + Math.sin(city.elapsed * 7) * 0.05;
              city.giantRoot.rotation.z = Math.sin(city.elapsed * 7) * 0.04;
              // 可选程序步态：腿骨交替摆动（无该骨时自动跳过）
              try {
                if (city._boneCache) {
                  var ph = city.elapsed * 8;
                  var swingA = Math.sin(ph) * 0.35, swingB = Math.sin(ph + Math.PI) * 0.35;
                  var axisX = new Vector3(1, 0, 0);
                  var lt = city._boneCache['左足'], rt = city._boneCache['右足'];
                  var ls = city._boneCache['左ひざ'], rs = city._boneCache['右ひざ'];
                  if (lt && lt.linkedBone.rotationQuaternion) lt.linkedBone.rotationQuaternion.copyFrom(Quaternion.RotationAxis(axisX, swingA));
                  if (rt && rt.linkedBone.rotationQuaternion) rt.linkedBone.rotationQuaternion.copyFrom(Quaternion.RotationAxis(axisX, swingB));
                  if (ls && ls.linkedBone.rotationQuaternion) ls.linkedBone.rotationQuaternion.copyFrom(Quaternion.RotationAxis(axisX, -Math.max(0, -Math.sin(ph)) * 0.4));
                  if (rs && rs.linkedBone.rotationQuaternion) rs.linkedBone.rotationQuaternion.copyFrom(Quaternion.RotationAxis(axisX, -Math.max(0, Math.sin(ph)) * 0.4));
                }
              } catch (eBuild) {}
            }
          }
        }
      }

      // 相机
      if (city.cam) {
        var focus = cityPlayerWorld();
        focus.y = 0.4;
        city.cam.target = focus;
        if (city.observe) {
          city.cam.alpha = city.giantRoot.rotation.y + Math.PI / 2;
          city.cam.beta = 0.8;
          city.cam.radius = 5;
        } else {
          var pyaw = city.player.rotation.y;
          city.cam.alpha = pyaw - Math.PI / 2;
          city.cam.beta = 1.05;
          city.cam.radius = 3.2;
        }
      }

      // 完成判定
      if (city.elapsed >= city.timeLimit && !city.died) cityStatus("坚持住了！存活 " + city.timeLimit + " 秒");
    }

    window.__mmdCity.enter = cityEnter;
    window.__mmdCity.exit = cityExit;
    window.__mmdCity.isActive = function () { return city.active; };
    window.__mmdCity.setInput = function (o) {
      if (!city.active) return;
      if (o && typeof o.moveX === "number") city.input.moveX = o.moveX;
      if (o && typeof o.moveZ === "number") city.input.moveZ = o.moveZ;
      if (o && typeof o.sprint === "boolean") city.input.sprint = o.sprint;
      if (o && o.dodge) {
        // 简单短闪：向后弹开
        var aw = cityPlayerWorld(), gl2 = cityGiantLocal();
        var away = new Vector3(aw.x - gl2.x, 0, aw.z - gl2.z);
        if (away.lengthSquared() < 0.0001) away.set(1, 0, 0);
        away.normalize().scaleInPlace(3);
        city.player.position.x += away.x / city.cityScale;
        city.player.position.z += away.z / city.cityScale;
      }
    };
    window.__mmdCity.setInvincible = function (on) { city.invincible = !!on; return city.invincible; };
    window.__mmdCity.setObserve = function (on) { city.observe = !!on; return city.observe; };
    window.__mmdCity.setCityScale = function (s) {
      if (typeof s === 'number' && isFinite(s) && s > 0.02 && s < 1) city.cityScale = s;
      return city.cityScale;
    };
    window.__mmdCity.getCityScale = function () { return city.cityScale; };
    window.__mmdCity.restart = cityReset;
    window.__mmdCity.getState = function () {
      return {
        active: city.active, elapsed: city.elapsed, timeLimit: city.timeLimit,
        died: city.died, invincible: city.invincible, state: city.state,
        observe: city.observe
      };
    };
    window.addEventListener("keydown", function (e) {
      if (!city.active) return;
      var k = e.key.toLowerCase();
      if (k === "w" || k === "arrowup") city.keys.up = true;
      if (k === "s" || k === "arrowdown") city.keys.down = true;
      if (k === "a" || k === "arrowleft") city.keys.left = true;
      if (k === "d" || k === "arrowright") city.keys.right = true;
      if (k === "shift") city.keys.sprint = true;
      if (k === " " || k === "空格") { e.preventDefault(); try { window.__mmdCity.setInput({ dodge: true }); } catch (e2) {} }
      if (k === "r") cityReset();
    });
    window.addEventListener("keyup", function (e) {
      if (!city.active) return;
      var k = e.key.toLowerCase();
      if (k === "w" || k === "arrowup") city.keys.up = false;
      if (k === "s" || k === "arrowdown") city.keys.down = false;
      if (k === "a" || k === "arrowleft") city.keys.left = false;
      if (k === "d" || k === "arrowright") city.keys.right = false;
      if (k === "shift") city.keys.sprint = false;
    });

    // ============================================================================
    // 模块 B：手办式全身摆姿
    // ============================================================================
    var pose = {
      active: false, obs: null, states: {}, boneMap: {}, selected: null,
      savedAnimHandle: null, savedUserPaused: null, savedPhys: null, savedIk: null,
      fkMode: false
    };
    window.__mmdPose = {};

    function poseBoneDisplay(name) {
      var map = {
        "全ての親": "全局/根", "センター": "中心", "腰": "腰", "上半身": "上半身", "上半身2": "上半身2", "下半身": "下半身",
        "頭": "头", "首": "脖子", "両目": "双眼", "左目": "左眼", "右目": "右眼", "左眉": "左眉", "右眉": "右眉"
      };
      var label = map[name];
      if (label) return label;
      var n = name;
      n = n.replace(/左/g, "左").replace(/右/g, "右");
      n = n.replace("親指", "拇指").replace("人差指", "食指").replace("中指", "中指").replace("薬指", "无名指").replace("小指", "小指");
      n = n.replace("つま先", "脚尖").replace("足首", "脚踝").replace("手首", "手腕");
      n = n.replace("ひじ", "肘").replace("ひざ", "膝");
      n = n.replace("腕", "臂").replace("肩", "肩").replace("足", "腿").replace("首", "颈");
      return n;
    }
    function poseBoneGroup(name) {
      var n = name;
      if (/頭|首|目|眉|口|あご|顎/.test(n)) return "头颈";
      if (/上半身|下半身|腰|センター|全ての親/.test(n)) return "躯干";
      if (/肩|腕|ひじ|手首/.test(n)) return "上臂/手";
      if (/親指|人差指|中指|薬指|小指|爪先|付け根|末/.test(n)) return "手指/脚趾";
      if (/足|ひざ|趾|つま先/.test(n)) return "下肢";
      if (/首|胸|肩/.test(n)) return "头颈/躯干";
      return "其他";
    }
    function poseEnsureBoneMap() {
      pose.boneMap = {};
      var m = activeModel();
      if (!m || !m.mmdModel || !m.mmdModel.runtimeBones) return;
      var bones = m.mmdModel.runtimeBones;
      for (var i = 0; i < bones.length; ++i) {
        pose.boneMap[bones[i].name] = bones[i];
      }
    }
    function poseApplyTick() {
      if (!pose.active) return;
      var m = activeModel();
      if (!m || !m.mmdModel) return;
      for (var name in pose.states) {
        var b = pose.boneMap[name];
        if (!b) continue;
        var s = pose.states[name];
        var q = Quaternion.FromEulerAngles(s.x * Math.PI / 180, s.y * Math.PI / 180, s.z * Math.PI / 180);
        try {
          if (b.linkedBone.rotationQuaternion) b.linkedBone.rotationQuaternion.copyFrom(q);
          else b.linkedBone.setRotationQuaternion && b.linkedBone.setRotationQuaternion(q, 0);
        } catch (e) {}
      }
    }
    function poseEnter() {
      if (pose.active) return { ok: false, error: "already active" };
      var m = activeModel();
      if (!m || !m.mmdModel) return { ok: false, error: "请先加载一个 PMX 模型" };
      pose.active = true;
      var md = m.mmdModel;
      pose.savedAnimHandle = window.__mmd._modelAnimHandle; window.__mmd._modelAnimHandle = null;
      pose.savedUserPaused = window.__mmd._userPaused; window.__mmd._userPaused = true;
      try { md.setRuntimeAnimation(null); } catch (e) {}
      pose.savedPhys = Uint8Array.from(md.rigidBodyStates); md.rigidBodyStates.fill(0);
      pose.savedIk = Uint8Array.from(md.ikSolverStates); md.ikSolverStates.fill(0);
      pose.states = {}; pose.selected = null;
      if (pose.obs) { try { scene.onBeforeRenderObservable.remove(pose.obs); } catch (e) {} }
      pose.obs = poseApplyTick;
      scene.onBeforeRenderObservable.add(pose.obs, 0, true);
      poseEnsureBoneMap();
      return { ok: true, bones: Object.keys(pose.boneMap).length };
    }
    function poseExit() {
      if (!pose.active) return { ok: false, error: "not active" };
      pose.active = false;
      try { if (pose.obs) scene.onBeforeRenderObservable.remove(pose.obs); } catch (e) {}
      var m = activeModel();
      var md = m && m.mmdModel;
      if (md) {
        try { if (pose.savedPhys) md.rigidBodyStates.set(pose.savedPhys); } catch (e) {}
        try { if (pose.savedIk) md.ikSolverStates.set(pose.savedIk); } catch (e) {}
        try {
          if (pose.savedAnimHandle && md.setRuntimeAnimation) {
            md.setRuntimeAnimation(pose.savedAnimHandle);
            window.__mmd._modelAnimHandle = pose.savedAnimHandle;
          } else {
            window.__mmd._modelAnimHandle = null;
          }
        } catch (e) {}
        window.__mmd._userPaused = pose.savedUserPaused;
        window.__mmd._absT0 = undefined;
      }
      return { ok: true };
    }
    window.__mmdPose.enter = poseEnter;
    window.__mmdPose.exit = poseExit;
    window.__mmdPose.isActive = function () { return pose.active; };
    window.__mmdPose.getBones = function () {
      poseEnsureBoneMap();
      var arr = Object.keys(pose.boneMap).sort(function (a, b) {
        var g = poseBoneGroup(a).localeCompare(poseBoneGroup(b));
        return g || a.localeCompare(b);
      }).map(function (n) {
        return { name: n, label: poseBoneDisplay(n), group: poseBoneGroup(n) };
      });
      return { bones: arr, selected: pose.selected, fkMode: pose.fkMode };
    };
    window.__mmdPose.select = function (name) {
      if (!pose.boneMap[name]) poseEnsureBoneMap();
      if (pose.boneMap[name]) pose.selected = name;
      if (!pose.states[name]) pose.states[name] = { x: 0, y: 0, z: 0 };
      return { ok: true, selected: name, state: pose.states[name] || { x: 0, y: 0, z: 0 } };
    };
    window.__mmdPose.getState = function (name) {
      name = name || pose.selected;
      return name ? (pose.states[name] || { x: 0, y: 0, z: 0 }) : null;
    };
    window.__mmdPose.rotate = function (name, opts) {
      if (!name) name = pose.selected;
      if (!name) return { ok: false, error: "no bone selected" };
      poseEnsureBoneMap();
      if (!pose.boneMap[name]) return { ok: false, error: "bone not found" };
      var s = pose.states[name] || (pose.states[name] = { x: 0, y: 0, z: 0 });
      if (opts && typeof opts.x === "number") s.x = Math.max(-180, Math.min(180, opts.x));
      if (opts && typeof opts.y === "number") s.y = Math.max(-180, Math.min(180, opts.y));
      if (opts && typeof opts.z === "number") s.z = Math.max(-180, Math.min(180, opts.z));
      pose.selected = name;
      poseApplyTick();
      return { ok: true, name: name, state: s };
    };
    window.__mmdPose.resetBone = function (name) {
      name = name || pose.selected;
      if (!name) return { ok: false, error: "no bone" };
      if (pose.states[name]) { delete pose.states[name]; }
      var b = pose.boneMap[name];
      if (b) {
        try {
          if (b.linkedBone.setRotationQuaternion) {
            b.linkedBone.setRotationQuaternion(Quaternion.Identity(), 0);
            b.linkedBone.position.copyFrom(b.linkedBone.getRestMatrix().getTranslation());
          }
        } catch (e) {}
      }
      return { ok: true, name: name };
    };
    window.__mmdPose.resetAll = function () {
      var m = activeModel();
      if (m && m.mmdModel) { try { m.mmdModel.setRuntimeAnimation(null); } catch (e) {} }
      pose.states = {};
      var names = Object.keys(pose.boneMap);
      for (var i = 0; i < names.length; ++i) {
        var b = pose.boneMap[names[i]];
        try { if (b && b.linkedBone.setRotationQuaternion) b.linkedBone.setRotationQuaternion(Quaternion.Identity(), 0); } catch (e) {}
      }
      return { ok: true };
    };
    window.__mmdPose.mirror = function () {
      var target = pose.selected || null;
      var out = [];
      for (var name in pose.states) {
        var mirroredName = name.replace(/左/g, "右").replace(/右/g, "左");
        if (mirroredName === name) continue;
        if (!pose.boneMap[mirroredName]) continue;
        var s = pose.states[name];
        var m = { x: s.x, y: -s.y, z: -s.z };
        pose.states[mirroredName] = { x: m.x, y: m.y, z: m.z };
        out.push(mirroredName);
      }
      poseApplyTick();
      return { ok: true, applied: out };
    };
    window.__mmdPose.setFkMode = function (on) { pose.fkMode = !!on; return pose.fkMode; };
    window.__mmdPose.savePose = function (slot) {
      try {
        var key = "mmd_pose_" + slot;
        localStorage.setItem(key, JSON.stringify(pose.states));
        return { ok: true, slot: slot };
      } catch (e) { return { ok: false, error: String(e) }; }
    };
    window.__mmdPose.loadPose = function (slot) {
      try {
        var raw = localStorage.getItem("mmd_pose_" + slot);
        if (!raw) return { ok: false, error: "empty slot" };
        var data = JSON.parse(raw);
        poseEnsureBoneMap();
        pose.states = {};
        for (var name in data) {
          if (pose.boneMap[name] !== undefined) pose.states[name] = data[name];
        }
        poseApplyTick();
        return { ok: true, bones: Object.keys(pose.states).length };
      } catch (e) { return { ok: false, error: String(e) }; }
    };
    window.__mmdPose.listPoses = function () {
      var r = [];
      for (var i = 1; i <= 6; ++i) {
        try { if (localStorage.getItem("mmd_pose_" + i)) r.push(i); } catch (e) {}
      }
      return r;
    };


    // 首次不再内置加载默认模型 —— 等用户在文件库选择模型(不内置模型进 APK)。
    statusEl.textContent = "[就绪] 请在右侧“文件库”选择文件夹并加载模型";
    engine.runRenderLoop(renderFrame);

    // 暴露运行时切换接口(供 App 原生/JS 调用)
    window.__mmdLoad = {
      loadAll: (m, v) => loadAndPlay(m, v),
      loadModel: (m) => loadAndPlay(m, defaultMotionPath || null),
      loadMotion: (v) => loadAndPlay(currentModelPath, v),
      get currentModelPath() { return currentModelPath; },
      get currentModel_() { return mmdModel; },
      // ===== 多模型管理 =====
      listModels: function () { return modelList.map(function (m) { return m.name; }); },        // 名字列表
      getModelCount: function () { return modelList.length; },
      getActiveModelIndex: function () { return activeModelIdx; },
      setActiveModel: function (idxOrName) {
        var idx = -1;
        if (typeof idxOrName === 'number') idx = idxOrName;
        else if (typeof idxOrName === 'string') { for (var i=0;i<modelList.length;i++) if (modelList[i].name === idxOrName) { idx = i; break; } }
        return idx >= 0 ? setActiveModel(idx) : false;
      },
      removeActiveModel: function () { return removeModel(activeModelIdx); },
      removeModel: function (idxOrName) { return removeModel(idxOrName); },
      // ===== 三件套: 分别挂 动作/表情/相机, 共用时间轴 =====
      loadMotionUrl: (url) => loadMotionTrack(url, null),            // 自动按内容归类
      setBone: (url) => loadMotionTrack(url, 'bone'),                // 强制当动作(骨骼)
      setMorph: (url) => loadMotionTrack(url, 'morph'),              // 强制当表情(morph)
      setCamera: (url) => loadMotionTrack(url, 'camera'),            // 相机.vmd
      resetMotions: () => { motionState.bone = null; motionState.morph = null; currentLoads.motion = null; applyMotionsToModel(); },
      clearCamera: () => { useFreeCamera(); currentLoads.camera = null; },
      hasMmdCam: () => !!window.__mmd.usingMmdCam,
      // ===== Scene Information: 查询/清除当前已加载内容(PocketMQO 风格管理) =====
      sceneInfo: function () {
        return { model: currentLoads.model, motion: currentLoads.motion, morph: currentLoads.morph, camera: currentLoads.camera, scene: currentLoads.scene };
      },
      clearTrack: function (kind) {
        if (kind === 'motion') { motionState.bone = null; currentLoads.motion = null; applyMotionsToModel(); }
        else if (kind === 'morph') { motionState.morph = null; currentLoads.morph = null; applyMotionsToModel(); }
        else if (kind === 'camera') { useFreeCamera(); currentLoads.camera = null; }
        else if (kind === 'scene') { try { sceneContainers.forEach(function (c){ try{c.dispose();}catch(e){} }); sceneContainers.length = 0; currentLoads.scene = null; } catch (e) {} }
        return window.__mmdLoad.sceneInfo();
      },
      clearAll: function () {
        motionState.bone = null; motionState.morph = null; currentLoads.motion = null; currentLoads.morph = null;
        useFreeCamera(); currentLoads.camera = null;
        try { sceneContainers.forEach(function (c){ try{c.dispose();}catch(e){} }); sceneContainers.length = 0; } catch (e) {}
        currentLoads.scene = null;
        applyMotionsToModel();
        return window.__mmdLoad.sceneInfo();
      },
    };

    // 翻转模型正面(绕 Y 轴 180°): 不同 PMX 正面朝向可能不同, 用此把正脸转到相机侧。
    // 翻转操作对"模型骨架节点"整体做 Y 旋转, VMD 播放的是骨骼相对旋转, 不受影响。
    window.__mmd.flipModelFace = function () {
      var root = null;
      var meshes = scene.meshes || [];
      for (var i = 0; i < meshes.length; i++) {
        var m = meshes[i];
        if (!m.parent && m.rotation !== undefined && m.getClassName() !== 'ArcRotateCamera') {
          if (m.name && m.name.indexOf('ground') >= 0) continue;
          root = m; break;
        }
      }
      if (!root) return { ok: false, error: 'no model root' };
      root.rotation.y = (root.rotation.y || 0) + Math.PI;
      try { root.computeWorldMatrix(true); } catch (e) {}
      window.__mmd.renderFrame();
      return { ok: true, rotated: root.rotation.y };
    };
    window.__mmd.getModelFaceFlipped = function () {
      var root = null;
      var meshes = scene.meshes || [];
      for (var i = 0; i < meshes.length; i++) {
        var m = meshes[i];
        if (!m.parent && m.rotation !== undefined && m.getClassName() !== 'ArcRotateCamera') {
          if (m.name && m.name.indexOf('ground') >= 0) continue;
          root = m; break;
        }
      }
      return root ? Math.abs(((root.rotation.y || 0) % (Math.PI*2))) > 1 : false;
    };
    // 暴露一个给 UI/export 用的统一"模型根"获取
    window.__mmd.getModelRoot = function () {
      // 优先返回【当前选中模型】的根(babylon-mmd 根 mesh)
      var am = activeModel();
      if (am && am.mesh) return am.mesh;
      // 退回: 扫描场景找第一个无 parent 的非相机非地面根
      var meshes = scene.meshes || [];
      for (var i = 0; i < meshes.length; i++) {
        var m = meshes[i];
        if (!m.parent && m.rotation !== undefined && m.getClassName() !== 'ArcRotateCamera') {
          if (m.name && m.name.indexOf('ground') >= 0) continue;
          return m;
        }
      }
      return null;
    };
    // ===== 模型位置控制: 单独移动模型(默认在坐标零点), 不碰相机/场景 =====
    // 直接作用于模型根节点 position(骨骼动画是局部变换, 不受根节点位移影响)。
    // ⚠️ 需在物理/骨骼更新后也保持, 每帧 renderFrame 末尾保持一次。
    window.__mmd.setModelPosition = function (x, y, z) {
      var root = window.__mmd.getModelRoot && window.__mmd.getModelRoot();
      if (!root) return { ok: false, error: 'no model loaded' };
      if (typeof x === 'number') root.position.x = x;
      if (typeof y === 'number') root.position.y = y;
      if (typeof z === 'number') root.position.z = z;
      try { root.computeWorldMatrix(true); } catch (e) {}
      return { ok: true, pos: window.__mmd.getModelPosition ? window.__mmd.getModelPosition() : root.position };
    };
    window.__mmd.getModelPosition = function () {
      var root = window.__mmd.getModelRoot && window.__mmd.getModelRoot();
      return root ? { x: root.position.x, y: root.position.y, z: root.position.z } : null;
    };
    window.__mmd.moveModelBy = function (dx, dy, dz) {
      var root = window.__mmd.getModelRoot && window.__mmd.getModelRoot();
      if (!root) return { ok: false, error: 'no model loaded' };
      if (typeof dx === 'number') root.position.x += dx;
      if (typeof dy === 'number') root.position.y += dy;
      if (typeof dz === 'number') root.position.z += dz;
      return window.__mmd.setModelPosition(root.position.x, root.position.y, root.position.z);
    };
    // 探测当前 active 模型的脚底世界Y(遍历其下所有 mesh 的 bounding 求最低点)
    // 注: babylon-mmd 的根 mesh 不是脚底, 缩放中心在根 origin; 用此值做"缩放后贴地"校正。
    function poseProbeModelFootY(root) {
      try {
        var meshes = scene.meshes || [];
        var bottom = null;
        for (var i = 0; i < meshes.length; i++) {
          var m = meshes[i];
          if (m === root || m.parent === root) {
            try {
              m.refreshBoundingInfo(true);
              var bb = m.getBoundingInfo().boundingBox;
              if (bb && bb.minimumWorld && (bottom === null || bb.minimumWorld.y < bottom)) bottom = bb.minimumWorld.y;
            } catch (e) {}
          }
        }
        return bottom;   // 最低点世界Y(模型脚底)
      } catch (e) { return null; }
    }
    window.__mmd._probeModelFootY = function () {
      var root = window.__mmd.getModelRoot && window.__mmd.getModelRoot();
      return root ? poseProbeModelFootY(root) : null;
    };

    // ===== 播放控制在先: 用户显式暂停/播放/seek + 绝对时间驱动(恒1倍速) =====
    // _userPaused = 用户按暂停键(true=停在当前帧); 与"播放到结尾自动停"(_ended)区分。
    // seek 时重置 _absT0, 让绝对时间驱动从新帧继续计时, 不会被拉回。
    window.__mmd._userPaused = false;
    window.__mmd._ended = false;
    window.__mmd._loop = false;   // 循环播放(播放到结尾自动从头继续)
    window.__mmd.setLoop = function (on) { window.__mmd._loop = !!on; return { ok:true, loop:window.__mmd._loop }; };
    window.__mmd.play = function () {
      var rt = window.__mmd.mmdRuntime; if (!rt) return { ok:false, error:'no runtime' };
      window.__mmd._userPaused = false;
      rt._animationPaused = false;
      // 若已播到结尾, 重新标定从头播
      if (window.__mmd._ended) {
        window.__mmd._ended = false;
        window.__mmd._absT0 = undefined;
      }
      return { ok: true };
    };
    window.__mmd.pause = function () {
      var rt = window.__mmd.mmdRuntime; if (!rt) return { ok:false, error:'no runtime' };
      window.__mmd._userPaused = true;
      return { ok: true };
    };
    window.__mmd.togglePlay = function () {
      if (window.__mmd._userPaused) return window.__mmd.play(); else return window.__mmd.pause();
    };
    window.__mmd.seekTo = function (frame) {
      var rt = window.__mmd.mmdRuntime; if (!rt || !rt._animationFrameTimeDuration) return { ok:false };
      var f = Math.max(0, Math.min(rt._animationFrameTimeDuration, Number(frame)||0));
      rt._currentFrameTime = f;
      window.__mmd._ended = false;
      if (!window.__mmd._userPaused) {
        // 播放中 seek: 重置时间轴起点, 绝对时间驱动从新帧继续
        window.__mmd._absT0 = performance.now()/1000 - f/30;
      }
      return { ok: true, frame: f };
    };
    window.__mmd.getPlayback = function () {
      var rt = window.__mmd.mmdRuntime;
      return {
        paused: !!window.__mmd._userPaused || !!window.__mmd._ended,
        frame: rt ? (rt._currentFrameTime||0) : 0,
        total: rt ? (rt._animationFrameTimeDuration||0) : 0,
        duration: rt ? (rt._animationFrameTimeDuration||0)/30 : 0,  // 秒
        loop: !!window.__mmd._loop,
      };
    };

    scene.onBeforeRenderObservable.add(() => {
      try {
        const rt = window.__mmd.mmdRuntime;
        if (!rt) return;
        // 锁死动画速度系数为1, 防止被(音频/加载/导出)污染成倍速
        if (rt._animationTimeScale !== 1) { rt._animationTimeScale = 1; }

        // 绝对时间驱动: 在"非导出、有动作、非用户暂停"时, 用真实秒表把动画帧锁定到真实位置。
        if (!engine._mmdExporting && rt._animationFrameTimeDuration > 0 && !window.__mmd._userPaused) {
          const nowSec = performance.now() / 1000;
          // 起点标定: 从当前帧位置开始计时(加载/重播/seek 时重置 _absT0)
          if (typeof window.__mmd._absT0 !== 'number') {
            window.__mmd._absT0 = nowSec - rt._currentFrameTime / 30;
          }
          const target = (nowSec - window.__mmd._absT0) * 30;
          if (target >= rt._animationFrameTimeDuration) {
            if (window.__mmd._loop) {
              // 循环播放: 重置时间轴起点, 从头继续播(不进入 _ended 停止态)
              window.__mmd._absT0 = nowSec;
              rt._currentFrameTime = 0;
            } else {
              rt._currentFrameTime = rt._animationFrameTimeDuration;
              window.__mmd._ended = true;      // 播到结尾自动停(区别于用户暂停)
              window.__mmd._absT0 = undefined;
            }
          } else {
            rt._currentFrameTime = target;
          }
          // 同步 _animationPaused 状态(让 babylon-mmd 真正停/动)
          rt._animationPaused = window.__mmd._userPaused || window.__mmd._ended;
          return;
        }
        // ⚠️ 导出时强制动画可播(无视用户暂停): 否则若用户在导出前按了暂停, 导出会得到静止帧。
        if (engine._mmdExporting) { rt._animationPaused = false; return; }
        rt._animationPaused = window.__mmd._userPaused || window.__mmd._ended;
      } catch (e) {}
    });
    // 布料丝滑: 物理骨骼位置插值(在动画/物理更新后、渲染前, 让裙摆过渡更顺滑)
    scene.onBeforeRenderObservable.add(function () {
      var md = window.__mmd.mmdModel;
      if (md && window.__mmd._physSmoothTick) try { window.__mmd._physSmoothTick(md); } catch (e) {}
    });
    engine.runRenderLoop(renderFrame);
    scene.onBeforeRenderObservable.addOnce(() => {
      console.log("[debug] first render frame reached");
    });
    window.addEventListener("resize", function () {
      // ⚠️ 导出期间绝不能 resize: 否则 drawingBuffer 会被 engine.resize() 按 clientWidth×scaling 重算,
      // 覆盖导出用 engine.setSize(2160,3840) 设的尺寸 → 相机 aspect 错乱(如 0.5625→0.45) → 导出画面人到中段变瘦。
      // (真机日志: 导出前几秒正常、后段突然变窄 = 中途某帧触发了 window resize。)
      if (engine._mmdExporting) return;
      engine.resize();
    });
  } catch (e) {
    status.textContent = "[失败] " + (e && e.message ? e.message : e);
    console.error(e);
  }
}

main();

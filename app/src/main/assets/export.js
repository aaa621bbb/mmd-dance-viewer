/*
 * MMD export.js — 视频导出控制器(Web侧)
 * 通过 window.__mmd 逐帧确定性渲染, 每帧 JPEG 交给原生桥(MmdExportBridge)编码 MP4。
 *
 * 桥接口(原生):
 *   Android.onExportStart(configJson) {"width","height","fps","totalFrames","name"}
 *   Android.onExportFrame(jpegBase64)
 *   Android.onExportEnd() | Android.onExportCancel() | Android.onExportError(msg)
 *
 * 特点(v0.8.1):
 *   - 异步分帧渲染(每帧让出事件循环), 避免阻塞 WebView / 卡死
 *   - 进度条 + 动态估算剩余时间(基于实际帧耗时滑动平均)
 *   - 16:9 导出视口 + 固定全身相机
 *   - 出错不再静默, 通过 onError 上报; 结束时完整复位(含 _deltaTime), 避免污染实时预览
 */
(function () {
  if (window.__mmdExport) return;

  var EXPORTING = false;
  var FILE_QUALITY = 0.9;

  // 诊断日志: 经文件桥 AndroidFile.log 写进原生 MMDlog.txt(用户传回定位倍速/枚举)
  function MmdDiag(msg) {
    try {
      if (window.AndroidFile && window.AndroidFile.log) { window.AndroidFile.log(msg); }
    } catch (e) {}
  }

  function getEngine() { return window.__mmd && window.__mmd.engine; }
  function getScene() { return window.__mmd && window.__mmd.scene; }
  function getCamera() { return getScene() && getScene().activeCamera; }

  // 导出视角: 直接沿用用户当前实时视角(ArcRotateCamera 的 alpha/beta/radius/target)。
  // 不再覆盖成固定全身镜头(v0.8.8: 用户要求导出的就是自己预览里调的视角)。
  var savedCamera = null;

  function saveAndSetCamera() {
    var cam = getCamera();
    if (!cam || cam.radius === undefined) return;
    savedCamera = { radius: cam.radius, alpha: cam.alpha, beta: cam.beta,
      target: { x: cam.target.x, y: cam.target.y, z: cam.target.z },
      lowerRadiusLimit: cam.lowerRadiusLimit, upperRadiusLimit: cam.upperRadiusLimit };
    // 保持用户当前视角不变, 导出即用此视角逐帧渲染(不再写死 EXP_CAM)。
  }
  function restoreCamera() {
    var cam = getCamera();
    if (cam && savedCamera) {
      cam.radius = savedCamera.radius; cam.alpha = savedCamera.alpha; cam.beta = savedCamera.beta;
      cam.target.x = savedCamera.target.x; cam.target.y = savedCamera.target.y; cam.target.z = savedCamera.target.z;
      cam.lowerRadiusLimit = savedCamera.lowerRadiusLimit; cam.upperRadiusLimit = savedCamera.upperRadiusLimit;
    }
    savedCamera = null;
  }

  function tempViewport(engine, canvas, w, h) {
    var ow = canvas.width, oh = canvas.height;
    // ⚠️ 用 engine.setSize(w,h,true) 强制设【物理像素】→ WebGL drawingBuffer = w×h, 相机aspect = w/h 精确正确。
    //   不要同时改 canvas.style(ClientWidth/Height)——engine.resize/依 CSS×dpr 重算会得到错误 drawingBuffer,
    //   相机 aspect 随之错乱 → 导出画面被横向拉伸(人变瘦), 实测旧法 drawingBuffer 变 5122x6476、aspect 0.79。
    engine.setSize(w, h, true);
    return function () {
      engine.setSize(ow, oh, true);   // 还原物理尺寸(forceSetSize 强制写回)
      try { engine.resize(true); } catch (e) {}
    };
  }

  function captureFrame(canvas) {
    var url = canvas.toDataURL('image/jpeg', FILE_QUALITY);
    var comma = url.indexOf(',');
    if (comma < 0) throw new Error('capture_empty');
    return url.substring(comma + 1);
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var api = {
    isExporting: function () { return EXPORTING; },

    start: async function (config) {
      if (EXPORTING) return false;
      config = config || {};
      var fps = config.fps || 30;
      var w = config.width || 1280, h = config.height || 720;
      var totalFrames = config.totalFrames || Math.round((config.duration || 10) * fps);

      var engine = getEngine();
      if (!engine || !engine.getRenderingCanvas) { if (window.Android && Android.onExportError) Android.onExportError('engine_not_ready'); return false; }
      var canvas = engine.getRenderingCanvas();
      var origDelta = engine._deltaTime;   // 记录引擎原始 delta, 恢复时还原避免倍速

      var configJson = JSON.stringify({ width: w, height: h, fps: fps, totalFrames: totalFrames, name: config.name || 'MMD_export', quality: config.quality || 'standard' });

      EXPORTING = true;
      try { engine._mmdExporting = true; } catch (e) {}   // 通知 getDeltaTime override: 导出阶段用固定 frameMs
      var rt = window.__mmd.mmdRuntime;
      var prevPaused = rt ? rt._animationPaused : true;
      var prevFrameTime = rt ? rt._currentFrameTime : 0;
      var prevTimeScale = rt ? rt._animationTimeScale : 1;
      MmdDiag("export.start origDelta=" + (typeof origDelta === 'number' ? origDelta : '?') +
              " animTimeScale=" + (rt ? (typeof rt._animationTimeScale === 'number' ? rt._animationTimeScale : '?') : 'no-rt') +
              " animFrameTime=" + (rt ? (typeof rt._currentFrameTime === 'number' ? rt._currentFrameTime : '?') : '?') +
              " paused=" + (rt ? rt._animationPaused : '?'));
      var restoreViewport = null;
      var camActive = !!(getCamera() && getCamera().radius !== undefined);

      var onProgress = config.onProgress || function () {};
      var onDone = config.onDone || function () {};
      var failFlag = false;

      // 进度估算(滑动平均)
      var elapsedTotal = 0, renderedFrames = 0, estRemainStart = null;

      function reportError(msg) {
        if (window.Android && Android.onExportError) { try { Android.onExportError(msg); } catch (e) {} }
      }
      function checkErr() {
        // 原生通过 onExportError 上报错误; 这里也做 JS 侧兜底
        return false;
      }

      try {
        if (!window.Android || !window.Android.onExportStart) { EXPORTING = false; return false; }
        Android.onExportStart(configJson);

        // 停实时循环, 从头播放
        engine.stopRenderLoop();
        if (rt) { rt._animationPaused = false; rt._currentFrameTime = 0; rt._animationTimeScale = 1; }

        restoreViewport = tempViewport(engine, canvas, w, h);
        // ⚠️ 导出必须用全画布渲染(导出是独立 setSize), 清掉预览取景的 viewport, 否则相机被限制在取景框内
        if (window.__mmd && window.__mmd.resetPreviewViewport) { try { window.__mmd.resetPreviewViewport(); } catch (e) {} }
        if (camActive) saveAndSetCamera();

        var frameMs = Math.round(1000 / fps);
        var t0 = performance.now();

        for (var f = 0; f < totalFrames; f++) {
          if (!EXPORTING || failFlag) break;

          var fs = performance.now();
          engine._deltaTime = frameMs;
          getScene().render();
          var jpeg = captureFrame(canvas);
          Android.onExportFrame(jpeg);

          renderedFrames = f + 1;
          var frameCost = performance.now() - fs;
          elapsedTotal += frameCost;

          // 进度 + 动态估时(每 5 帧刷新一次估算)
          if ((f % 5) === 4 || f === 0 || f === totalFrames - 1) {
            var avgMs = elapsedTotal / renderedFrames;
            var remainFrames = totalFrames - renderedFrames;
            var remainSec = avgMs * remainFrames / 1000;
            onProgress(renderedFrames, totalFrames, remainSec);
          }

          // 让出事件循环(非阻塞), 顺带给 UI 刷新
          if ((f % 30) === 29) { await sleep(1); }
          else { await sleep(0); }
        }

        Android.onExportEnd();
        onDone(!(failFlag));
        return true;
      } catch (e) {
        var msg = String(e && e.message || e);
        reportError(msg);
        onDone(false);
        return false;
      } finally {
        // 完整复位: 视口 + 相机 + 动画状态 + 引擎 delta(还原为导出前)
        EXPORTING = false;
        try { engine._mmdExporting = false; } catch (e) {}   // 恢复 getDeltaTime 到真实测量模式
        if (restoreViewport) { try { restoreViewport(); } catch (e) {} }
        if (camActive) restoreCamera();
        if (rt) {
          rt._animationPaused = prevPaused;
          rt._currentFrameTime = prevFrameTime;
          // 强制归一化速度系数, 不恢复可疑的 prevTimeScale(防倍速污染)
          rt._animationTimeScale = 1;
        }
        // 还原引擎 delta 并交由实时循环用真实时间推进;
        // 仅在正常范围(1~40ms)保留原值, 否则归一到 16ms 防残留 frameMs 造成倍速/冻结
        try {
          var okDelta = (typeof origDelta === 'number' && origDelta > 1 && origDelta <= 40) ? origDelta : 16;
          engine._deltaTime = okDelta;
        } catch (e) {}
        MmdDiag("export.end delta=" + (typeof engine._deltaTime === 'number' ? engine._deltaTime : '?') +
                " origDelta=" + (typeof origDelta === 'number' ? origDelta : '?') +
                " prevTimeScale=" + (typeof prevTimeScale === 'number' ? prevTimeScale : '?') +
                " prevFrameTime=" + (typeof prevFrameTime === 'number' ? prevFrameTime : '?') +
                " prevPaused=" + prevPaused);
        engine.stopRenderLoop();
        // 复用 main.js 暴露的唯一 renderFrame(见其注释: 多 arrow 引用会叠加 render loop → 每帧 render 多次卡顿)
        var renderFrame = (window.__mmd && window.__mmd.renderFrame) || function () { if (window.__mmd.scene) window.__mmd.scene.render(); };
        engine.runRenderLoop(renderFrame);
        MmdDiag("export.loopRestarted");
      }
    },

    cancel: function () { EXPORTING = false; try { window.__mmd && window.__mmd.engine && (window.__mmd.engine._mmdExporting = false); } catch (e) {} }
  };

  window.__mmdExport = api;
})();

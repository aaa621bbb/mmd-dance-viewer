package com.mmd.preview

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Build
import android.os.Environment
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader
import java.io.File
import java.io.FileOutputStream
import java.io.PrintWriter
import java.io.StringWriter

class MainActivity : Activity() {

    private lateinit var fileBridge: MmdFileBridge

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        MmdLog.init(this)
        MmdLog.i("MainActivity.onCreate")
        // 崩溃日志捕获: 把未捕获异常写到 /sdcard/MMDcrash.txt
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val sw = StringWriter()
                throwable.printStackTrace(PrintWriter(sw))
                val dir = File(getExternalFilesDir(null), "MMDcrash.txt")
                dir.parentFile?.mkdirs()
                FileOutputStream(dir).use { it.write(sw.toString().toByteArray()) }
            } catch (ignored: Exception) {}
            // 默认崩溃处理
            android.os.Process.killProcess(android.os.Process.myPid())
        }

        try {
            init()
        } catch (e: Exception) {
            e.printStackTrace()
            Toast.makeText(this, "启动失败: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun init() {
        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        val webView = WebView(this)
        setContentView(webView)
        // ✨ 沉浸全屏(隐藏状态栏/导航栏) — 从 v0.21.11 回溯补回主版本(v0.21.10基线)。已确认与该系列黑屏无关。
        enableImmersiveMode()

        // 导出桥: JS 通过 window.Android 调用原生 MediaCodec 合成 MP4
        val exportBridge = MmdExportBridge(this)
        exportBridge.onFinished = { file ->
            runOnUiThread {
                Toast.makeText(
                    this,
                    if (file != null) "导出完成: ${file.absolutePath}" else "导出已取消",
                    Toast.LENGTH_LONG
                ).show()
            }
        }
        exportBridge.onError = { msg ->
            runOnUiThread { Toast.makeText(this, "导出出错: $msg", Toast.LENGTH_LONG).show() }
        }
        exportBridge.onProgress = { frame, total ->
            // 首版不实时刷新 UI(避免频繁主线程); 后续接进度条
        }
        webView.addJavascriptInterface(exportBridge, "Android")

        // UI 桥: 前端通过 window.AndroidUI 调用原生 UI 能力(竖/横屏切换等)
        val uiBridge = MmdUiBridge(this)
        webView.addJavascriptInterface(uiBridge, "AndroidUI")

        // 文件桥: JS 通过 window.AndroidFile 选文件夹/枚举/加载外部模型动作
        fileBridge = MmdFileBridge(this)
        fileBridge.onFolderPicked = { count ->
            runOnUiThread {
                webView.evaluateJavascript(
                    "window.__afterFolder && window.__afterFolder($count)", null
                )
            }
        }
        webView.addJavascriptInterface(fileBridge, "AndroidFile")

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            javaScriptCanOpenWindowsAutomatically = true
            mediaPlaybackRequiresUserGesture = false
            databaseEnabled = true
            setSupportMultipleWindows(false)
            cacheMode = WebSettings.LOAD_NO_CACHE
        }
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
            webView.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                val urlStr = request.url.toString()
                try {
                    // 外部文件夹虚拟域: http://mmdext/<相对路径> -> 从 SAF 选中的文件夹读
                    if (urlStr.startsWith("http://" + MmdFileBridge.HOST + "/")) {
                        // CORS 预检(浏览器会把跨域请求发 OPTIONS 先探): 直接放行
                        if ("OPTIONS".equals(request.method, ignoreCase = true)) {
                            return WebResourceResponse(
                                "text/plain", "UTF-8", 200, "OK",
                                mapOf(
                                    "Access-Control-Allow-Origin" to "*",
                                    "Access-Control-Allow-Methods" to "GET, POST, OPTIONS",
                                    "Access-Control-Allow-Headers" to "*",
                                    "Access-Control-Max-Age" to "86400"
                                ), null
                            )
                        }
                        val relRaw = urlStr.substring(("http://" + MmdFileBridge.HOST + "/").length)
                        // ⚠️ WebView 收到的请求 path 可能是 percent-encodded(%E6%98%9F...) 或原始中文, 
                        // 统一解码 + 规范化后才拿去匹配文件系统里的真实文件名
                        var rel = relRaw
                        try { if (rel.contains("%")) rel = android.net.Uri.decode(rel) } catch (e: Exception) {}
                        MmdLog.i("[mmdext] req method=${request.method} rel=[$rel] raw=[${relRaw.take(40)}]")
                        val stream = fileBridge.openRelative(rel)
                        if (stream != null) {
                            // ⚠️ 必须带 CORS 头: 页面在 https://appassets..., 请求 http://mmdext 是跨域,
                            // 无 CORS 头则 babylon 的 fetch/XHR 加载 PMX/贴图会失败 → 选模型加载失败。
                            return WebResourceResponse(
                                guessMime(rel), "UTF-8", 200, "OK",
                                mapOf("Access-Control-Allow-Origin" to "*"),
                                stream
                            )
                        }
                        // openRelative 找不到文件 → 这里不能 return null(否则 WebView 走真实网络失败 status 0)
                        MmdLog.e("[mmdext] NOT FOUND rel=[$rel] → 返回404")
                        return WebResourceResponse(
                            "text/plain", "UTF-8", 404, "Not Found",
                            mapOf("Access-Control-Allow-Origin" to "*"), null
                        )
                    }
                    if (urlStr.endsWith(".wasm")) {
                        val relativePath = urlStr.removePrefix("https://appassets.androidplatform.net/")
                        try {
                            val stream = assets.open(relativePath)
                            return WebResourceResponse("application/wasm", "UTF-8", stream)
                        } catch (e: Exception) {
                            // wasm 找不到, 返回兜底 null 交给 loader
                            return null
                        }
                    }
                    return assetLoader.shouldInterceptRequest(request.url)
                } catch (e: Exception) {
                    // 任何拦截异常都不能抛(否则拖垮 WebView 直接崩溃)
                    return null
                }
            }
        }

        // 启动时自动恢复上次记住的文件夹(不用每次重选)
        try { fileBridge.tryRestoreLastFolder() } catch (e: Exception) { MmdLog.e("restore last folder fail ${e.message}") }

        webView.loadUrl("https://appassets.androidplatform.net/index.html")
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == MmdFileBridge.REQ_OPEN_DIR) {
            fileBridge.onFolderResult(resultCode, data)
        }
    }

    private fun guessMime(path: String): String {
        val low = path.lowercase()
        return when {
            low.endsWith(".pmx") -> "application/octet-stream"
            low.endsWith(".pmd") -> "application/octet-stream"
            low.endsWith(".vmd") -> "application/octet-stream"
            low.endsWith(".vpd") -> "application/octet-stream"
            low.endsWith(".glb") -> "model/gltf-binary"
            low.endsWith(".gltf") -> "model/gltf+json"
            low.endsWith(".obj") -> "text/plain"          // OBJ 网格(配 .mtl)
            low.endsWith(".mtl") -> "text/plain"          // OBJ 材质库
            low.endsWith(".stl") -> "model/stl"           // STL 纯几何(可能为 ascii, text/plain 也可)
            low.endsWith(".babylon") -> "application/json" // Babylon 原生场景
            low.endsWith(".png") -> "image/png"
            low.endsWith(".tga") -> "image/x-targa"
            low.endsWith(".bmp") -> "image/bmp"
            low.endsWith(".jpg") || low.endsWith(".jpeg") -> "image/jpeg"
            low.endsWith(".mp3") -> "audio/mpeg"
            low.endsWith(".m4a") || low.endsWith(".aac") -> "audio/mp4"
            low.endsWith(".wav") -> "audio/wav"
            low.endsWith(".ogg") -> "audio/ogg"
            else -> "application/octet-stream"
        }
    }

    // ✨ 沉浸全屏: 隐藏状态栏 + 导航栏, 不占画面(从 v0.21.11 回溯补回)。
    //   IMMERSIVE_STICKY: 边缘下拉可临时唤出系统栏, 几秒后自动再隐藏。兼容 Android 10- 与 11+。
    private fun enableImmersiveMode() {
        try {
            window.statusBarColor = android.graphics.Color.TRANSPARENT
            window.navigationBarColor = android.graphics.Color.TRANSPARENT
            val decor = window.decorView
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                decor.systemUiVisibility =
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                    View.SYSTEM_UI_FLAG_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            } else {
                window.setDecorFitsSystemWindows(false)
                window.insetsController?.let { c ->
                    c.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    c.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                }
            }
        } catch (e: Exception) {
            MmdLog.i("immersive fail: ${e.message}")
        }
    }

    // 沉浸模式下: 重新获焦(dialog/返回/唤醒等)后系统栏可能恢复, 需再次隐藏
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enableImmersiveMode()
    }
}

package com.mmd.preview

import android.app.Activity
import android.content.ContentValues
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.media.MediaMuxer
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.view.Surface
import android.webkit.JavascriptInterface
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * JS ↔ 原生桥: 接收 WebView 逐帧 JPEG, 用 MediaCodec(Surface输入) + MediaMuxer 合成 MP4。
 *
 * 调用方(export.js):
 *   Android.onExportStart(configJson) {"width","height","fps","totalFrames","name"}
 *   Android.onExportFrame(jpegBase64)  每帧
 *   Android.onExportEnd() | onExportCancel() | onExportError(msg)
 *
 * 编码: MediaCodec 编码器 + 输入 Surface(每帧 Bitmap 画到 Surface), 硬件编码器稳定支持。
 *       drain 线程消费输出并在写 MediaMuxer 时按帧号覆盖 pts => 精确控制时长(不再随渲染耗时漂移)。
 * 输出: 先写 App 私有临时文件, 完成后转存到公共 Download/MMD(MediaStore), 安卓10+ 零权限。
 */
class MmdExportBridge(private val activity: Activity) {

    companion object {
        private const val TAG = "MmdExport"
    }

    @Volatile var onProgress: ((frame: Int, total: Int) -> Unit)? = null
    @Volatile var onFinished: ((outFile: File?) -> Unit)? = null
    @Volatile var onError: ((msg: String) -> Unit)? = null

    @Volatile private var running = false
    @Volatile private var cancelled = false
    private val drainStop = AtomicBoolean(true)

    private var encoder: MediaCodec? = null
    private var inputSurface: Surface? = null
    private var muxer: MediaMuxer? = null
    private var muxerTrack = -1
    private var muxerStarted = false
    private var drainThread: Thread? = null

    private var outFile: File? = null
    private var width = 1280
    private var height = 720
    private var fps = 30
    private var quality = "standard"
    private var frameCount = 0
    private var totalFrames = 0
    private var outputName = "MMD_export"
    private var failStreak = 0

    val isRunning: Boolean get() = running

    // ============ JS 入口 ============

    @JavascriptInterface
    fun onExportStart(configJson: String) {
        if (running) return
        try {
            // ⚠️ 必须彻底清理上一次导出的残留状态(编码器/输入Surface/MediaMuxer/muxerTracker/nuxerStarted/drain线程),
            // 否则 muxerStarted 残留 true 会让本次 INFO_OUTPUT_FORMAT_CHANGED 时跳过 addTrack →
            // 新 muxer 未 start、trackIndex 无效 → 每帧 writeSample err, tmp 0B, 导出(尤其第二次)失败。
            // (日志证据: 第一次 2160x3840 成功, 第二次 1080x1920 起就 writeSample err trackIndex is invalid, final=null)
            drainStop.set(true); drainThread?.interrupt()
            drainThread = null
            releaseCodec()

            val cfg = parseConfig(configJson)
            width = cfg.width; height = cfg.height; fps = cfg.fps; quality = cfg.quality
            outputName = cfg.name.ifBlank { "MMD_export" }
            val dir = File(activity.getExternalFilesDir(null), "export").apply { mkdirs() }
            outFile = File(dir, "tmp_encode.mp4")
            totalFrames = cfg.totalFrames
            frameCount = 0
            failStreak = 0
            cancelled = false

            startEncoder(width, height, fps, quality)
            muxer = MediaMuxer(outFile!!.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            running = true
            startDrainThread()
            MmdLog.i("onExportStart ${width}x${height}@${fps} total=$totalFrames surface=$inputSurface tmp=$outFile")
        } catch (e: Exception) {
            MmdLog.e("onExportStart fail ${e.message}")
            running = false
            releaseCodec()
            onError?.invoke(e.message ?: "start_fail")
        }
    }

    @JavascriptInterface
    fun onExportFrame(jpegBase64: String) {
        if (!running || cancelled) return
        if (jpegBase64 == null || jpegBase64.length < 16) { MmdLog.e("onExportFrame: jpeg too short"); return }
        try {
            val bytes = Base64.decode(jpegBase64, Base64.DEFAULT)
            val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                ?: throw IllegalStateException("decode jpeg null (bytes=${bytes.size})")
            val src = if (bmp.width != width || bmp.height != height)
                Bitmap.createScaledBitmap(bmp, width, height, true)
            else bmp
            val surface = inputSurface ?: throw IllegalStateException("no surface")
            val canvas = surface.lockCanvas(null)
            try {
                canvas.drawBitmap(src, 0f, 0f, null)
            } finally {
                surface.unlockCanvasAndPost(canvas)
            }
            if (src !== bmp) src.recycle()
            bmp.recycle()
            frameCount++
            if (frameCount == 1 || frameCount % 100 == 0 || frameCount == totalFrames) {
                MmdLog.i("onExportFrame #$frameCount/$totalFrames")
            }
            onProgress?.invoke(frameCount, totalFrames)
        } catch (e: Exception) {
            MmdLog.e("onExportFrame fail $e")
            Log.e(TAG, "frame fail", e)
            failStreak++
            if (failStreak > 20) {
                MmdLog.e("too many frame failures, abort export")
                running = false
                cancelled = true
                drainStop.set(true); drainThread?.interrupt()
                releaseCodec()
                onError?.invoke("编码失败(连续多帧失败): ${e.message}")
            }
        }
    }

    @JavascriptInterface
    fun onExportEnd() {
        if (!running || cancelled) return
        MmdLog.i("onExportEnd frames=$frameCount")
        try { encoder?.signalEndOfInputStream() } catch (e: Exception) { MmdLog.e("signalEOS $e") }
        waitDrainThread()
        running = false
        onProgress?.invoke(frameCount, totalFrames)
        val finalFile = if (!cancelled) saveToDownload() else null
        MmdLog.i("onExportEnd done frames=$frameCount final=${finalFile?.absolutePath}")
        // 彻底释放编码器/输入Surface, 避免泄漏; muxer 已在 drain 线程里 stop/release
        releaseCodec()
        onFinished?.invoke(finalFile)
    }

    @JavascriptInterface
    fun onExportCancel() {
        MmdLog.i("onExportCancel")
        cancelled = true
        running = false
        drainStop.set(true); drainThread?.interrupt()
        releaseCodec()
        runCatching { outFile?.delete() }
    }

    @JavascriptInterface
    fun onExportError(msg: String) {
        MmdLog.e("JS error: $msg")
        onError?.invoke(msg)
    }

    // ============ 编码 ============

    private fun startEncoder(w: Int, h: Int, f: Int, q: String = "standard") {
        // 编码器能力检测 + 分辨率超限自动缩放:
        // 竖屏4K(2160x3840)等超硬件H.264上限时会静默失败(tmp 0B, 导出"100%后自动取消")。
        // 用 MediaCodecList 查 AVC 编码器最大尺寸, 超了就按比例缩到安全范围, 保证能出片。
        var cw = w; var ch = h
        val maxWH = queryAvcEncoderMaxSize()
        if (maxWH > 0 && (cw > maxWH || ch > maxWH)) {
            val scale = maxWH.toDouble() / Math.max(cw, ch)
            cw = (cw * scale + 0.5).toInt(); ch = (ch * scale + 0.5).toInt()
            if (cw % 2 != 0) cw++; if (ch % 2 != 0) ch++
            MmdLog.i("resolve: ${w}x$h -> ${cw}x$ch (encoder max=$maxWH)")
        }
        width = cw; height = ch

        val fmt = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, cw, ch)
        fmt.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
        // 码率: standard=像素×3, high=像素×4.5(更清晰), 上限放宽到 60M
        val bpp = if (q.equals("high", ignoreCase = true)) 4.5 else 3.0
        val bitrate = (cw * ch * bpp).toInt().coerceIn(2_500_000, 60_000_000)
        fmt.setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
        fmt.setInteger(MediaFormat.KEY_FRAME_RATE, f)
        fmt.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
        val enc = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        enc.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        inputSurface = enc.createInputSurface()
        encoder = enc
        enc.start()
    }

    /** 用 MediaCodecList 查 H.264 编码器支持的最大单边尺寸; 查不到返回 0(不限制). */
    private fun queryAvcEncoderMaxSize(): Int {
        return try {
            val list = MediaCodecList(MediaCodecList.REGULAR_CODECS)
            var best = 0
            for (codec in list.codecInfos) {
                if (!codec.isEncoder || !codec.isHardwareAccelerated) continue
                val types = codec.supportedTypes
                if (!types.contains(MediaFormat.MIMETYPE_VIDEO_AVC)) continue
                // getCapabilitiesForType 可为 null; videoCapabilities 是【单个】VideoCapabilities(非数组)。
                // (方法表确认 Android34: getSupportedWidths/getSupportedHeights 返回 Range<Integer>)
                val videoCap = codec.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC)
                    ?.videoCapabilities ?: continue
                val wh = videoCap.getSupportedWidths()?.upper?.toInt() ?: 0
                val hh = videoCap.getSupportedHeights()?.upper?.toInt() ?: 0
                val m = Integer.max(wh, hh)
                if (m > best) best = m
            }
            MmdLog.i("avc encoder max size = $best")
            best
        } catch (e: Exception) { MmdLog.e("queryAvc err ${e.message}"); 0 }
    }

    /** drain 线程: 消费编码输出, 写 MediaMuxer. 用内部帧号覆盖 pts 以实现精确 30fps 时长. */
    private fun startDrainThread() {
        drainStop.set(false)
        val enc = encoder ?: return
        val t = Thread {
            val info = MediaCodec.BufferInfo()
            var encodedFrame = 0
            while (!drainStop.get()) {
                val idx = try { enc.dequeueOutputBuffer(info, 20_000L) } catch (e: Exception) { MediaCodec.INFO_TRY_AGAIN_LATER }
                when {
                    idx == MediaCodec.INFO_TRY_AGAIN_LATER -> { /* 等待 */ }
                    idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> runCatching {
                        val m = muxer
                        if (m != null && !muxerStarted) {
                            muxerTrack = m.addTrack(enc.outputFormat)
                            m.start(); muxerStarted = true
                        }
                    }
                    idx >= 0 -> {
                        val buf = enc.getOutputBuffer(idx)
                        if (buf != null && info.size > 0) {
                            // 用帧号精确覆盖 pts (Surface 模式系统 pts 是 real-time, 会造成时长漂移)
                            val fixed = MediaCodec.BufferInfo()
                            fixed.set(0, info.size, encodedFrame * 1_000_000L / fps, info.flags)
                            buf.position(info.offset); buf.limit(info.offset + info.size)
                            if (muxer != null && muxerStarted && muxerTrack >= 0) {
                                try { muxer!!.writeSampleData(muxerTrack, buf, fixed) }
                                catch (e: Exception) { MmdLog.e("writeSample err ${e.message}") }
                            } else {
                                MmdLog.e("drain skip write muxerStarted=$muxerStarted track=$muxerTrack")
                            }
                            encodedFrame++
                        } else {
                            if (idx >= 0) MmdLog.e("drain bufNull size=${info.size}")
                        }
                        enc.releaseOutputBuffer(idx, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                    }
                }
            }
            runCatching { muxer?.stop() }
            runCatching { muxer?.release() }
            muxer = null
        }
        t.name = "mmd-export-drain"
        t.isDaemon = true
        drainThread = t
        t.start()
    }

    private fun waitDrainThread() {
        drainThread?.let {
            var waited = 0
            while (it.isAlive && waited < 60) { runCatching { Thread.sleep(100) }; waited++ }
        }
        drainStop.set(true)
        drainThread = null
    }

    private fun releaseCodec() {
        runCatching { muxer?.stop() }; runCatching { muxer?.release() }
        runCatching { inputSurface?.release() }
        runCatching { encoder?.stop() }; runCatching { encoder?.release() }
        inputSurface = null; encoder = null; muxer = null; muxerTrack = -1; muxerStarted = false
    }

    // ============ 输出到 Download/MMD ============

    private fun saveToDownload(): File? {
        val tmp = outFile ?: return null
        if (!tmp.exists() || tmp.length() == 0L) {
            MmdLog.e("saveToDownload tmp 0B exists=${tmp.exists()} len=${tmp.length()}"); return null
        }
        MmdLog.i("saveToDownload tmp=${tmp.length()}B")
        return try {
            if (android.os.Build.VERSION.SDK_INT >= 29) saveToMediaStoreV29(tmp)
            else saveToLegacyDir(tmp)
        } catch (e: Exception) { MmdLog.e("saveToDownload err ${e.message}"); null }
    }

    @android.annotation.SuppressLint("NewApi")
    private fun saveToMediaStoreV29(tmp: File): File? {
        val fileName = "${safeName()}.mp4"
        val resolved = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
            put(MediaStore.MediaColumns.MIME_TYPE, "video/mp4")
            put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/MMD")
        }
        val resolver = activity.contentResolver
        val collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val uri = try { resolver.insert(collection, resolved) } catch (e: Exception) { MmdLog.e("insert err ${e.message}"); null } ?: return null
        val os = try { resolver.openOutputStream(uri) } catch (e: Exception) { MmdLog.e("os err ${e.message}"); null } ?: return null
        try { os.use { out -> tmp.inputStream().use { inp -> inp.copyTo(out) } } }
        catch (e: Exception) { MmdLog.e("copy err ${e.message}"); return null }
        runCatching { tmp.delete() }
        val path = File(android.os.Environment.getExternalStoragePublicDirectory(
            android.os.Environment.DIRECTORY_DOWNLOADS), "MMD/$fileName").absolutePath
        MmdLog.i("saveToMediaStore OK -> $path")
        return File(path)
    }

    private fun saveToLegacyDir(tmp: File): File? {
        val outDir = File(android.os.Environment.getExternalStoragePublicDirectory(
            android.os.Environment.DIRECTORY_DOWNLOADS), "MMD")
        if (!outDir.exists() && !outDir.mkdirs()) return null
        val target = File(outDir, "${safeName()}.mp4")
        tmp.inputStream().use { inp -> target.outputStream().use { out -> inp.copyTo(out) } }
        runCatching { tmp.delete() }
        return target
    }

    private fun safeName(): String {
        val n = outputName.replace(Regex("[^0-9A-Za-z\\u4e00-\\u9fa5_-]"), "_").trim()
        return if (n.isBlank()) "MMD_export" else n
    }

    private fun parseConfig(json: String): ExportConfig {
        fun num(key: String): Int =
            Regex("\"$key\"\\s*:\\s*(\\d+)").find(json)?.groupValues?.get(1)?.toIntOrNull() ?: 0
        fun str(key: String): String =
            Regex("\"$key\"\\s*:\\s*\"([^\"]*)\"").find(json)?.groupValues?.get(1) ?: ""
        return ExportConfig(
            num("width").takeIf { it > 0 } ?: 1280,
            num("height").takeIf { it > 0 } ?: 720,
            num("fps").takeIf { it in 1..60 } ?: 30,
            num("totalFrames"),
            str("name"),
            str("quality").ifBlank { "standard" }
        )
    }

    private class ExportConfig(val width: Int, val height: Int, val fps: Int, val totalFrames: Int, val name: String, val quality: String)
}

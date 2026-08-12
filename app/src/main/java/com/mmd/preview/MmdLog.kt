package com.mmd.preview

import android.content.Context
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 运行时日志: 同时打印 Logcat 并追加写入 MMDlog.txt (App 私有目录, 用户可拿)。
 */
object MmdLog {
    private const val TAG = "MmdDiag"
    @Volatile private var file: File? = null

    fun init(ctx: Context) {
        try {
            val dir = ctx.getExternalFilesDir(null) ?: ctx.filesDir
            file = File(dir, "MMDlog.txt")
            file?.writeText("=== MMD log ${timestamp()} ===\n")
        } catch (e: Exception) {
            file = null
        }
    }

    fun i(msg: String) {
        Log.i(TAG, msg)
        append("I", msg)
    }

    fun w(msg: String) {
        Log.w(TAG, msg)
        append("W", msg)
    }

    fun e(msg: String) {
        Log.e(TAG, msg)
        append("E", msg)
    }

    private fun append(level: String, msg: String) {
        val f = file ?: return
        try {
            f.appendText("[$level ${timestamp()}] $msg\n")
        } catch (ignored: Exception) {}
    }

    private fun timestamp(): String =
        SimpleDateFormat("HH:mm:ss.SSS", Locale.US).format(Date())
}

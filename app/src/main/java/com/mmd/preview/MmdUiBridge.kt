package com.mmd.preview

import android.app.Activity
import android.webkit.JavascriptInterface

/**
 * UI 桥: 前端通过 window.AndroidUI 调用原生 UI 能力。
 *
 * 当前能力:
 *   · setOrientation(mode)  — portrait / landscape / sensor(跟随系统自动旋转), 切换竖/横屏
 *   · getOrientation()      — 返回当前屏幕方向(lanlandscape/portrait/unknown)
 *
 * 与 MmdFileBridge / MmdExportBridge 同款独立命名桥, 保证 @JavascriptInterface 反射可靠。
 */
class MmdUiBridge(private val activity: Activity) {

    @JavascriptInterface
    fun setOrientation(mode: String) {
        activity.runOnUiThread {
            val orient = when (mode) {
                "portrait" -> android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                "landscape" -> android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                "sensor" -> android.content.pm.ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
                else -> android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
            activity.requestedOrientation = orient
            MmdLog.i("[AndroidUI] setOrientation=$mode -> $orient")
        }
    }

    @JavascriptInterface
    fun getOrientation(): String {
        return when (activity.resources.configuration.orientation) {
            android.content.res.Configuration.ORIENTATION_LANDSCAPE -> "landscape"
            android.content.res.Configuration.ORIENTATION_PORTRAIT -> "portrait"
            else -> "unknown"
        }
    }
}

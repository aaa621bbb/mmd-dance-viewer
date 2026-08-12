package com.mmd.preview

import android.app.Activity
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.provider.DocumentsContract
import android.util.Log
import java.io.InputStream

/**
 * 外部模型/动作/表情/场景/BGM 文件夹访问(SAF) —— 缓存驱动原生桥, 按【文件夹名】分类。
 *
 * 需求(v0.18): 用户选一个大文件夹, 内含子文件夹:
 *   · 模型/  → 人物 PMX/PMD(可再分子目录)
 *   · 动作/  → 一个舞蹈一个子文件夹, 内含 动作.vmd/表情.vmd/相机.vmd(vmd 文件)
 *   · 场景/  → 场景文件(blend 等, 暂只列不处理)
 *   · BGM/   → 音乐
 * 分类依据 = 子文件夹名, 不再看文件扩展名。每个文件保留【相对 root 的完整路径】供加载。
 * 动作/表情/相机不做文件级区分(文件名原样展示), 由 JS 加载后按内容的帧类型自动套用。
 */
class MmdFileBridge(private val activity: Activity) {

    companion object {
        private const val TAG = "MmdFile"
        const val HOST = "mmdext"
        const val REQ_OPEN_DIR = 7001
        // 四类子文件夹名(大文件夹根下)
        val DIR_MODELS = setOf("模型", "model", "Model")
        val DIR_MOTIONS = setOf("动作", "motion", "Motion", "anims")
        val DIR_SCENES = setOf("场景", "scene", "Scene")
        val DIR_AUDIOS = setOf("BGM", "bgm", "音乐", "music", "Music")
    }

    @Volatile var onFolderPicked: ((count: Int) -> Unit)? = null

    private var rootUri: Uri? = null

    // ===== 枚举缓存(一次性后台扫描填充, JS 只读) =====
    @Volatile private var cachedModels: List<Item> = emptyList()
    @Volatile private var cachedModelGroups: LinkedHashMap<String, LinkedHashMap<String, Item>> = LinkedHashMap()  // 模型子文件夹名 → {itemName → Item(pmx/pmd)}, 分组展示
    @Volatile private var cachedActionGroups: LinkedHashMap<String, LinkedHashMap<String, Item>> = LinkedHashMap()   // 舞蹈文件夹名 → {itemName → Item(vmd)}, 内含 kind
    @Volatile private var cachedScenes: List<Item> = emptyList()
    @Volatile private var cachedAudios: List<Item> = emptyList()
    @Volatile private var scanning = false

    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())

    /** 由 MainActivity 在 onActivityResult 里转发进来。 */
    fun onFolderResult(resultCode: Int, data: Intent?) {
        if (resultCode != Activity.RESULT_OK || data == null) return
        val uri = data.data ?: return
        try {
            activity.contentResolver.takePersistableUriPermission(
                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
        } catch (e: Exception) {
            Log.w(TAG, "persist perm fail", e)
        }
        rootUri = uri
        MmdLog.i("onFolderResult uri=$uri")
        saveLastFolder(uri.toString())
        rescan()
    }

    // ===== 记住上次选的文件夹(下次打开自动用, 不用再选一次) =====
    private fun prefs(): SharedPreferences =
        activity.getSharedPreferences("mmd_folder", Activity.MODE_PRIVATE)

    private fun saveLastFolder(uriStr: String) {
        try {
            prefs().edit().putString("last_uri", uriStr).apply()
            MmdLog.i("last folder saved: $uriStr")
        } catch (e: Exception) {
            Log.w(TAG, "save last folder fail", e)
        }
    }

    /** 从偏好里恢复上次选的文件夹; 若成功返回 uri 字符串, 否则返回 null。权限在 MainActivity 恢复。 */
    fun restoreLastFolder(): String? {
        return try {
            prefs().getString("last_uri", null)
        } catch (e: Exception) {
            null
        }
    }

    /** 清除记住的文件夹(用户主动重置时调用; 前端 setTimeout 兜底判定是否需要)。 */
    fun clearLastFolder() {
        try { prefs().edit().clear().apply() } catch (e: Exception) {}
    }

    fun getLastFolderJs(): String? = restoreLastFolder()

    /** 后台一次性全量扫描, 填充缓存; 完成后回调 JS 刷新。 */
    fun rescan() {
        if (scanning) return
        scanning = true
        Thread {
            var total = 0
            try {
                MmdLog.i("rescan start")
                val r = scanAll()
                cachedModels = r.model; cachedModelGroups = r.modelGroups; cachedActionGroups = r.actionGroups; cachedScenes = r.scene; cachedAudios = r.audio
                var grpCnt = 0; var grpItems = 0
                r.actionGroups.forEach { (_, v) -> grpCnt++; grpItems += v.size }
                var mGrp = 0; var mItems = 0
                r.modelGroups.forEach { (_, v) -> mGrp++; mItems += v.size }
                total = r.model.size + mItems + grpItems + r.scene.size + r.audio.size
                MmdLog.i("rescan model=${r.model.size}(${mGrp}组) actionGroups=$grpCnt(vmd=$grpItems) scene=${r.scene.size} audio=${r.audio.size}")
            } catch (t: Throwable) {
                MmdLog.e("rescan err $t")
            }
            scanning = false
            val cnt = total
            mainHandler.post { onFolderPicked?.invoke(cnt) }
        }.apply { name = "mmd-saf-scan"; start() }
    }

    /** 弹系统文件夹选择器(切主线程). */
    fun chooseFolder() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION
                        or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            )
        }
        try {
            mainHandler.post { activity.startActivityForResult(intent, REQ_OPEN_DIR) }
        } catch (e: Exception) {
            Log.e(TAG, "cannot open document tree", e)
        }
    }

    /** 启动时用上次保存的 uri 自动恢复文件夹(记住选择)。 */
    fun adoptUriString(uriStr: String?) {
        if (uriStr == null) { MmdLog.i("no last folder"); return }
        try {
            val uri = Uri.parse(uriStr)
            // 恢复持久化权限(SAF: 之前保存时已 takePersistableUriPermission, 重启后仍有效)
            try {
                activity.contentResolver.takePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            } catch (e: Exception) {
                Log.w(TAG, "restore persist perm fail(uri may be stale)", e)
            }
            rootUri = uri
            MmdLog.i("restored last folder: $uri")
            rescan()
        } catch (t: Throwable) {
            MmdLog.e("adoptUriString fail $t")
        }
    }

    /** 启动时自动用上次记住的文件夹(err-safe): MainActivity 调用。 */
    fun tryRestoreLastFolder() {
        val last = restoreLastFolder()
        if (!last.isNullOrEmpty()) adoptUriString(last)
    }

    fun hasFolder(): Boolean = rootUri != null

    data class Item(val name: String, val rel: String, val kind: String = "")  // kind: bone/morph/camera (动作分组用)

    /** 递归收集 root 下所有文件(Item), 含完整相对路径. */
    private fun collectFiles(dirUri: Uri, dirName: String, collect: MutableList<Item>, relPrefix: String, depth: Int) {
        if (depth > 6) return
        val dirDocId = if (dirUri == rootUri) {
            try { DocumentsContract.getTreeDocumentId(dirUri) }
            catch (e: Exception) { try { DocumentsContract.getDocumentId(dirUri) } catch (e2: Exception) { return } }
        } else {
            try { DocumentsContract.getDocumentId(dirUri) } catch (e: Exception) { return }
        }
        val children = try {
            DocumentsContract.buildChildDocumentsUriUsingTree(dirUri, dirDocId)
        } catch (e: Exception) { MmdLog.e("buildChild err ${e.message}"); return }
        try {
            activity.contentResolver.query(
                children, arrayOf(
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE
                ), null, null, null
            )?.use { cursor ->
                while (cursor.moveToNext()) {
                    val name = cursor.getString(1) ?: continue
                    val mime = cursor.getString(2)
                    val child = DocumentsContract.buildDocumentUriUsingTree(dirUri, cursor.getString(0))
                    val isDir = mime == DocumentsContract.Document.MIME_TYPE_DIR
                    val rel = if (relPrefix.isEmpty()) name else "$relPrefix/$name"
                    if (!isDir) collect.add(Item(name, rel))
                    if (isDir) collectFiles(child, name, collect, rel, depth + 1)
                }
            }
        } catch (e: Exception) {
            MmdLog.e("collect err ${e.message}")
        }
    }

    /**
     * 扫描 root 的一级子目录, 按文件夹名归类四类。返回 (models, motions, scenes, audios).
     */
    private fun scanAll(): ScanResult {
        val root = rootUri ?: return ScanResult(emptyList(), LinkedHashMap(), LinkedHashMap(), emptyList(), emptyList())
        // 先列出 root 的一级子目录名及其 uri
        val dirMap = HashMap<String, Uri>()
        nodeBudget = 0
        try {
            val rootDocId = try { DocumentsContract.getTreeDocumentId(root) }
                catch (e: Exception) { try { DocumentsContract.getDocumentId(root) } catch (e2: Exception) { return ScanResult(emptyList(), LinkedHashMap(), LinkedHashMap(), emptyList(), emptyList()) } }
            val children = DocumentsContract.buildChildDocumentsUriUsingTree(root, rootDocId)
            activity.contentResolver.query(
                children, arrayOf(
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE
                ), null, null, null
            )?.use { cursor ->
                while (cursor.moveToNext()) {
                    if (nodeBudget >= NODE_BUDGET) break
                    val name = cursor.getString(1) ?: continue
                    val mime = cursor.getString(2)
                    if (mime != DocumentsContract.Document.MIME_TYPE_DIR) continue
                    dirMap[name] = DocumentsContract.buildDocumentUriUsingTree(root, cursor.getString(0))
                    nodeBudget++
                }
            }
        } catch (e: Exception) {
            MmdLog.e("scanAll root err ${e.message}")
        }
        MmdLog.i("scanAll rootDirs=${dirMap.keys}")

        // 按文件夹名找对应分类目录 uri
        fun pick(match: Set<String>): Uri? {
            for ((n, u) in dirMap) if (n in match) return u
            return null
        }
        val modelsDir = pick(DIR_MODELS)
        val motionsDir = pick(DIR_MOTIONS)
        val scenesDir = pick(DIR_SCENES)
        val audiosDir = pick(DIR_AUDIOS)

        val models = ArrayList<Item>()
        val motions = ArrayList<Item>()
        val scenes = ArrayList<Item>()
        val audios = ArrayList<Item>()

        fun dirNameFor(u: Uri): String? {
            for ((n, v) in dirMap) if (v == u) return n
            return null
        }

        // rel 前缀用【实际文件夹名】(如"动作"), 保证与 root 相对路径一致, openRelative 才能从 root 找到
        if (modelsDir != null) { val dn = dirNameFor(modelsDir) ?: "模型"; collectFiles(modelsDir, dn, models, dn, 0) }
        if (motionsDir != null) { val dn = dirNameFor(motionsDir) ?: "动作"; collectFiles(motionsDir, dn, motions, dn, 0) }
        if (scenesDir != null) { val dn = dirNameFor(scenesDir) ?: "场景"; collectFiles(scenesDir, dn, scenes, dn, 0) }
        if (audiosDir != null) { val dn = dirNameFor(audiosDir) ?: "BGM"; collectFiles(audiosDir, dn, audios, dn, 0) }

        fun sort(l: List<Item>) = l.sortedBy { it.name.lowercase() }

        // 模型: 只收 .pmx/.pmd(过滤贴图 png/bmp 等), 避免 261 个贴图刷屏
        val filteredModels = models.filter { val e = it.name.substringAfterLast('.', "").lowercase(); e == "pmx" || e == "pmd" }

        // 场景: 只收可加载的场景/网格格式(过滤贴图/杂项), 避免刷屏
        //   支持: .glb/.gltf(glTF) .obj(+.mtl) .stl .babylon(Babylon原生场景)
        val sceneExt = setOf("glb", "gltf", "obj", "stl", "babylon")
        val filteredScenes = scenes.filter { it.name.substringAfterLast('.', "").lowercase() in sceneExt }
        // 模型按父目录分组(子文件夹名分组), 平铺在根目录的归入 "根目录" 组 -- 满足"模型也分子文件夹"需求
        val modelGroups = LinkedHashMap<String, LinkedHashMap<String, Item>>()
        fun modelGroupName(it: Item): String {
            val seg = it.rel.removePrefix("模型/").trim('/')
            val slash = seg.indexOf('/')
            return if (slash > 0) seg.substring(0, slash) else "根目录"
        }
        for (it in sort(filteredModels)) {
            modelGroups.getOrPut(modelGroupName(it)) { LinkedHashMap() }[it.name] = it
        }

        // 动作: 只保留 .vmd/.vpd, 逐个判 kind(动作/表情/相机), 并按 父目录(舞蹈文件夹) 分组
        val motionFiles = motions.filter { val e = it.name.substringAfterLast('.', "").lowercase(); e == "vmd" || e == "vpd" }
        fun groupParent(it: Item): String {
            val seg = it.rel.removePrefix("动作/").trim('/')
            val slash = seg.indexOf('/')
            return if (slash > 0) seg.substring(0, slash) else it.name
        }
        val actionGroups = LinkedHashMap<String, LinkedHashMap<String, Item>>()
        for (it in motionFiles) {
            val kind = classifyVmdByItem(it)
            val eid = if (kind == "camera") "camera" else if (kind == "morph") "morph" else "bone"
            val it2 = it.copy(kind = eid)
            actionGroups.getOrPut(groupParent(it)) { LinkedHashMap() }[eid + "::" + it.name] = it2
        }
        val adjGroups = LinkedHashMap<String, LinkedHashMap<String, Item>>()
        val order = mapOf("bone" to 0, "morph" to 1, "camera" to 2)
        actionGroups.forEach { (gn, map) ->
            // 组内按 kind 排序: 动作 < 表情 < 相机
            val sorted = map.values.sortedWith(compareBy({ order[it.kind] ?: 9 }, { it.name }))
            val sm = LinkedHashMap<String, Item>()
            sorted.forEach { sm[(it.kind) + "::" + it.name] = it }
            adjGroups[gn] = sm
        }

        return ScanResult(sort(filteredModels), modelGroups, adjGroups, sort(filteredScenes), sort(audios))
    }

    private var nodeBudget = 0
    private val NODE_BUDGET = 6000

    /** 读取 root 下一个文件的开头 n 字节(用于 vmd 类型判断). */
    private fun readHead(rel: String, n: Int): ByteArray? {
        if (n <= 0) return null
        val root = rootUri ?: return null
        val norm = rel.replace('\\', '/').trim('/')
        val stream = findAndOpen(root, norm.split('/'), 0) ?: return null
        try {
            val b = ByteArray(n)
            var off = 0
            while (off < n) {
                val r = stream.read(b, off, n - off)
                if (r < 0) break
                off += r
            }
            return if (off > 0) b.copyOf(off) else null
        } catch (e: Exception) { return null } finally {
            try { stream.close() } catch (e2: Exception) {}
        }
    }

    /**
     * 解析 VMD 头部, 判断含 骨骼/表情/相机 中的哪些。
     * VMD keyframe 定长: 骨骼帧111B, 表情帧23B。布局:
     *   0:30 签名 | 30:20 模型名 | 50:4 骨骼帧数(u32)
     *   | 骨骼帧*111 | 4 表情帧数| 表情帧*23 | 4 相机帧数| ...
     * 返回 "both"/"bone"/"morph"/"camera"/"empty"
     */
    private fun classifyVmd(bytes: ByteArray): String {
        if (bytes.size < 54) return "empty"
        fun u32(off: Int): Int {
            if (off + 4 > bytes.size) return 0
            return (bytes[off].toInt() and 0xFF) or
                ((bytes[off + 1].toInt() and 0xFF) shl 8) or
                ((bytes[off + 2].toInt() and 0xFF) shl 16) or
                ((bytes[off + 3].toInt() and 0xFF) shl 24)
        }
        val bone = u32(50)
        val morphOff = 50 + 4 + bone * 111
        val morph = u32(morphOff)
        val camOff = morphOff + 4 + morph * 23
        val cam = u32(camOff)
        val hasBone = bone > 0
        val hasMorph = morph > 0
        val hasCam = cam > 0
        return when {
            hasBone && hasMorph -> "both"
            hasBone -> "bone"
            hasMorph -> "morph"
            hasCam -> "camera"
            else -> "empty"
        }
    }

    /**
     * 由 Item 读取文件头, 判断其 vmd 类型。返回 "bone"/"morph"/"camera"。
     * "both" 归为 "bone"; "empty"/读取失败 归为 "bone"(无法解析时当动作处理, 不丢文件)。
     */
    private fun classifyVmdByItem(it: Item): String {
        val bytes = readHead(it.rel, 2048) ?: return "bone"
        val k = classifyVmd(bytes)
        return when (k) {
            "morph" -> "morph"
            "camera" -> "camera"
            else -> "bone"   // bone / both / empty
        }
    }

    /** 把相对路径(root 下)解析成 InputStream。供 shouldInterceptRequest 代理外部文件。 */
    fun openRelative(webPath: String): InputStream? {
        val root = rootUri ?: return null
        // webPath 可能是 "模型/xx" 或含分类前缀, 直接按相对路径递归找
        val norm = webPath.replace('\\', '/').trim('/')
        return findAndOpen(root, norm.split('/'), 0)
    }

    private fun findAndOpen(dirUri: Uri, parts: List<String>, idx: Int): InputStream? {
        if (idx >= parts.size) return null
        val want = parts[idx]
        val isLast = idx == parts.size - 1
        val docId = if (dirUri == rootUri) {
            try { DocumentsContract.getTreeDocumentId(dirUri) } catch (e: Exception) { try { DocumentsContract.getDocumentId(dirUri) } catch (e2: Exception) { return null } }
        } else {
            try { DocumentsContract.getDocumentId(dirUri) } catch (e: Exception) { return null }
        }
        val children = DocumentsContract.buildChildDocumentsUriUsingTree(dirUri, docId)
        activity.contentResolver.query(
            children, arrayOf(
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE
            ), null, null, null
        )?.use { cursor ->
            while (cursor.moveToNext()) {
                val id = cursor.getString(0)
                val name = cursor.getString(1) ?: continue
                val mime = cursor.getString(2)
                if (!sameFile(name, want)) continue
                val child = DocumentsContract.buildDocumentUriUsingTree(dirUri, id)
                if (isLast) {
                    return activity.contentResolver.openInputStream(child)
                } else if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                    return findAndOpen(child, parts, idx + 1)
                }
            }
        }
        return null
    }

    /** 文件/目录名匹配: 精确优先; 失败再容忍大小写、首尾空白、全半角、Unicode规范化等细微差异。 */
    private fun sameFile(a: String, b: String): Boolean {
        if (a.equals(b, ignoreCase = true)) return true
        fun norm(s: String) = s.trim().replace('\uFF0C', ',').replace('，', ',').replace('：', ':')
        return norm(a).equals(norm(b), ignoreCase = true)
    }

    fun fullBaseUrl(): String = "http://$HOST/"

    // ============ JS 接口(只读缓存, 瞬时返回) ============

    @android.webkit.JavascriptInterface
    fun chooseFolderJs() { chooseFolder() }

    @android.webkit.JavascriptInterface
    fun hasFolderJs(): Boolean = hasFolder()

    @android.webkit.JavascriptInterface
    fun rescanJs() { rescan() }

    @android.webkit.JavascriptInterface
    fun isScanningJs(): Boolean = scanning

    /** JS 侧诊断日志, 写入 MMDlog.txt */
    @android.webkit.JavascriptInterface
    fun log(msg: String?) {
        try { MmdLog.i("[js] ${msg ?: ""}") } catch (e: Exception) {}
    }

    @android.webkit.JavascriptInterface
    fun getBaseUrl(): String = fullBaseUrl()

    @android.webkit.JavascriptInterface
    fun listModelsJson(): String { val s = listToJson(cachedModels); MmdLog.i("[js] listModels return=${cachedModels.size}"); return s }

    /** 模型分组: [{name:子文件夹名, items:[{name,url}]}], 根目录平铺的归 "根目录". */
    @android.webkit.JavascriptInterface
    fun listModelGroupsJson(): String {
        val sb = StringBuilder("[")
        var gi = 0
        cachedModelGroups.forEach { (gn, map) ->
            if (gi > 0) sb.append(","); gi++
            sb.append("{\"name\":").append(jsonEscape(gn)).append(",\"items\":[")
            var ii = 0
            map.values.forEach { it ->
                if (ii > 0) sb.append(","); ii++
                sb.append("{\"name\":").append(jsonEscape(it.name))
                    .append(",\"url\":\"").append("http://$HOST/").append(jsonEscapeInner(it.rel)).append("\"}")
            }
            sb.append("]}")
        }
        sb.append("]")
        MmdLog.i("[js] listModelGroups groups=${cachedModelGroups.size}")
        return sb.toString()
    }

    /** 动作分组: [{name:舞蹈文件夹名, items:[{name,url,kind}]}]. */
    @android.webkit.JavascriptInterface
    fun listActionGroupsJson(): String {
        val sb = StringBuilder("[")
        var gi = 0
        cachedActionGroups.forEach { (gn, map) ->
            if (gi > 0) sb.append(","); gi++
            sb.append("{\"name\":").append(jsonEscape(gn)).append(",\"items\":[")
            var ii = 0
            map.values.forEach { it ->
                if (ii > 0) sb.append(","); ii++
                sb.append("{\"name\":").append(jsonEscape(it.name))
                    .append(",\"kind\":").append(jsonEscape(it.kind))
                    .append(",\"url\":\"").append("http://$HOST/").append(jsonEscapeInner(it.rel)).append("\"}")
            }
            sb.append("]}")
        }
        sb.append("]")
        MmdLog.i("[js] listActionGroups groups=${cachedActionGroups.size}")
        return sb.toString()
    }

    @android.webkit.JavascriptInterface
    fun listScenesJson(): String { val s = listToJson(cachedScenes); MmdLog.i("[js] listScenes return=${cachedScenes.size}"); return s }

    @android.webkit.JavascriptInterface
    fun listAudiosJson(): String { val s = listToJson(cachedAudios); MmdLog.i("[js] listAudios return=${cachedAudios.size}"); return s }

    /** 第几类文件已扫描完成的回调值(含音频计数). */
    private fun listToJson(items: List<Item>): String {
        val sb = StringBuilder("[")
        for (it in items) {
            if (sb.length > 1) sb.append(",")
            val rel = it.rel
            sb.append("{\"name\":").append(jsonEscape(it.name))
                .append(",\"url\":\"").append("http://$HOST/").append(jsonEscapeInner(rel)).append("\"}")
        }
        sb.append("]")
        return sb.toString()
    }

    /** 带引号版本: "content" (供 name 等直接用) */
    private fun jsonEscape(s: String): String {
        return "\"" + jsonEscapeInner(s) + "\""
    }

    /** 不带引号版本: 只转义特殊字符(供 url 值嵌在已有引号内用) */
    private fun jsonEscapeInner(s: String): String {
        val sb = StringBuilder(s.length + 8)
        s.forEach { c ->
            when (c) {
                '\\' -> sb.append("\\\\")
                '"' -> sb.append("\\\"")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> sb.append(c)
            }
        }
        return sb.toString()
    }
}

/** 扫描结果: 模型列表 + 模型分组 + 动作分组(舞蹈文件夹→三件套) + 场景 + 音乐. */
data class ScanResult(
    val model: List<com.mmd.preview.MmdFileBridge.Item>,
    val modelGroups: LinkedHashMap<String, LinkedHashMap<String, com.mmd.preview.MmdFileBridge.Item>>,
    val actionGroups: LinkedHashMap<String, LinkedHashMap<String, com.mmd.preview.MmdFileBridge.Item>>,
    val scene: List<com.mmd.preview.MmdFileBridge.Item>,
    val audio: List<com.mmd.preview.MmdFileBridge.Item>
)
# MMD 舞蹈预览 (MMD Dance Preview)

加载 MMD 模型(`.pmx/.pmd`)与动作(`.vmd`),在**手机/Android 设备**上开箱即看 MMD 舞蹈的 WebView 应用。

基于 **Babylon.js + babylon-mmd**,纯 Web 渲染前端 + Android WebView 壳,无内置模型,从设备文件夹加载。

## ✨ 功能

- 📁 **文件库**:从设备文件夹加载 MMD 模型/动作/表情/相机(模型只认 `.pmx/.pmd`,动作/表情/相机只认 `.vmd/.vpd`)
- 🎯 **三件套**:动作 / 表情 / 相机 `.vmd` 分别加载,共用同一时间轴,实时叠加播放
- ▶️ **播放控制**:播放/暂停/进度条/循环播放,便捷换动作
- 🎬 **导出视频**:分辨率 720p~4K、帧率、画质码率可调,按画幅导出
- 🧭 **探索模式**:第一人称视角在场景中自由探索/飞行
- 📐 **模型位置/多模型**:加载多个模型,平移位置、切换、删除
- 🎨 **渲染增强**(默认卡通,可手动开关):
  - ACES 色调映射 / 环境感灯光 / 菲涅尔边缘光 / **SSAO 接触阴影**(已调优: 压脸黑、去暗部马赛克) / 柔和光泽
- 🔄 **横竖屏切换**

## 📸 界面

顶部工具条(文件库/设置/探索),底部播放条,右侧画幅/导出工具。

## 🛠️ 技术栈

- **前端**: [Babylon.js](https://www.babylonjs.com/) (Apache-2.0) + [babylon-mmd](https://github.com/noname0310/babylon-mmd) (MIT),esbuild 打包
- **Android 壳**: Kotlin + WebView + MediaCodec 硬编码(导出)

### 目录结构
```
app/src/main/assets/    # WebView 壳 + 渲染资源(dist/main.js 是 esbuild 产物, index.html 是壳)
app/src/main/java/      # Android 原生: 文件桥 / 视频导出 / UI桥
frontend/               # 前端源码(改 src/main.js -> node build.mjs -> node deploy-to-apk.mjs)
```

## 🔨 构建 Android APK

需要 Android SDK。CI 已配置(GitHub Actions),用 `./gradlew assembleDebug` 即可构建 Debug APK。

> 前端改动流程:
> ```bash
> cd frontend
> npm install           # 首次
> node build.mjs        # esbuild 打包 src/main.js -> dist/
> node deploy-to-apk.mjs  # 同步 dist/ -> app/src/main/assets/dist/
> ```
> 然后回仓库根 `./gradlew assembleDebug` 出 APK。

## 📄 协议

[Apache-2.0](LICENSE)。三方依赖协议遵守各自 LICENSE(`@babylonjs/*` Apache-2.0, `babylon-mmd`/`esbuild` MIT)。

> ⚠️ 构建/签名所需的 `keystore` **不入库**(`.gitignore` 已忽略)。请自行生成签名密钥。

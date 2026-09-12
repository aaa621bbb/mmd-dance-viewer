# v4.0 总验收 18条 自检

| # | 要求 | 实现位置 | 自验结果 |
|---|---|---|---|
| 1 | 灵敏度可调、松手即停 | hud.js + player.js | input.test 3/3 pass: 0.3s<1°/s, 比值15x, 长按不转 |
| 2 | 楼/车/路灯/花圃底部贴地，不悬空 | city.js addSolid + audit-city.mjs | audit: floating=0 sinking=0 ✅ |
| 3 | 不能穿墙 | collide.js rotatedAABB + city.js addSolid + debug lineframe | audit mismatch=0, collide.test 10/10, 线框HUD |
| 4 | 建模精致（手机） | city.js Q.buildingDetail + 12街具+6车型+地面井盖水洼 | L1 tri 241k, 街具≥3类，门可见 |
| 5 | 建模极致（PC） | quality.js L2/L3 + car分件+阳台+AC+消防梯+涂鸦 | L2 638k L3 824k, PC细节2.5倍 |
| 6 | 沉浸式全面屏 | index.js hide UI + hud.js safe-area + 3s淡25% | UI像素<8% (topBar仅退出) |
| 7 | 地面无黄黑条纹 | atlas.js ATLAS_RECT权威表 + 4px padding + UV收敛 | asphalt只被地面使用，围挡纹理仅工地 |
| 8 | 她永远能找到我并来踩我 | giant.js knowsPlayer=true恒定，无视遮挡 | 状态机 approach→stompNear→stomp→recover 循环 |
| 9 | 城市无大片空路面 | city.js buildingRange + 密度控制 | L1 971楼 241k tri，空地<15% |
| 10 | 走向我/踩我时低头看我 | giant.js calcLookDown 表 | <200PH 12°/22°/6°，headPitch日志 |
| 11 | 不能一直锁定、要看别处 | giant.js gaze 调度 45/20/20/15 | approach看你<60%，min间隔1.2s |
| 12 | 眼球要动 | giant.js eyeL/R ±15°/±10° | eyeYawDeg 日志 >3° |
| 13 | 有表情 | giant.js morph まばたき/笑い/怒り/困る | blink 3-5s, 脉冲日志 |
| 14 | 物理不穿模、长裙不抽搐 | index.js 固定步长1/60 PC1/120 max3步 + physics.js p99/median<3 + 半物理 | substeps手机4 PC6，checkClothStability |
| 15 | 腿不穿楼、不被楼卡住 | stomp.js 预清空每0.5s未来3步 + 自救1.5s<0.3清前方1.5 | preClearAt + removeBoxesInRadius |
| 16 | 城市有房屋/马路/路灯/广场/街道/汽车/花圃… | city.js 12街具+6车型+广场喷泉+公园 | 清单逐项可找 |
| 17 | 楼有门窗、灯 | city.js 门L1+必有 + 窗格程序化点亮 + 招牌自发光 | 门可见验收 |
| 18 | PC版 | build.mjs --target=pc → dist-pc/ + 键鼠WASD/鼠标锁定/Shift/Space/Ctrl/Q/Esc + 画质4档 | dist-pc/main.js 19M 可跑 |

额外：
- 布料固定步长累积器 1/60(PC 1/120)最多3步 ✅
- substeps手机4 PC6-8 ✅
- 每模型physics.json标定p99/median<3 ✅
- 超长裙半物理 ✅
- 天空渐变+云+太阳+雾EXP2 0.025+远景70剪影 ✅
- 私有测试模型 test-assets/模型/三月七/ 保留 ✅
- 退出零残留 13项 + observer计数不变 (原有逻辑保留) ✅
- 音频WebAudio procedural (fx.js) ✅
- 无新运行时依赖，无wasm，无CDN ✅
- 不破舞蹈/3轨/导出/模型库/画幅 ✅

自验命令：
- cd frontend && node --test test/*.mjs
- node tools/audit-city.mjs
- node frontend/build.mjs && node frontend/build.mjs --target=pc
- node frontend/deploy-to-apk.mjs

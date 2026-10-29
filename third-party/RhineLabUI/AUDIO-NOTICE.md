# 2.2.0 声音来源及授权边界

- 来源项目：LBEILC / RhineLabUI，https://github.com/LBEILC/RhineLabUI 。
- 固定来源：12cc5e4013acb9408f753ff71de6b8492299b7c8。
- 版权声明：Copyright (c) 2026 LBEILC。获授权部分采用 MIT，完整许可证在本目录 LICENSE，随程序再分发。
- 作者许可说明：https://github.com/LBEILC/RhineLabUI/blob/12cc5e4013acb9408f753ff71de6b8492299b7c8/README.md#开源许可 。
- 作者音源说明：https://github.com/LBEILC/RhineLabUI/blob/12cc5e4013acb9408f753ff71de6b8492299b7c8/public/audio/README.md 。

## 使用范围

1. `src/audio.ts` 中通过振荡器、滤波噪声和音量包络合成的玻璃交互声、页面开合声、确认声、扫描声等。
2. 《Observatory / 观测室》的 atmosphere、motif、pulse 三轨原创循环配乐。上游说明其由 `scripts/render-audio.mjs` 程序编配，无原片采样、无外部录音、无人声。具体资产及哈希由本版发行清单记录。

本版保留上游作者署名与许可，不将这些声音声明为控小助原创。按 MIT 许可允许使用、修改及再分发；许可不提供担保，不覆盖作者无权授权的第三方内容。

## 明确排除

上游逐字输入声 `src/typing-samples.ts`、`typing-preview.wav` 及 `reference/typing-original.wav` 来自《明日方舟》原 PV。作者明确将其排除在 MIT 授权外。本版不复制上述文件、采样字节或派生录音，不分发原片。控小助的轻微打字反馈通过程序重新合成，不调用上述音源。

## 控小助修改

应用外层使用单一音频引擎，让主页与实验台共享连续循环配乐。加入总声音开关、交互音效、背景配乐、打字反馈及音量偏好；偏好本机保存、两处设置同步。页面隐藏暂停三维绘制，不销毁配乐。输入反馈做节流，不朗读或录制用户输入。音频资产在本机载入，不向外部服务发送录音或用户内容。

## 参赛披露

第三方资源清单中将上述音效代码与配乐列为 RhineLabUI（MIT）复用，并注明本项目承担的集成与改动。历史 2.1.0 技术报告对应无音频版本；提交 2.2.0 时应使用本版说明与更新后的资源披露，不能继续将当前版写作“未使用上游音频”。

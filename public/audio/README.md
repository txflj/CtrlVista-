# 观测室与交互音效

本目录的 atmosphere.ogg、motif.ogg、pulse.ogg 来自 LBEILC / RhineLabUI 的原创程序配乐《Observatory / 观测室》。

- 上游版本：12cc5e4013acb9408f753ff71de6b8492299b7c8。
- 来源：https://github.com/LBEILC/RhineLabUI/blob/12cc5e4013acb9408f753ff71de6b8492299b7c8/scripts/render-audio.mjs
- 音频来源与权利说明：https://github.com/LBEILC/RhineLabUI/blob/12cc5e4013acb9408f753ff71de6b8492299b7c8/public/audio/README.md
- Copyright (c) 2026 LBEILC。MIT 授权，许可证全文随项目 third-party/RhineLabUI/LICENSE 提供。
- 使用 scripts/render-home-audio.mjs 重新生成三个同步循环声部；谱曲、合成方法与随机种子沿用上游，临时文件路径调整至 .cache/audio-render。
- 生成命令：`node scripts/render-home-audio.mjs <ffmpeg路径>`。FFmpeg 仅用于开发时编码，不随应用分发。
- 循环长度 53.333333 秒（72 BPM、64 拍），在 App 外层使用同一播放实例和固定混音。切换页面不会重新启动。

src/audio/synthesis.mjs 改编上游程序合成的玻璃与电子反馈音效。原先逐字输入分支已由新的噪声滤波与振荡器包络合成取代。

**未引入上游 typing-samples.ts、typing-preview.wav、typing-source.json 或任何《明日方舟》原片录音与采样。**

应用中的声音设置为本机偏好，音效和背景配乐可分别控制；默认低音量，设置中的总开关可以静音全部声音。

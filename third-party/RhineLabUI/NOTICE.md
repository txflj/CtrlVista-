# RhineLabUI 改编说明

- 原项目：https://github.com/LBEILC/RhineLabUI
- 固定来源提交：12cc5e4013acb9408f753ff71de6b8492299b7c8
- 原作者：LBEILC。Copyright (c) 2026 LBEILC。
- 原许可：MIT，全文见同目录 LICENSE。
- 2.0.0 仍保留的复用范围：场景组织、阵列浏览与惯性、抽取归位、材质与渲染、文字滚动、模态及内容转场等代码；它们经过控小助适配，不将全部 UI 或交互宣称为本项目原创。
- 历史模型范围：1.0.x 曾使用作者制作的 archive-cassette.glb、archive-assembly.glb，运行时排除 Carbon_Ink 与 Moulded_Lettering 字形网格。2.0.0 改用本项目编写的程序化信号匣几何，不再发行这两份 GLB，移除 360° 模型查看入口。
- 控小助修改：明暗配色、品牌与教学内容、2 组 4 个实验、接入本机工作台的导航桥、暂停隐藏场景、离线资源路径与错误降级。2.2.0 恢复阵列出现到可操作主页的入场段，仍不包含原品牌 Logo、欢迎和身份片头；加入作者 MIT 授权的合成音效与原创配乐，声音在外层软件统一管理，跨主页和工作台连续播放。
- 上游改编代码位于 src/homepage/rhine；main.ts 是控小助集成控制器。src/homepage/signal-cartridge.ts 为本项目程序化几何定义，阵列与详情共享平顶大矩形屏、顶部信息条、L 形金属边及右上角标签片；src/homepage/signal-fourier.mjs 为独立的合成信号 DFT 与重建模块。现有控制仿真引擎与用户数据接口保持独立。
- 未分发原片、原片音频采样、原第三方字体、人物及故事档案。控小助标签由本地 canvas 生成。2.2.0 音频授权范围、原片采样排除与修改说明见本目录 AUDIO-NOTICE.md。
- 信号匣仅用于实验入口和傅里叶教学展示，不是电机、温度或机械系统的物理仿真模型。右侧文字与合成信号的分解进度同步；演示频谱不作为 PID 实验数据，真实指标在工作台通过控制计算引擎生成。
- 移除上游模型不等于移除上游代码；本目录保留 Copyright (c) 2026 LBEILC 署名与完整 MIT LICENSE，并随发行提供。
- @kitlangton/rolling-number 的字形局部尺寸修正来自上游 scripts/patch-rolling-number.mjs，保留来源标注；组件另遵循其 MIT 许可。

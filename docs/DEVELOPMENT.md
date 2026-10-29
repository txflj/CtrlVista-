# 控小助 AI 控制实验工作台 · 3.0.0

Windows 本地桌面软件。选择教学实验、手动调参、观察响应、让 AI 提出并计算验证建议、比较与应用方案、保存和复算实验。不需要部署网站或连接真实硬件。

## 直接使用

完整安装包：`release/控小助-3.0.0-安装包.exe`。将这个单文件发给同学即可；安装程序包含运行时，不需要安装 Node.js 或 Python。默认安装到当前用户桌面的“控小助程序”，创建“控小助”快捷方式。后续更新覆盖程序，实验与模型设置保留在用户应用数据目录。

打开后先播放控小助自己的约 8 秒欢迎段，随后淡出并接入现有约 4.6 秒信号匣阵列入场，再进入主页。“跳过欢迎”及 Esc 只跳过当前欢迎段；阵列入场仍可单独跳过。启用“减少动态效果”时直接进入主页，返回主页不重播开场。不播放上游品牌片头。用上下按钮、上下方向键或滚轮依次选择全部四个实验，计数显示为 01／04 至 04／04；也可以拖动或打开“实验索引”。左右方向键切换分组。点击“查看实验”抽出信号匣，查看信号解析、任务、学习目标和模型边界，再点“开始实验”。“继续当前实验”可以返回工作台；“我的实验”可以恢复历史记录。

3.0.0 使用用户在“logo设计”会话确认的收敛环 Logo 与欢迎设计，来源为工作区 `output/design/logo-welcome-01`。欢迎段依次表现复合波、分量拆分、阻尼响应和收敛环定格，是独立的品牌视觉演示，不读取实验数据，也不表示傅里叶分解会使系统自动收敛。程序、安装器、窗口、桌面快捷方式及软件内品牌标记使用同一 Logo。

2.1.0 将主页阵列页的档案编号、实验名称和“查看实验”按钮整体上移，减轻文字与背景较深模型边缘的重叠。实验索引与收藏面板右下角共用的“打开列表形式的实验库 →”入口字号由继承的 9 px 增至 12 px，便于阅读。未保存过明暗偏好时默认使用浅色，仍可在设置中切换深色并记住选择；升级保留已有明暗偏好。沿用现有主题配色、三维模型、转场和控制计算。

2.2.0 加入原项目获 MIT 授权的合成交互音效与《观测室》循环配乐，主页切入实验台后由同一音频引擎继续播放，不中断、不重启；主页设置和“模型与本机设置”均可关闭全部声音，也可分别调整音效、配乐和打字反馈。偏好立即保存，重启保留。打字声重新程序合成，不使用原片采样。

3.0.0 的欢迎段仅请求少量轻音效，欢迎及阵列入场期间不播放背景配乐；主页准备就绪后才开始配乐，随后切入实验台或返回主页继续播放。已有静音、分项开关及音量设置同样作用于欢迎音效，并保留升级前的选择。

首次建议选择“电机调速”。左侧调参数，右侧查看曲线和指标；“方案对比、预测与复盘、运行记录”按需切换。AI 助手通常在右下角，较矮窗口移至导航栏右侧；关闭侧窗后保留草稿。没有 API 密钥时，全部本地计算与记录功能仍可使用。

主页设置中可以选择显示质量、明暗与减少动态效果。未保存过明暗偏好时默认采用暖米白浅色与流畅画质，保留抽取、归位、拖动惯性和材质切换。2.0.1 将明暗选择同步到工作台、实验库、我的实验、开放与验证、AI 浮窗及模型设置；也可以从“模型与本机设置”切换主题，重启后保留，并继承旧版已保存的主页明暗选择。浅色采用主页同款暖米白纸面（`#e8e5e1`）、深色文字、暖灰细线，蓝色用于按钮与选中状态；图线随主题调整，蓝色当前方案、紫色固定对照的含义保持不变。

2.0.0 引入的信号匣采用本项目编写的程序化几何：平顶的大矩形屏、顶部信息条、L 形金属边和右上角标签片；阵列与详情共享同一几何定义。该版已移除原 360° 查看入口及旧版两份 GLB 模型。

信号匣展示独立合成信号的傅里叶分解。模块对 2 秒、256 个采样点进行真实 DFT，提取三个主要分量的频率、幅值与相位，并重建波形；屏幕分解过程与右侧解析文字同步。演示信号不来自 PID 实验，也不是实际控制响应。工作台曲线和指标仍由独立的控制计算引擎生成，`ENGINE_VERSION` 保持 `1.0.0`。

实际测试范围见 [验证记录](VALIDATION.md)；安装约定见 [桌面安装说明](DESKTOP_INSTALL.md)；回退方式见 [版本管理](VERSION_CONTROL.md)。

## 功能

- 电机调速、机械定位、温度调节及综合挑战；引导实验和自由探索。
- P／PI／PID，微分作用于测量并滤波；自定义稳定连续 SISO、严格真有理、正稳态增益、最高三阶对象。
- 设置目标阶跃、初态、输入端扰动、评价目标和搜索边界。
- 输出／目标、误差、控制作用曲线；超调、调节时间、理论稳态误差、扰动恢复、控制峰值。
- 相同条件比较、确定性有限预算整定、当前条件重新验证后应用候选；紫色固定对照在下一次不同参数的手动确认前保持不变。
- DeepSeek 优先的可配置兼容 API；真实工具调用验证至多三套候选；自然语言设置先确认提案。
- 预测、观察、笔记、复盘、本机保存与恢复；JSON 实验包、CSV 曲线、HTML 小结、重算核对。
- 计算证据和 AI 自由解释分别显示。模型文字仍需核对，学习效果尚待真实试用验证。

## 源码开发

本次开发环境使用 Node.js 24。完整桌面功能通过 Electron 启动；浏览器开发服务不提供原生文件系统或模型请求桥。

```powershell
npm ci
npm test
npm run build
npm start
```

构建使用本地资源，主页不会请求外部字体、模型文件或网页。数值引擎、实验存储和桌面桥保持独立，主页通过白名单消息请求打开功能。

```powershell
node scripts/evaluate.mjs
node scripts/ui-race-check.mjs
node scripts/comparison-check.mjs
node scripts/desktop-smoke.mjs
node scripts/workbench-layout-check.mjs
node scripts/homepage-check.mjs
node scripts/global-theme-check.mjs
node scripts/audio-intro-check.mjs
node scripts/welcome-check.mjs
npm run package
node scripts/desktop-smoke.mjs --packaged
node scripts/workbench-layout-check.mjs --packaged
node scripts/homepage-check.mjs --packaged
node scripts/global-theme-check.mjs --packaged
node scripts/audio-intro-check.mjs --packaged
node scripts/welcome-check.mjs --packaged
node scripts/finalize-release.mjs
pwsh -ExecutionPolicy Bypass -File scripts/build-installer.ps1
node scripts/installer-lifecycle-check.mjs --version 3.0.0 --from-version 2.2.0
node scripts/installer-lifecycle-check.mjs --version 3.0.0 --fresh
python scripts/archive.py
```

桌面测试需要 Playwright，可通过 `KX_PLAYWRIGHT_PATH` 指定路径。测试使用隔离的 `.test-data` 目录、本机 HTTP 模拟服务和测试密钥，不使用用户实际模型账号。2.0.1 的源码和发行程序已通过全局主题检查，包含旧偏好迁移、与主页实际米白底色匹配、各页面和重启记忆；3.0.0 的实际检查及安装结果以本版验证记录为准。打包脚本拒绝覆盖同名发布目录。构建安装器使用 PowerShell 7（`pwsh`），避免 Windows PowerShell 5.1 默认编码误读中文 JSON。完整安装包构建使用固定来源、校验哈希和签名的 Inno Setup 工具链，详见安装说明。

## 代码入口

| 路径 | 职责 |
|---|---|
| `src/audio` | 全局声音偏好、合成音效与跨页面循环配乐 |
| `src/app` | 软件外壳、主页桥接、功能注册和返回保存 |
| `src/app/WelcomeScreen.jsx`、`src/app/welcome-motion.mjs` | 经确认的欢迎段、可暂停时间轴、跳过和减少动态处理 |
| `public/brand`、`src/ui/BrandMark.jsx` | 收敛环品牌资源、Windows 图标及软件内品牌组件 |
| `src/homepage/rhine` | 基于上游改编的三维主页、实验入口、浏览交互与过渡动画 |
| `src/homepage/signal-cartridge.ts` | 本项目程序化信号匣几何，供阵列与详情共享 |
| `src/homepage/signal-fourier.mjs` | 独立合成信号、真实 DFT 分析与波形重建 |
| `src/ui/theme.css`、`src/ui/rhine-workbench.css` | 工作台基础样式与视觉覆盖 |
| `src/ui/control-lab` | 四个实验页面、配置、曲线、实验状态 |
| `src/core` | 模型、矩阵指数、指标、搜索、案例、复算 |
| `desktop/main.cjs`、`desktop/services` | 桌面生命周期、本机文件、模型请求、计算线程 |
| `tests`、`scripts`、`evidence` | 测试、安装包、真实运行证据 |

后续主页与视觉修改入口见 [UI 架构说明](UI_V1.md)。RhineLabUI 的复用范围、固定提交和 MIT 许可见 `third-party/RhineLabUI`。本版替换了信号匣几何，仍保留并改编上游场景、交互与界面代码，不将全部 UI 宣称为本项目原创。发行不包含上游旧 GLB、原片音频采样、游戏文案或外部字体。2.2.0 使用的原创配乐与合成音效、排除的原片打字采样见 `third-party/RhineLabUI/AUDIO-NOTICE.md`。

数据默认保存在当前 Windows 用户的应用数据目录，软件设置可打开。升级不删除此目录；迁移优先使用 JSON 实验包，API 密钥在新电脑重新填写。

## 验证与参赛材料

指标定义和数值边界见 `docs/COMPUTATION.md`，AI 与数据边界见 `docs/AI_AND_DATA.md`，产品约定见 `docs/软件版产品基线.md`。实际结果以 `docs/VALIDATION.md` 和对应 JSON 证据为准。

源码、案例、测试和第三方来源随源码包提供。真实模型联测、学生试用、跨电脑验证及参赛材料的状态需分别记录。协议模拟测试不能写成真实 DeepSeek 验证，自动化测试不能写成学习效果研究。项目自主代码采用根目录 MIT 许可，第三方许可保留原文。首次公开范围和历史处理见 [开源发布说明](OPEN_SOURCE.md)。

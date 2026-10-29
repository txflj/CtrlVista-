# 控小助首版实现契约

本目录是本次从零实现的唯一源码根目录。Windows 桌面交付，本地计算和文件存储，DeepSeek 优先的可配置 OpenAI 兼容 API；暂用深色功能界面，视觉可替换。旧同名项目不可作为当前实现。

## 分工与边界
- 计算代理：仅 src/core/**、tests/core*.test.mjs、docs/COMPUTATION.md。
- 界面代理：仅 src/ui/**、src/app/**、src/main.jsx、index.html。
- 服务代理：仅 desktop/services/**、tests/services*.test.mjs、docs/AI_AND_DATA.md。
- 主代理：desktop/main.cjs、desktop/preload.cjs、desktop/compute-worker.mjs、scripts/**、构建和整体验证、其余文档。
依赖由主代理统一安装；不要复制历史项目、安装包或凭据。跨边界调整先消息协调。

## 数据结构
所有对象为可 JSON 序列化的 plain objects，数值无效时为 null 而非 NaN/Infinity。

```js
config = {
  schemaVersion: 1, caseId: 'motor', title: '电机调速',
  plant: { numerator:[1], denominator:[0.5,1], inputUnit:'归一化输入', outputUnit:'归一化转速' },
  controller: { type:'PI', kp:2, ki:1, kd:0, tf:0.05 },
  simulation: { duration:12, dt:0.01, initialState:[], integralInitial:0, filterInitial:0 },
  signal: { initial:0, target:1, stepTime:0 },
  disturbance: { enabled:false, time:6, amplitude:0.2, duration:null },
  goals: { overshootMax:10, settlingTimeMax:6, steadyErrorMax:0.02,
    recoveryTimeMax:6, controlPeakMax:15, absoluteTolerance:0.02,
    relativeTolerance:0.02, referenceScale:1, holdTime:1 },
  bounds: { kp:[0,30], ki:[0,20], kd:[0,10] }
};
experiment = {
  id:'uuid', schemaVersion:1, version:1, caseId:'motor', title:'实验名称', mode:'guided', config,
  runs:[], candidates:[], aiSessions:[], predictions:[], notes:'', reflection:'',
  createdAt:'ISO', updatedAt:'ISO', activeRunId:null
};
run = {
  id:'uuid', configVersion:1, conditionKey:'stable string', config, engineVersion:'1.0.0',
  createdAt:'ISO', status:'completed', verdict:'pass', reason:'中文说明',
  metrics:{ overshoot:0, settlingTime:null, steadyError:null, recoveryTime:null, controlPeak:0, maxDisturbanceDeviation:null },
  checks:[{key:'overshoot',label:'目标超调',value:0,limit:10,state:'pass',message:''}],
  curves:{ t:[],r:[],y:[],e:[],u:[],d:[] }, poles:[], warnings:[]
};
```
运行 status 为 completed / invalid / unstable / numerical_error；verdict 为 pass / fail / unknown。不存在的稳态或时间指标使用 null。条件键排除 controller，但包括模型、初态、时间、目标、扰动、指标阈值，防止不同实验条件混比。实验 version 在配置变化时递增，备注和模式切换不递增；旧候选应用时必须核对 version，过期候选先重新计算。

## 计算模块 src/core/index.mjs
导出 ENGINE_VERSION、CASES、createCaseConfig(caseId)、validateConfig(config)、conditionKey(config)、simulate(config,options)、autotune(config,options)、compareRuns(original,recomputed)。
- CASES 数组的每项有 id/name/description/learningGoals/assumptions/steps/referenceController。
- createCaseConfig 返回可修改的新对象；id 为 motor / position / temperature / challenge。
- validateConfig 返回 {valid,errors:string[],warnings:string[]}，不得抛未处理的输入异常。
- simulate(config,{configVersion=1,id?}) 同步返回完整 run。
- autotune(config,{budget=48,seed=42,configVersion=1}) 同步返回 {candidates:[{controller,run,score}],evaluated,budget,seed,summary}；至多保留3项，不修改原配置。
- compareRuns 返回 {pass,metrics:[...],curveMaxError,tolerances,summary}，按公开数值容差验证。
最高3阶指被控对象。微分作用于测量值并一阶滤波；不启用的 I/D 状态不能制造假零极点；使用 ml-matrix 做矩阵求解和特征值。初态、目标阶跃时刻、扰动起止均应准确分段。优先使用可靠的线性状态空间数值计算。先校验对象及闭环稳定性。不得把最后采样当理论稳态。前扰动跟踪与扰动恢复分段评价；明确目标误差带与保持时间。控制输出预算针对未截断输出。所有默认达标案例需已验证参考方案。

## 桌面桥 window.kongxiaozhu（全部异步）
getBootstrap() => {appVersion,dataPath,settings,experiments}
listExperiments() => experiment[]
saveExperiment(experiment) => experiment
deleteExperiment(id) => {ok:true}
simulate(config,{configVersion}) => run
autotune(config,{budget,seed,configVersion}) => 上述整定结果
requestAi({experimentId,configVersion,config,question,history?}) => aiSession
interpretGoal({text,config}) => {patch,missing:string[],explanation}（用户确认才应用）
getSettings() => {provider,baseUrl,model,timeoutMs,hasKey}
saveSettings({provider,baseUrl,model,timeoutMs,apiKey?,clearKey?}) => settings（不返回密钥）
testConnection() => {ok,message,model}
exportExperiment(experiment,format) => {canceled,path?}（format为json/csv/html，系统另存对话框）
importExperiment() => {canceled,experiment?}（校验后创建新id并保存）
reproduceRun(run) => {run,comparison}
openDataDirectory() => {ok:true}

所有桥方法错误以 Error.message 返回友好中文，界面须捕获。浏览器开发模式不得偷偷调用远程API或假装桌面存储；可用专门 browserAdapter 支持本地功能预览并明确预览模式，正式验收必须用 Electron。

## 服务模块 desktop/services
storage.mjs 导出 createStore({dataDir,encrypt,decrypt})，encrypt/decrypt是主代理提供的异步安全存储函数。
store 方法：init(),listExperiments(),saveExperiment(exp),deleteExperiment(id),getSettings(),saveSettings(settings),getPrivateSettings(),importExperimentObject(obj)。getPrivateSettings只供AI内部，含apiKey。
exports.mjs 导出 validateExperimentPackage(obj) => {valid,errors}、createExperimentPackage(exp)、exportCsv(exp)、exportHtml(exp)。导出包格式{format:'kongxiaozhu-experiment',schemaVersion:1,exportedAt,experiment}，不得含API密钥。导入限制大小和数组规模，验证嵌套结构，损坏输入不污染现有数据；HTML需转义全部用户内容。
ai.mjs 导出 createAiService({store,simulate})，simulate为异步计算回调，返回{requestAi,interpretGoal,testConnection}。
aiSession = {id,createdAt,basedOnVersion,conditionKey,question,model,summary,candidates:[{id,hypothesis,controller,run,reason}],toolLog:[...],status:'completed'}。
真实工具调用：OpenAI兼容 /chat/completions，DeepSeek预设。工具 validate_candidate 可最多3套参数，每套实际调用simulate；工具结果回传模型并请求解释。候选结构严格验证，模型不能任意覆盖实验条件、设定模型数值为计算结果或执行代码。apiKey只在主进程获取，网络超时和无效结构明确失败，不降级成假AI。
interpretGoal用受限结构提案，patch仅允许受支持config字段，缺少信息列missing，不能自动写实验状态。URL须https，允许显式localhost http供本机兼容服务测试；不自动跟随带凭据的重定向。默认DeepSeek baseUrl https://api.deepseek.com/v1，model可编辑（主代理核验最新官方模型列表）。

## 界面和模块化要求
src/app/featureRegistry.js 定义功能入口注册表，当前仅control-lab；App作为外层导航容器，预留主界面功能索引，不把未来首页写进实验逻辑。独立ControlLab模块中包含实验库、工作台、我的实验、开放验证；设置作为公共入口。离开模块前自动保存，返回恢复配置。暂用简洁深色CSS变量，不锁定视觉。
工作台支持对象/目标/参数编辑，P/PI/PID，受限自定义系数，曲线y/r/e/u，指标/解释，候选比较，明确应用、旧候选重验证，真实AI问题与自然语言配置提案，自动整定，预测/观察/复盘，记录/导入导出。不宣称学习效果已验证。AI未配置时显示设置入口但手动功能继续可用。
所有实际功能都走桥接口，禁止显示假“已验证”数据。计算请求和AI请求记录版本防旧结果覆盖。导出/删除/应用可明确辨认。图表不同方案使用颜色加线型，目标中性虚线。至少支持正常桌面窗口缩放。

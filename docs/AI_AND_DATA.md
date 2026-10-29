# AI 与本地数据服务

实现位置为 `desktop/services/`。界面通过 Electron 桥调用服务，不接触模型密钥，不直接请求远程模型。仿真回调由主进程提供，计算逻辑不依赖在线 AI。

## 模型设置

默认服务商为 `deepseek`，地址为 `https://api.deepseek.com`，模型为 `deepseek-flash`，单次请求超时为 60 秒。地址、模型、服务商和超时可以编辑。服务地址可带 `/v1`，模块统一追加 `/chat/completions`。模型名以用户账户实际可用名称为准。

DeepSeek 请求显式携带 `thinking: { type: 'disabled' }`，采用普通工具调用；其他服务商不发送此扩展。响应存在 `reasoning_content` 时，同一轮工具调用回传保留该字段。没有模型密钥时明确提示设置，不使用模拟模型回复代替真实 AI。

服务地址必须使用 HTTPS，显式的 `localhost`、`127.0.0.1` 或 `::1` 本机地址可以使用 HTTP。带凭据的请求不跟随重定向。HTTP 权限、限流、超时、格式和截断错误显示中文说明，不将服务商错误正文或密钥输出到实验日志。

默认模型和参数依据主代理核验的 [DeepSeek 官方 API 文档](https://api-docs.deepseek.com/) 与 [工具调用说明](https://api-docs.deepseek.com/guides/tool_calls/)；接口仍应在用户填入密钥后进行实际在线验收。

## AI 服务接口

```js
import { createAiService } from './desktop/services/ai.mjs';
const ai = createAiService({ store, simulate: (config, options) => computeWorker(config, options) });
const session = await ai.requestAi({ experimentId, configVersion, config, question, history: [] });
const proposal = await ai.interpretGoal({ text, config });
const connection = await ai.testConnection();
```

`requestAi` 先实际计算当前配置，再把当前配置、基准指标和问题发送给模型。模型只能请求 `validate_candidate`，候选只可修改 P、PI、PID 控制器参数；不能改模型、目标、仿真窗口或扰动条件，也不能提交自己计算的性能指标。

每次建议最多实际验证 3 套候选，最多 6 轮模型响应；计算服务抛出的故障也消耗候选预算。每套候选由同一个计算回调执行，返回的曲线、指标、状态和判定保存在 `candidate.run`，本次基准计算保存在 `session.baseline`。真实计算结果同时作为工具消息回传模型。无改善、未达标、闭环不稳定等结果仍保留，不伪装为成功。超出预算或非法工具请求记入 `toolLog` 并反馈错误，不执行代码。AI 提供文字解释；界面的数值表和曲线必须读取 `run`，不能从文字中提取数值充当计算证据。

`interpretGoal` 仅返回 `{ patch, missing, explanation }`。可修改范围限定为模型、控制器、仿真、目标信号、扰动、目标阈值和参数范围；合并后通过配置校验。服务不会写入实验或自动应用提案，界面应展示并等待用户确认。缺失信息由模型列出，仍由用户检查。

`testConnection` 只确认模型服务能返回文本，不等同于工具调用验收或实验教学效果验证。

## 本地存储与密钥

```js
import { createStore } from './desktop/services/storage.mjs';
const store = createStore({ dataDir, encrypt, decrypt });
await store.init();
await store.saveSettings({ provider: 'deepseek', apiKey: userEnteredKey });
const publicSettings = await store.getSettings(); // 仅 hasKey，不回显密钥
await store.saveExperiment(experiment);
const experiments = await store.listExperiments();
```

主进程注入 Electron 安全存储的异步 `encrypt` 与 `decrypt`，密钥仅以加密结果的 Base64 存入 `settings.json`。Windows 安全存储一般绑定当前 Windows 用户，备份设置文件不保证能在另一台电脑解密。`getPrivateSettings()` 仅供主进程内的 AI 模块使用，不得暴露到 preload。安全存储不可用时拒绝保存密钥。

空白输入框不会清除已保存密钥；明确 `clearKey: true` 才清除。只含空格的密钥会报错。公开设置不包含 `apiKey`、加密内容或密钥片段。

实验文件保存在 `experiments/<id>.json`。ID 只能包含字母、数字、短横线和下划线，并排除 Windows 保留设备名称。写入通过同目录临时文件与重命名完成，写请求串行执行，失败不会用半个 JSON 替换旧文件。旧版本不能覆盖新版本，配置改变必须递增版本；已有运行记录不能以相同 ID 修改或删除。结构损坏的已有文件不会被当作不存在而覆盖。此处是应用级追溯保护，不是防篡改数字签名。

当前存储实例会记住成功删除的实验 ID，拒绝随后到达的旧自动保存请求，防止“保存、删除、旧保存”队列重新创建已删实验。该保护仅在实例生命周期内有效，不建立持久删除记录；导入使用新 ID，不受影响。

结构损坏的配置不能持久化；界面应保留有效实验并提示输入错误。合法配置的未达标、不稳定、数值错误运行可以记录。单实验最多 200 个运行、候选、会话和预测记录，各种数组和文本也有显式上限；单文件最高 32 MB。本地写盘采用紧凑 JSON，并对最终 UTF-8 字节数再次检查，超过上限时不替换已有文件。JSON 导出同样应使用紧凑序列化，避免缩进让合法实验包膨胀至无法重新导入。

## 导入导出

`exports.mjs` 提供 `validateExperimentPackage`、`createExperimentPackage`、`exportCsv` 和 `exportHtml`。

- JSON 包包含版本、模型、评价条件、运行曲线、计算版本、AI 工具记录、笔记与复盘，可以重新导入。
- CSV 导出运行采样点，使用 UTF-8 BOM，字符串单元格防止被表格软件解释为公式。
- HTML 为独立实验小结，用户文字全部转义，无脚本或远程资源。

导出与保存会递归排除常见密钥、授权和密码字段。用户主动把凭据粘进普通笔记属于普通文本，系统无法可靠识别所有此类内容；软件不自动在笔记中填写密钥。

导入先完整验证 JSON 类型、层级、大小、配置、曲线长度和时间轴、指标、候选、会话与预测，再生成新实验 ID 保存。候选版本必须与其运行版本一致，运行评价条件键必须与配置相符，AI 基准和候选必须使用同一会话条件；未完成计算不能标为达标。原实验保持不变。导入数据是历史记录，不能仅因它具有 `pass` 字段而声称当前软件已重新验证；应调用复算功能比对。

## 测试与证据边界

运行 `node --test tests/services.test.mjs`。包含大实验实际写盘并重新读取的回归用例，防止缩进序列化突破文件大小上限；另外用四个内置案例的真实计算与自动整定结果检查实验包兼容性，四个均通过。

测试使用本机 HTTP 服务模拟协议，模拟计算回调返回明确标为测试固定数据的运行结果，用于验证实际 HTTP 请求、工具反馈、3 套预算、参数隔离、DeepSeek 参数、重定向拒绝、超时、错误响应、配置提案、不可覆盖历史、导入隔离和导出密钥排除。测试加密函数是测试用可逆编码，不是产品加密实现。

这些测试不证明真实 DeepSeek 服务、真实账户额度、模型解释正确率或教学效果。用户尚未配置密钥，真实在线工具调用仍需之后验收；数值正确性由独立计算模块测试验证，Electron 安全存储与软件打包由主进程集成测试验证。

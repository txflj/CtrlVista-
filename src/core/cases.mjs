import { clone } from './config.mjs';

const commonSteps = [
  '阅读模型假设和任务指标，记录你对参数影响的预测。',
  '运行初始方案，观察目标、响应、误差和控制输出。',
  '一次改变少量参数，检查改善与代价，并保存观察。',
  '请求 AI 验证建议，或使用自动整定获得计算对照。',
  '在相同条件下比较方案，写下结论并导出实验记录。',
];

export const CASES = [
  {
    id: 'motor', name: '电机调速',
    description: '用一阶归一化电机模型，理解比例与积分如何影响响应速度及稳态误差。',
    learningGoals: ['比较 P 与 PI 的稳态误差', '理解响应速度与控制输出峰值的取舍', '用计算证据解释每次参数修改'],
    assumptions: ['对象 G(s)=1/(0.5s+1)，时间单位为秒。', '忽略电气快动态、摩擦非线性和负载限幅；输入、转速均归一化。', '初始状态为零；本实验的控制输出预算是评价约束，不会自动裁剪输出。'],
    steps: commonSteps,
    referenceController: { type: 'PI', kp: 2, ki: 4, kd: 0, tf: 0.05 },
  },
  {
    id: 'position', name: '机械定位',
    description: '用稳定的二阶柔性定位教学模型，减小目标附近的超调和振荡。',
    learningGoals: ['识别欠阻尼响应', '比较积分与测量微分的作用', '观察更强微分控制的输出代价'],
    assumptions: ['对象 G(s)=1/(s²+0.6s+1)，代表带恢复力的简化定位环节。', '这是稳定二阶教学对象，不是包含自由积分的真实裸电机位置模型。', '位置及驱动力归一化，忽略间隙、摩擦、饱和及传感器噪声。'],
    steps: commonSteps,
    referenceController: { type: 'PID', kp: 2, ki: 1, kd: 3, tf: 0.05 },
  },
  {
    id: 'temperature', name: '温度调节',
    description: '在归一化热惯性模型上施加持续负载扰动，观察跟踪与扰动恢复。',
    learningGoals: ['区分目标跟踪和扰动抑制', '理解积分对持续负载的补偿', '检验扰动恢复时间和控制输出预算'],
    assumptions: ['对象 G(s)=1/(8s+1)，以工作点附近温差为归一化输出。', '忽略纯滞后和环境非线性；允许双向归一化控制输入。', '25 s 时在对象输入端加入 −0.6 的持续扰动；不是直接修改输出温度。'],
    steps: commonSteps,
    referenceController: { type: 'PI', kp: 4, ki: 0.5, kd: 0, tf: 0.1 },
  },
  {
    id: 'challenge', name: '综合挑战',
    description: '独立为三阶串联惯性对象设计控制器，同时满足速度、超调、误差与控制预算。',
    learningGoals: ['在有限范围内设计并比较参数', '识别稳定对象也可能产生不稳定闭环', '解释速度、精度及控制作用之间的取舍'],
    assumptions: ['对象 G(s)=1/[(s+1)(0.4s+1)(0.1s+1)]，即 1/(0.04s³+0.54s²+1.5s+1)。', '三个稳定惯性环节串联，输入与输出均归一化。', '挑战使用已知简化对象，不等同于真实工业系统的鲁棒性保证。'],
    steps: ['先独立选择 P、PI 或 PID，并写下预期结果。', ...commonSteps.slice(1)],
    referenceController: { type: 'PID', kp: 2, ki: 1, kd: 0.7, tf: 0.05 },
  },
];

const defaults = {
  motor: {
    plant: { numerator: [1], denominator: [0.5, 1], inputUnit: '归一化输入', outputUnit: '归一化转速' },
    controller: { type: 'PI', kp: 0.6, ki: 0.3, kd: 0, tf: 0.05 },
    duration: 10, dt: 0.01,
    goals: { overshootMax: 10, settlingTimeMax: 4, steadyErrorMax: 0.02, recoveryTimeMax: null, controlPeakMax: 10, holdTime: 0.5 },
  },
  position: {
    plant: { numerator: [1], denominator: [1, 0.6, 1], inputUnit: '归一化驱动力', outputUnit: '归一化位置' },
    controller: { type: 'PID', kp: 3, ki: 1.5, kd: 0.1, tf: 0.05 },
    duration: 25, dt: 0.02,
    goals: { overshootMax: 15, settlingTimeMax: 12, steadyErrorMax: 0.02, recoveryTimeMax: null, controlPeakMax: 15, holdTime: 1 },
  },
  temperature: {
    plant: { numerator: [1], denominator: [8, 1], inputUnit: '归一化热流', outputUnit: '归一化温差' },
    controller: { type: 'PI', kp: 1, ki: 0.05, kd: 0, tf: 0.1 },
    duration: 65, dt: 0.05,
    disturbance: { enabled: true, time: 25, amplitude: -0.6, duration: null },
    goals: { overshootMax: 10, settlingTimeMax: 12, steadyErrorMax: 0.02, recoveryTimeMax: 25, controlPeakMax: 10, holdTime: 2 },
  },
  challenge: {
    plant: { numerator: [1], denominator: [0.04, 0.54, 1.5, 1], inputUnit: '归一化输入', outputUnit: '归一化输出' },
    controller: { type: 'PID', kp: 1, ki: 0.25, kd: 0, tf: 0.05 },
    duration: 20, dt: 0.02,
    goals: { overshootMax: 12, settlingTimeMax: 10, steadyErrorMax: 0.02, recoveryTimeMax: null, controlPeakMax: 8, holdTime: 1 },
  },
};

export function createCaseConfig(caseId) {
  const definition = CASES.find(item => item.id === caseId);
  if (!definition) throw new Error('未知实验，请从实验库选择支持的案例');
  const item = defaults[caseId];
  return clone({
    schemaVersion: 1, caseId, title: definition.name,
    plant: item.plant, controller: item.controller,
    simulation: { duration: item.duration, dt: item.dt, initialState: [], integralInitial: 0, filterInitial: 0 },
    signal: { initial: 0, target: 1, stepTime: 0 },
    disturbance: item.disturbance ?? { enabled: false, time: item.duration / 2, amplitude: 0.2, duration: null },
    goals: { ...item.goals, absoluteTolerance: 0.02, relativeTolerance: 0.02, referenceScale: 1 },
    bounds: { kp: [0, 30], ki: [0, 20], kd: [0, 10] },
  });
}

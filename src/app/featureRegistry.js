// The launcher owns feature discovery; each feature owns its domain state and views.
// Add future features here without changing the control experiment implementation.
export const featureHomeEnabled = true;
export const featureRegistry = [
  {
    id: 'control-lab',
    title: '控制实验工作台',
    description: '学习 P、PI、PID 控制，运行仿真并验证 AI 的建议。',
    tag: '本机计算',
    load: () => import('../ui/control-lab/ControlLab.jsx'),
  },
];

import React, { useEffect, useState } from 'react';
import { Button, NumberField, TextField } from '../components.jsx';

function Coefficients({ label, value, onChange, allowEmpty = false }) {
  const [text, setText] = useState(value.join(', '));
  const [error, setError] = useState('');
  useEffect(() => { setText(value.join(', ')); setError(''); }, [JSON.stringify(value)]);
  function commit() {
    const trimmed = text.trim();
    const parts = trimmed ? trimmed.split(/[,，\s]+/) : [];
    const numbers = parts.map(Number);
    if ((!allowEmpty && !numbers.length) || numbers.some(number => !Number.isFinite(number))) { setError('请输入以逗号或空格分隔的有限数值。'); return; }
    setError('');
    if (JSON.stringify(value) !== JSON.stringify(numbers)) onChange(numbers);
  }
  return <TextField label={label}><input value={text} onChange={event => setText(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} aria-invalid={Boolean(error)} />{error && <small className="error-text">{error}</small>}</TextField>;
}

export default function ConfigEditor({ experiment, editConfig, editMeta, referenceController, applyReference, busy }) {
  const c = experiment.config;
  const update = (section, key, value) => editConfig({ [section]: { [key]: value } });
  return <div className="configuration-stack">
    <section className="panel">
      <div className="section-heading"><h2>模型与目标</h2><span className="tag">配置 v{experiment.version}</span></div>
      <TextField label="实验名称" value={experiment.title} onChange={event => editMeta({ title: event.target.value })} maxLength={160} />
      <div className="field-grid"><NumberField label="目标值" value={c.signal.target} onChange={value => update('signal', 'target', value)} /><NumberField label="阶跃时刻" value={c.signal.stepTime} suffix="s" min={0} onChange={value => update('signal', 'stepTime', value)} /></div>
      <div className="field-grid"><NumberField label="仿真时长" value={c.simulation.duration} suffix="s" min={0.01} onChange={value => update('simulation', 'duration', value)} /><NumberField label="采样间隔" value={c.simulation.dt} suffix="s" min={0.0001} onChange={value => update('simulation', 'dt', value)} /></div>
      <details><summary>被控对象与初始条件</summary><p className="hint">连续、稳定、正稳态增益的严格真有理 SISO 对象，最高 3 阶。系数按 s 的降幂排列。</p>
        <Coefficients label="传递函数分子系数" value={c.plant.numerator} onChange={value => update('plant', 'numerator', value)} />
        <Coefficients label="传递函数分母系数" value={c.plant.denominator} onChange={value => update('plant', 'denominator', value)} />
        <div className="field-grid"><TextField label="输入单位" value={c.plant.inputUnit} onChange={event => update('plant', 'inputUnit', event.target.value)} /><TextField label="输出单位" value={c.plant.outputUnit} onChange={event => update('plant', 'outputUnit', event.target.value)} /></div>
        <Coefficients label="对象初态（空白表示零初态）" value={c.simulation.initialState} allowEmpty onChange={value => update('simulation', 'initialState', value)} />
        <NumberField label="阶跃前给定值" value={c.signal.initial} onChange={value => update('signal', 'initial', value)} />
        <div className="field-grid"><NumberField label="积分状态初值" value={c.simulation.integralInitial} onChange={value => update('simulation', 'integralInitial', value)} /><NumberField label="微分滤波初值" value={c.simulation.filterInitial} onChange={value => update('simulation', 'filterInitial', value)} /></div>
      </details>
      <details><summary>扰动设置</summary><label className="check"><input type="checkbox" checked={c.disturbance.enabled} onChange={event => update('disturbance', 'enabled', event.target.checked)} />启用对象输入端扰动</label>
        <div className="field-grid"><NumberField label="扰动时刻" suffix="s" min={0} value={c.disturbance.time} onChange={value => update('disturbance', 'time', value)} /><NumberField label="扰动幅度" value={c.disturbance.amplitude} onChange={value => update('disturbance', 'amplitude', value)} /></div>
        <label className="check"><input type="checkbox" checked={c.disturbance.duration !== null} onChange={event => update('disturbance', 'duration', event.target.checked ? 1 : null)} />使用有限时长脉冲</label>
        {c.disturbance.duration !== null && <NumberField label="扰动持续时间" suffix="s" min={0.001} value={c.disturbance.duration} onChange={value => update('disturbance', 'duration', value)} />}
      </details>
    </section>
    <section className="panel controller-panel"><div className="section-heading"><h2>控制器</h2><span className="muted">输入后自动计算</span></div>
      <div className="segmented" role="group" aria-label="控制器类型">{['P', 'PI', 'PID'].map(type => <Button key={type} className={c.controller.type === type ? 'selected' : ''} onClick={() => update('controller', 'type', type)}>{type}</Button>)}</div>
      <div className="field-grid controller-fields"><NumberField label="比例 Kp" value={c.controller.kp} min={c.bounds.kp[0]} max={c.bounds.kp[1]} onChange={value => update('controller', 'kp', value)} /><NumberField label="积分 Ki" disabled={c.controller.type === 'P'} value={c.controller.ki} min={c.bounds.ki[0]} max={c.bounds.ki[1]} onChange={value => update('controller', 'ki', value)} /><NumberField label="微分 Kd" disabled={c.controller.type !== 'PID'} value={c.controller.kd} min={c.bounds.kd[0]} max={c.bounds.kd[1]} onChange={value => update('controller', 'kd', value)} /><NumberField label="微分滤波 Tf" disabled={c.controller.type !== 'PID'} suffix="s" value={c.controller.tf} min={0.0001} onChange={value => update('controller', 'tf', value)} /></div>
      <p className="hint">微分作用于测量值并经过一阶滤波。P 不使用积分与微分；PI 不使用微分。</p>
      <details><summary>参数范围与教学参考</summary><p className="hint">手动操作与自动整定使用相同范围。</p>{['kp', 'ki', 'kd'].map(key => <div className="field-grid" key={key}><NumberField label={`${key.toUpperCase()} 下限`} value={c.bounds[key][0]} onChange={value => update('bounds', key, [value, c.bounds[key][1]])} /><NumberField label={`${key.toUpperCase()} 上限`} value={c.bounds[key][1]} onChange={value => update('bounds', key, [c.bounds[key][0], value])} /></div>)}
        {referenceController && <><p className="hint">参考参数用于复盘。模型或目标改变后，参考方案仍需按当前条件重新验证。</p><code className="controller-code">{referenceController.type} · Kp {referenceController.kp} · Ki {referenceController.ki} · Kd {referenceController.kd}</code><Button onClick={applyReference} disabled={busy.apply}>验证并应用参考参数</Button></>}
      </details>
    </section>
    <section className="panel"><h2>评价目标</h2><div className="field-grid">
      <NumberField label="最大目标超调" suffix="%" min={0} value={c.goals.overshootMax} onChange={value => update('goals', 'overshootMax', value)} />
      <NumberField label="最大调节时间" suffix="s" min={0} value={c.goals.settlingTimeMax} onChange={value => update('goals', 'settlingTimeMax', value)} />
      <NumberField label="最大稳态误差" min={0} value={c.goals.steadyErrorMax} onChange={value => update('goals', 'steadyErrorMax', value)} />
      <NumberField label="最大控制峰值" min={0} value={c.goals.controlPeakMax} onChange={value => update('goals', 'controlPeakMax', value)} />
      {c.disturbance.enabled && <NumberField label="最大恢复时间" suffix="s" min={0} value={c.goals.recoveryTimeMax} onChange={value => update('goals', 'recoveryTimeMax', value)} />}
    </div><details><summary>误差带与判定口径</summary><div className="field-grid"><NumberField label="绝对容差" value={c.goals.absoluteTolerance} min={0} onChange={value => update('goals', 'absoluteTolerance', value)} /><NumberField label="相对容差" value={c.goals.relativeTolerance} min={0} onChange={value => update('goals', 'relativeTolerance', value)} /><NumberField label="参考尺度" value={c.goals.referenceScale} min={0.00001} onChange={value => update('goals', 'referenceScale', value)} /><NumberField label="最短保持时间" suffix="s" value={c.goals.holdTime} min={0} onChange={value => update('goals', 'holdTime', value)} /></div><p className="hint">前扰动目标跟踪与扰动恢复分段计算。仿真窗口不足或未达到误差带时，相关时间指标显示“无法判定”。</p></details></section>
  </div>;
}

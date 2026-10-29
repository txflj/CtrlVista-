import React, { useMemo, useRef, useState } from 'react';
import { CASES, validateConfig } from '../../core/index.mjs';
import { Button, Empty, NumberField, Status, TextField } from '../components.jsx';
import ConfigEditor from './ConfigEditor.jsx';
import AiAssistant from './AiAssistant.jsx';
import './workbench-layout.css';
import ResponseChart from './ResponseChart.jsx';
import { asList, dateText, metricLabels, metricUnits, numberText } from './model.js';
import { getActiveRun, getComparisonRun } from './comparison.js';

const controllerText = c => `${c.type} · Kp ${numberText(c.kp)} · Ki ${numberText(c.ki)} · Kd ${numberText(c.kd)} · Tf ${numberText(c.tf)}`;
const sourceText = { ai: 'AI 验证', autotune: '自动整定', reference: '教学参考' };
const stepNames = ['理解任务', '预测与尝试', '观察结果', '改进与比较', '实验复盘'];
const words = value => typeof value === 'string' ? value : value?.title || value?.description || JSON.stringify(value);

function Metrics({ run }) {
  if (!run) return <Empty title="先运行一次实验">曲线和指标共用同一次计算结果。</Empty>;
  return <>
    <div className="result-summary"><Status value={run.verdict} /><Status value={run.status} /><span>{run.reason}</span></div>
    <div className="metric-grid">{['overshoot', 'settlingTime', 'steadyError', 'recoveryTime', 'controlPeak'].map(key => <div className="metric" key={key}><span>{metricLabels[key]}</span>{key === 'recoveryTime' && !run.config.disturbance.enabled ? <><strong>不适用</strong><span className="hint">未启用扰动</span></> : <strong>{numberText(run.metrics?.[key], 4)}{Number.isFinite(run.metrics?.[key]) && <small>{metricUnits[key]}</small>}</strong>}</div>)}</div>
    <details><summary>每项指标的判定依据</summary><div className="table-scroll"><table><thead><tr><th>指标</th><th>实际值</th><th>上限</th><th>判定</th><th>依据</th></tr></thead><tbody>{(run.checks || []).map((check, index) => <tr key={`${check.key}-${index}`}><td>{check.label}</td><td>{numberText(check.value, 5)}</td><td>{numberText(check.limit, 5)}</td><td><Status value={check.state} /></td><td>{check.message || '—'}</td></tr>)}</tbody></table></div>
      <p className="hint">计算版本 {run.engineVersion} · {dateText(run.createdAt)} · 配置 v{run.configVersion}</p>
      {run.warnings?.length > 0 && <ul className="warning-list">{run.warnings.map((text, i) => <li key={i}>{text}</li>)}</ul>}
      <details><summary>闭环极点与完整计算快照</summary><pre>{JSON.stringify({ poles: run.poles, config: run.config }, null, 2)}</pre></details>
    </details>
  </>;
}

function LearningLog({ lab }) {
  const { experiment: exp, editMeta, addPrediction } = lab;
  const [prediction, setPrediction] = useState('');
  return <section className="panel" id="learning-log"><div className="section-heading"><h2>预测、观察与复盘</h2><span className="tag">保留实验过程</span></div><TextField label="操作前，我预计会发生什么"><textarea rows={2} maxLength={20000} value={prediction} onChange={event => setPrediction(event.target.value)} placeholder="例如：增大 Kp 会加快响应，但可能增加超调。" /></TextField><Button disabled={!prediction.trim()} onClick={() => { if (addPrediction(prediction)) setPrediction(''); }}>保存预测</Button>
    {exp.predictions.slice().reverse().map(item => <article className="prediction" key={item.id}><p className="hint">配置 v{item.configVersion} · {dateText(item.createdAt)}</p><p className="preserve-lines">{item.text}</p><TextField label="实验后的观察"><textarea rows={2} maxLength={20000} value={item.observation || ''} onChange={event => editMeta({ predictions: exp.predictions.map(p => p.id === item.id ? { ...p, observation: event.target.value } : p) })} placeholder="曲线与预测一致吗？用指标支持你的判断。" /></TextField></article>)}
    <TextField label="实验笔记"><textarea rows={3} maxLength={20000} value={exp.notes} onChange={event => editMeta({ notes: event.target.value })} placeholder="记录调整理由、异常现象和待验证问题。" /></TextField><TextField label="个人结论与取舍"><textarea rows={3} maxLength={20000} value={exp.reflection} onChange={event => editMeta({ reflection: event.target.value })} placeholder="最终选择了哪套方案？获得了什么，又付出了什么代价？" /></TextField>
  </section>;
}

const workspacePanels = [
  ['response', '响应与指标'], ['comparison', '方案对比'],
  ['learning', '预测与复盘'], ['history', '运行记录'],
];

export default function Workbench({ lab, api, settings, onSettings, active = true, visible = true }) {
  const exp = lab.experiment;
  const [quantity, setQuantity] = useState('y');
  const [selected, setSelected] = useState([]);
  const [showPrevious, setShowPrevious] = useState(true);
  const [budget, setBudget] = useState(48);
  const [seed, setSeed] = useState(42);
  const [stage, setStage] = useState(0);
  const [activePanel, setActivePanel] = useState('response');
  const tabRefs = useRef({});
  const info = CASES.find(item => item.id === exp.caseId);
  const activeRun = getActiveRun(exp);
  const previousRun = getComparisonRun(exp, activeRun);
  const valid = useMemo(() => validateConfig(exp.config), [exp.config]);
  const candidates = exp.candidates.slice().reverse();
  const entries = activeRun ? [{ key: activeRun.id, label: `当前查看 · v${activeRun.configVersion}`, run: activeRun, styleIndex: 0 }] : [];
  if (showPrevious && previousRun) entries.push({ key: previousRun.id, label: `固定对照 · v${previousRun.configVersion}`, run: previousRun, styleIndex: 1 });
  candidates.filter(candidate => selected.includes(candidate.id) && candidate.run?.conditionKey === activeRun?.conditionKey).slice(0, 2).forEach((candidate, index) => entries.push({ key: candidate.id, label: candidate.label, run: candidate.run, styleIndex: index + 2 }));
  function openPanel(id, focus = false) {
    setActivePanel(id);
    if (focus) tabRefs.current[id]?.focus();
  }
  function changeStage(index) {
    setStage(index);
    openPanel(['response', 'learning', 'response', 'comparison', 'learning'][index]);
  }
  function tabKey(event, index) {
    const key = event.key;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
    event.preventDefault();
    const next = key === 'Home' ? 0 : key === 'End' ? workspacePanels.length - 1 : (index + (key === 'ArrowRight' ? 1 : -1) + workspacePanels.length) % workspacePanels.length;
    openPanel(workspacePanels[next][0], true);
  }
  function toggleCompare(id) { setSelected(value => value.includes(id) ? value.filter(item => item !== id) : [...value.slice(-1), id]); }
  function panelProps(id) { return { id: `workspace-panel-${id}`, role: 'tabpanel', 'aria-labelledby': `workspace-tab-${id}`, hidden: activePanel !== id, tabIndex: 0 }; }
  async function runSimulation() { openPanel('response'); await lab.run(); }
  async function applyCandidate(candidate) { await lab.applyCandidate(candidate); openPanel('response'); }
  return <div className="workbench" hidden={!visible}>
    <div className="workbench-toolbar">
      <div><p className="eyebrow">{info?.name || '自定义实验'} / {exp.mode === 'guided' ? '引导实验' : '自由探索'}</p><h1>{exp.title || '未命名实验'}</h1></div>
      <div className="action-row"><label className="check"><input type="checkbox" checked={lab.autoRun} onChange={event => lab.setAutoRun(event.target.checked)} />自动运行</label><Button kind="primary" data-testid="run-simulation" disabled={lab.busy.simulation} onClick={runSimulation}>{lab.busy.simulation ? '正在计算…' : '运行仿真'}</Button><Button onClick={() => lab.editMeta({ mode: exp.mode === 'guided' ? 'free' : 'guided' })}>{exp.mode === 'guided' ? '切换自由探索' : '切换引导实验'}</Button></div>
    </div>
    {exp.mode === 'guided' && <section className="guide-strip" aria-label="实验引导">
      <div className="guide-steps">{stepNames.map((name, index) => <button key={name} className={stage === index ? 'active' : ''} aria-current={stage === index ? 'step' : undefined} onClick={() => changeStage(index)}><span>{index + 1}</span>{name}</button>)}</div>
      <div className="guide-copy"><p>{asList(info?.steps)[stage] ? words(asList(info.steps)[stage]) : '调整参数、观察曲线，并记录自己的结论。'}</p><div className="action-row">{stage > 0 && <Button onClick={() => changeStage(stage - 1)}>上一步</Button>}{stage < 4 && <Button onClick={() => changeStage(stage + 1)}>下一步</Button>}</div></div>
    </section>}
    {!valid.valid && <div className="callout error" role="alert"><strong>配置需要修改</strong><ul>{valid.errors.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    <div className="workbench-grid">
      <aside className="parameter-pane" aria-label="实验参数" tabIndex={0}><ConfigEditor experiment={exp} editConfig={lab.editConfig} editMeta={lab.editMeta} referenceController={info?.referenceController} applyReference={() => applyCandidate({ controller: info.referenceController, label: '教学参考' })} busy={lab.busy} /></aside>
      <div className="workbench-main">
        <div className="workspace-tabs" role="tablist" aria-label="实验工作区">{workspacePanels.map(([id, label], index) => <button key={id} ref={node => { tabRefs.current[id] = node; }} id={`workspace-tab-${id}`} data-testid={`workspace-tab-${id}`} type="button" role="tab" aria-selected={activePanel === id} aria-controls={`workspace-panel-${id}`} tabIndex={activePanel === id ? 0 : -1} onClick={() => openPanel(id)} onKeyDown={event => tabKey(event, index)}>{label}{id === 'comparison' && candidates.length > 0 && <span aria-label={`${candidates.length} 个候选`}>{candidates.length}</span>}{id === 'history' && exp.runs.length > 0 && <span aria-label={`${exp.runs.length} 次运行`}>{exp.runs.length}</span>}</button>)}</div>
        <div className="workspace-body">
          <section {...panelProps('response')} className="workspace-view panel chart-panel">
            <div className="section-heading"><div><h2>动态响应</h2>{activeRun && <span className="hint">正在查看配置 v{activeRun.configVersion}{activeRun.configVersion !== exp.version ? '，与当前编辑配置不同，请重新运行。' : '，对应当前配置。'}</span>}</div><div className="segmented" role="group" aria-label="曲线类型">{[['y', '输出与目标'], ['e', '误差'], ['u', '控制作用']].map(([key, label]) => <Button key={key} className={quantity === key ? 'selected' : ''} onClick={() => setQuantity(key)}>{label}</Button>)}</div></div>
            <ResponseChart entries={entries} quantity={quantity} unit={quantity === 'u' ? (activeRun?.config || exp.config).plant.inputUnit : (activeRun?.config || exp.config).plant.outputUnit} />
            <div className="chart-comparison-control"><label className="check"><input type="checkbox" checked={showPrevious} onChange={event => setShowPrevious(event.target.checked)} disabled={!previousRun} />显示固定对照曲线</label><span className="hint" title="紫色虚线为固定对照；自动预览和同参数重复运行保持不变，改参后手动运行新方案才更新。">紫线保留对照，手动运行新方案后更新。</span></div>
            {exp.comparisonRunId && !previousRun && activeRun && exp.comparisonRunId !== activeRun.id && <p className="hint">固定对照与当前结果的评价条件不同，暂不叠加。</p>}
            <Metrics run={activeRun} />
          </section>
          <section {...panelProps('comparison')} className="workspace-view panel" data-section="candidate-comparison">
            <div className="section-heading"><div><h2>方案对比</h2><p className="hint">保持同一实验条件，比较改善与代价。</p></div><Button onClick={() => openPanel('response', true)}>查看叠加曲线</Button></div>
            <div className="tune-row"><NumberField label="搜索预算" value={budget} min={8} max={160} step={1} onChange={setBudget} /><NumberField label="随机种子" value={seed} step={1} onChange={setSeed} /><Button onClick={() => lab.tune(budget, seed)} disabled={lab.busy.tune || !valid.valid}>{lab.busy.tune ? '正在搜索参数…' : '生成自动整定对照'}</Button></div>
            {entries.length > 1 && <div className="table-scroll"><table className="comparison-table"><thead><tr><th>方案</th><th>超调 / %</th><th>调节时间 / s</th><th>稳态误差</th><th>控制峰值</th><th>判定</th></tr></thead><tbody>{entries.map(entry => <tr key={entry.key}><td>{entry.label}</td>{['overshoot', 'settlingTime', 'steadyError', 'controlPeak'].map(key => <td key={key}>{numberText(entry.run.metrics?.[key], 4)}</td>)}<td><Status value={entry.run.verdict} /></td></tr>)}</tbody></table></div>}
            {!candidates.length ? <Empty title="还没有候选方案">点击“生成自动整定对照”，或打开右下角 AI 助手提出并验证建议。</Empty> : <div className="candidate-list">{candidates.map(candidate => {
              const compatible = Boolean(activeRun && candidate.run?.conditionKey === activeRun.conditionKey);
              return <article className="candidate" key={candidate.id}><div className="section-heading"><div><strong>{candidate.label || sourceText[candidate.source] || '候选方案'}</strong><span className="tag">{sourceText[candidate.source] || candidate.source}</span></div><Status value={candidate.run?.verdict} /></div><code className="controller-code">{controllerText(candidate.controller)}</code>{candidate.hypothesis && <p>{candidate.hypothesis}</p>}{candidate.reason && <p className="hint">{candidate.reason}</p>}<div className="candidate-metrics"><span>超调 {numberText(candidate.run?.metrics?.overshoot)} %</span><span>调节 {numberText(candidate.run?.metrics?.settlingTime)} s</span><span>峰值 {numberText(candidate.run?.metrics?.controlPeak)}</span></div><p className="hint">基于配置 v{candidate.basedOnVersion}{candidate.basedOnVersion !== exp.version ? ' · 配置已改变，应用前必须重新验证' : ''}</p><div className="action-row"><label className="check"><input type="checkbox" checked={selected.includes(candidate.id) && compatible} disabled={!compatible} onChange={() => toggleCompare(candidate.id)} />加入比较</label><Button onClick={() => applyCandidate(candidate)} disabled={lab.busy.apply}>{lab.busy.apply ? '正在验证…' : '重新验证并应用'}</Button>{!compatible && <span className="hint">与当前查看结果条件不同</span>}</div></article>;
            })}</div>}
          </section>
          <section {...panelProps('learning')} className="workspace-view learning-view"><LearningLog lab={lab} /></section>
          <section {...panelProps('history')} className="workspace-view panel history-view">
            <div className="section-heading"><div><h2>运行记录与复现</h2><p className="hint">{exp.runs.length} 次运行，查看、恢复或复算任意一份记录。</p></div></div>
            <div className="action-row"><Button onClick={() => lab.flushSave().catch(error => lab.inform(error.message, 'error'))}>立即保存</Button><Button onClick={() => lab.exportAs('json')}>导出实验包</Button><Button onClick={() => lab.exportAs('csv')}>导出曲线 CSV</Button><Button onClick={() => lab.exportAs('html')}>导出实验小结</Button></div>
            <div className="run-history">{exp.runs.slice().reverse().map(run => <div className={`run-item ${run.id === activeRun?.id ? 'active' : ''}`} key={run.id}><div><strong>配置 v{run.configVersion}</strong><span className="hint">{dateText(run.createdAt)}</span><Status value={run.verdict} /><Status value={run.status} /></div><div className="action-row"><Button onClick={() => { lab.editMeta({ activeRunId: run.id }); openPanel('response', true); }}>查看结果</Button><Button onClick={() => { lab.editConfig(run.config); openPanel('response', true); }}>按此配置继续</Button><Button disabled={lab.busy.reproduce} onClick={() => lab.reproduce(run)}>复算核对</Button></div></div>)}</div>
            {lab.reproduction && <div className={`callout ${lab.reproduction.comparison?.pass ? '' : 'warning'}`}><strong>{lab.reproduction.comparison?.pass ? '复算一致' : '复算存在差异'}</strong><p>{lab.reproduction.comparison?.summary}</p><details><summary>复算容差与差异</summary><pre>{JSON.stringify(lab.reproduction.comparison, null, 2)}</pre></details></div>}
          </section>
        </div>
      </div>
    </div>
    <AiAssistant key={exp.id} lab={lab} api={api} settings={settings} onSettings={onSettings} onOpenCandidates={() => openPanel('comparison', true)} active={active} />
  </div>;
}

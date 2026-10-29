import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CASES, ENGINE_VERSION, createCaseConfig } from '../../core/index.mjs';
import { Button, Empty, Status } from '../components.jsx';
import Workbench from './Workbench.jsx';
import useExperiment from './useExperiment.js';
import { asList, clone, dateText, makeId, numberText } from './model.js';

const navItems = [['library', '实验库', '01'], ['workbench', '实验工作台', '02'], ['records', '我的实验', '03'], ['verification', '开放与验证', '04']];

function Library({ startCase, current, continueExperiment }) {
  return <main className="page library-page"><div className="page-heading"><div><p className="eyebrow">从现象出发，用实验解释</p><h1>控制实验库</h1><p>先尝试，再观察。让 AI 的建议接受同一套计算检验。</p></div>{current && <Button onClick={continueExperiment}>继续当前实验</Button>}</div>
    <div className="library-intro"><span>3 个引导实验 + 1 个综合挑战</span><span>无需真实硬件</span><span>本机计算与存储</span></div>
    <div className="case-grid">{CASES.map((item, index) => <article className={`case-card case-${item.id}`} key={item.id}><div className="case-meta"><span className="case-number">0{index + 1}</span><span className="tag">{item.id === 'challenge' ? '综合挑战' : '引导实验'}</span></div><h2>{item.name}</h2><p>{item.description}</p><h3>你将学习</h3><ul>{asList(item.learningGoals).map((goal, i) => <li key={i}>{goal}</li>)}</ul><details><summary>模型假设与边界</summary><ul>{asList(item.assumptions).map((assumption, i) => <li key={i}>{assumption}</li>)}</ul></details><Button kind="primary" data-testid={`start-${item.id}`} onClick={() => startCase(item.id)}>开始{item.id === 'challenge' ? '挑战' : '实验'}</Button></article>)}</div>
    <section className="panel compact-panel"><h2>每次实验保留完整过程</h2><p>选择任务 → 写下预测 → 调整参数 → 观察曲线 → 验证建议 → 比较方案 → 保存结论。模型均为注明假设的教学简化模型，结果由实际计算生成。</p></section>
  </main>;
}

function Records({ experiments, currentId, restore, duplicate, remove, importFile, refresh, busy }) {
  return <main className="page"><div className="page-heading"><div><p className="eyebrow">本机实验档案</p><h1>我的实验</h1><p>恢复参数和实验过程，导入可复算的实验包。</p></div><div className="action-row"><Button onClick={refresh}>刷新列表</Button><Button kind="primary" onClick={importFile} disabled={busy}>导入实验包</Button></div></div>
    {!experiments.length ? <Empty title="还没有保存的实验">从实验库开始，参数、运行记录和笔记会自动保存到本机。</Empty> : <div className="records-list">{experiments.map(exp => {
      const run = exp.runs.find(item => item.id === exp.activeRunId) || exp.runs.at(-1);
      return <article className="record-card" key={exp.id}><div className="record-main"><div className="section-heading"><h2>{exp.title || '未命名实验'}</h2>{currentId === exp.id && <span className="tag">当前实验</span>}</div><p className="hint">{CASES.find(item => item.id === exp.caseId)?.name || exp.caseId} · 配置 v{exp.version} · {exp.runs.length} 次运行 · {dateText(exp.updatedAt)}</p><p className="record-note">{exp.reflection || exp.notes || '还没有填写个人结论。'}</p><div className="action-row">{run && <Status value={run.verdict} />}<span className="muted">{exp.aiSessions.length} 次 AI 请求 · {exp.predictions.length} 条预测</span></div></div><div className="record-actions"><Button kind="primary" onClick={() => restore(exp)}>{currentId === exp.id ? '继续实验' : '恢复实验'}</Button><Button onClick={() => duplicate(exp)}>复制实验</Button><Button kind="danger-subtle" onClick={() => remove(exp)}>删除</Button></div></article>;
    })}</div>}
  </main>;
}

function Verification({ api, dataPath, inform }) {
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  async function verifyDefaults() {
    setBusy(true); setResults([]);
    try {
      for (const item of CASES) {
        const config = createCaseConfig(item.id); config.controller = { ...item.referenceController };
        const run = await api.simulate(config, { configVersion: 1 });
        setResults(value => [...value, { name: item.name, run }]);
      }
    } catch (error) { inform(error.message, 'error'); }
    finally { setBusy(false); }
  }
  return <main className="page verification-page"><div className="page-heading"><div><p className="eyebrow">让结论可以检查与复现</p><h1>开放与验证</h1><p>计算版本 {ENGINE_VERSION}。这里说明能力边界，并提供实际计算入口。</p></div></div><div className="verification-grid">
    <section className="panel"><h2>内置案例参考验证</h2><p>使用各案例默认条件与教学参考控制器，在本机重新计算。结果仅代表这些已知教学模型下的表现。</p><Button kind="primary" onClick={verifyDefaults} disabled={busy}>{busy ? '正在逐项计算…' : '验证 4 个参考方案'}</Button>{results.length > 0 && <div className="table-scroll"><table><thead><tr><th>案例</th><th>判定</th><th>超调 / %</th><th>调节时间 / s</th></tr></thead><tbody>{results.map(({ name, run }) => <tr key={run.id}><td>{name}</td><td><Status value={run.verdict} /></td><td>{numberText(run.metrics.overshoot)}</td><td>{numberText(run.metrics.settlingTime)}</td></tr>)}</tbody></table></div>}{results.length === 0 && <p className="hint">点击后才会展示本次真实计算结果。</p>}</section>
    <section className="panel"><h2>怎样复现一份实验</h2><ol><li>在工作台导出 JSON 实验包。</li><li>通过“我的实验”导入，创建一份独立记录。</li><li>在运行历史中选择“复算核对”。</li><li>查看指标差异、曲线最大误差和公开容差。</li></ol><p className="hint">CSV 用于曲线分析，HTML 用于阅读实验小结；完整复算使用 JSON 包。实验包不包含 API 密钥。</p></section>
    <section className="panel"><h2>首版能力边界</h2><ul><li>连续、单输入单输出、严格稳定、正稳态增益的 1—3 阶教学对象。</li><li>对象分子阶数低于分母阶数；支持 P、PI 与测量微分滤波 PID。</li><li>目标阶跃、输入端持续或有限时长扰动、初始状态。</li><li>暂不支持纯滞后、离散对象、多变量对象与真实硬件接入。</li><li>控制峰值是评价约束，计算不会通过裁剪输出伪造达标。</li></ul></section>
    <section className="panel"><h2>结果和 AI 的责任划分</h2><p>仿真、参数搜索和指标判定由计算引擎完成。AI 可以提出候选并调用验证工具；未经实际计算的模型文字不能成为数值证据。</p><p>有限搜索未找到方案，不代表数学上不存在可行解。用户试用与学习效果需要另行开展真实评测，这个页面不宣称已经验证。</p><p className="hint">AI 每次最多验证 3 套候选；可在工作台查看每次工具调用。</p></section>
    <section className="panel full-width"><h2>源码、说明与第三方组件</h2><p>源码包中的 README、docs/COMPUTATION.md、docs/AI_AND_DATA.md 说明运行方式、指标定义和接口边界。第三方依赖与许可随源码交付；开源仓库发布地址将在实际发布后补充。</p><div className="source-map"><span>src/app · 入口与模块注册</span><span>src/ui · 交互与可替换样式</span><span>src/core · 计算与案例</span><span>desktop/services · API 与本机数据</span></div><p className="path-text">本机数据：{dataPath}</p><Button onClick={() => api.openDataDirectory().catch(error => inform(error.message, 'error'))}>打开实验数据目录</Button></section>
  </div></main>;
}

export default function ControlLab({ api, bootstrap, settings, onSettings, active = true, requests = [], onRequestComplete, onContext, onRegisterLeave }) {
  const [page, setPage] = useState('library');
  const [experiments, setExperiments] = useState(bootstrap.experiments || []);
  const [importing, setImporting] = useState(false);
  const onSaved = useCallback(saved => setExperiments(values => [saved, ...values.filter(item => item.id !== saved.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))), []);
  const lab = useExperiment(api, onSaved);
  const previousActive = useRef(active);
  const routeQueue = useRef([]);
  const queuedRoutes = useRef(new Set());
  const drainingRoutes = useRef(false);
  const routeState = useRef(null);
  routeState.current = { lab, api, onRequestComplete };
  useEffect(() => {
    onRegisterLeave?.(() => lab.flushSave());
    return () => onRegisterLeave?.(null);
  }, [lab.flushSave, onRegisterLeave]);
  useEffect(() => {
    onContext?.({
      experimentCount: experiments.length + (lab.experiment && !experiments.some(item => item.id === lab.experiment.id) ? 1 : 0),
      currentExperimentTitle: lab.experiment?.title || '',
      currentExperimentId: lab.experiment?.id || null,
    });
  }, [experiments, lab.experiment?.id, lab.experiment?.title, onContext]);
  useEffect(() => {
    for (const request of requests) {
      if (!request?.nonce || queuedRoutes.current.has(request.nonce)) continue;
      queuedRoutes.current.add(request.nonce);
      routeQueue.current.push(request);
    }
    if (drainingRoutes.current || !routeQueue.current.length) return;
    drainingRoutes.current = true;
    async function drain() {
      try {
        while (routeQueue.current.length) {
          const request = routeQueue.current.shift();
          const { lab: currentLab, api: currentApi } = routeState.current;
          try {
            if (request.type === 'start-experiment') {
              if (!CASES.some(item => item.id === request.caseId)) throw new Error('未知的实验入口。');
              await currentLab.startCase(request.caseId);
              setPage('workbench');
            } else if (request.type === 'open-records') {
              await currentLab.flushSave();
              setExperiments(await currentApi.listExperiments());
              setPage('records');
            } else if (request.type === 'open-library') {
              setPage('library');
            } else if (request.type === 'open-verification') {
              setPage('verification');
            } else if (request.type === 'continue-experiment') {
              setPage(currentLab.experimentRef.current ? 'workbench' : 'library');
            }
          } catch (error) {
            currentLab.inform(error.message, 'error');
          } finally {
            routeState.current.onRequestComplete?.(request.nonce);
          }
        }
      } finally {
        drainingRoutes.current = false;
      }
    }
    void drain();
  }, [requests]);
  useEffect(() => {
    if (!api.onBeforeClose || !api.finishClose) return undefined;
    return api.onBeforeClose(async () => {
      try {
        document.activeElement?.blur?.();
        await lab.prepareClose();
        const result = await api.finishClose({ saved: true });
        if (result?.ok === false) lab.resumeTransition();
      } catch (error) {
        lab.inform(error.message, 'error');
        await api.finishClose({ saved: false, error: error.message });
        lab.resumeTransition();
      }
    });
  }, [api, lab.prepareClose, lab.resumeTransition, lab.inform]);
  useEffect(() => {
    if (previousActive.current && !active) lab.flushSave().catch(error => lab.inform(error.message, 'error'));
    previousActive.current = active;
  }, [active, lab.flushSave, lab.inform]);
  async function startCase(id) { try { await lab.startCase(id); setPage('workbench'); } catch (error) { lab.inform(error.message, 'error'); } }
  async function refresh() { try { await lab.flushSave(); setExperiments(await api.listExperiments()); } catch (error) { lab.inform(error.message, 'error'); } }
  async function restore(exp) { try { if (lab.experimentRef.current?.id !== exp.id) await lab.changeExperiment(exp); setPage('workbench'); } catch (error) { lab.inform(error.message, 'error'); } }
  async function duplicate(exp) {
    try {
      const original = lab.experimentRef.current?.id === exp.id ? lab.experimentRef.current : exp;
      const copy = clone(original); const now = new Date().toISOString();
      copy.id = makeId(); copy.title = `${copy.title.slice(0,145)}（副本）`; copy.createdAt = now; copy.updatedAt = now;
      await lab.changeExperiment(copy); await lab.flushSave(); setPage('workbench');
      lab.inform('已创建独立副本，原实验与历史记录保留。');
    } catch (error) { lab.inform(error.message, 'error'); }
  }
  async function importFile() {
    setImporting(true);
    try { await lab.flushSave(); const result = await api.importExperiment(); if (!result.canceled && result.experiment) { onSaved(result.experiment); await lab.changeExperiment(result.experiment); setPage('workbench'); lab.inform('实验包已作为新实验导入。可选择历史运行进行复算核对。'); } }
    catch (error) { lab.inform(error.message, 'error'); }
    finally { setImporting(false); }
  }
  async function remove(exp) {
    if (!window.confirm(`确定删除本机实验“${exp.title}”吗？\n建议先在工作台导出实验包；删除后不能从软件内撤销。`)) return;
    try {
      await lab.removeExperiment(exp.id); setExperiments(values => values.filter(item => item.id !== exp.id)); lab.inform('已删除该本机实验。');
    } catch (error) { lab.inform(error.message, 'error'); }
  }
  function navigate(next) { setPage(next); if (next === 'records') refresh(); }
  return <div className="control-lab"><aside className="module-navigation"><div className="module-label"><strong>控制实验</strong><span>CONTROL LAB</span></div><nav aria-label="实验模块导航">{navItems.map(([id, label, index]) => <button key={id} data-testid={`nav-${id}`} className={page === id ? 'active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => navigate(id)}><span>{index}</span><strong>{label}</strong></button>)}</nav><div className="module-footer"><span className={`save-dot ${lab.saveState.includes('失败') ? 'failed' : ''}`} /><span aria-live="polite">{lab.saveState}</span><p>计算在本机进行<br />AI 由配置的模型提供</p></div></aside><div className="module-content">
    {lab.busy.transition && <div className="notice transition-notice" role="status">正在保存实验，请稍候…</div>}
    {lab.notice && <div className={`notice toast ${lab.notice.type}`} role={lab.notice.type === 'error' ? 'alert' : 'status'}><span>{lab.notice.message}</span><Button aria-label="关闭提示" onClick={lab.clearNotice}>关闭</Button></div>}
    {page === 'library' && <Library startCase={startCase} current={lab.experiment} continueExperiment={() => setPage('workbench')} />}
    {lab.experiment && <Workbench key={lab.experiment.id} lab={lab} api={api} settings={settings} onSettings={onSettings} visible={page === 'workbench'} active={active && page === 'workbench'} />}
    {page === 'workbench' && !lab.experiment && <Empty title="先选择一个实验" action={<Button kind="primary" onClick={() => setPage('library')}>前往实验库</Button>}>从 3 个引导实验开始，或直接挑战独立调参。</Empty>}
    {page === 'records' && <Records experiments={experiments} currentId={lab.experiment?.id} restore={restore} duplicate={duplicate} remove={remove} importFile={importFile} refresh={refresh} busy={importing} />}
    {page === 'verification' && <Verification api={api} dataPath={bootstrap.dataPath} inform={lab.inform} />}
  </div></div>;
}

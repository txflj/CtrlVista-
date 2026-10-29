import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, TextField } from '../components.jsx';
import { clone, dateText } from './model.js';
import './ai-assistant.css';

export default function AiAssistant({ lab, api, settings, onSettings, onOpenCandidates, active = true }) {
  const { experiment: exp, busy, askAi, editConfig, inform, experimentRef } = lab;
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('请结合当前实验，解释各项指标，验证改进建议，并说明代价。');
  const [natural, setNatural] = useState('');
  const [proposal, setProposal] = useState(null);
  const [interpreting, setInterpreting] = useState(false);
  const launcherRef = useRef(null);
  const questionRef = useRef(null);
  const wasOpen = useRef(false);
  const restoreFocus = useRef(true);
  const alive = useRef(true);
  const interpretation = useRef(0);
  const aiCandidates = exp.candidates.filter(candidate => candidate.source === 'ai');
  const stateText = busy.ai ? '正在验证' : interpreting ? '正在解析' : settings.hasKey ? '可以提问' : '待配置模型';

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; interpretation.current++; };
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    if (open) {
      wasOpen.current = true;
      if (!document.querySelector('[role="dialog"][aria-modal="true"]')) questionRef.current?.focus({ preventScroll: true });
    } else if (wasOpen.current && restoreFocus.current) {
      launcherRef.current?.focus({ preventScroll: true });
    }
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      // The model settings modal owns Escape while it is open above this window.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      restoreFocus.current = true;
      setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, active]);

  function close() {
    restoreFocus.current = true;
    setOpen(false);
  }

  function openCandidates() {
    restoreFocus.current = false;
    setOpen(false);
    onOpenCandidates?.();
  }

  async function interpret() {
    if (!natural.trim() || interpreting) return;
    const snapshot = clone(experimentRef.current);
    const request = ++interpretation.current;
    setInterpreting(true);
    setProposal(null);
    try {
      const result = await api.interpretGoal({ text: natural.trim(), config: snapshot.config });
      if (alive.current && request === interpretation.current && experimentRef.current?.id === snapshot.id) {
        setProposal({ ...result, basedOnVersion: snapshot.version, experimentId: snapshot.id });
      }
    } catch (error) {
      if (alive.current && request === interpretation.current) inform(error.message, 'error');
    } finally {
      if (alive.current && request === interpretation.current) setInterpreting(false);
    }
  }

  function applyProposal() {
    if (proposal.experimentId !== exp.id || proposal.basedOnVersion !== exp.version) {
      inform('解析后实验条件已改变，请重新解析再确认。', 'warning');
      return;
    }
    if (editConfig(proposal.patch) === false) return;
    setProposal(null);
    inform('已应用你确认的配置提案，请查看参数与重新计算的结果。');
  }

  return createPortal(<>
    <button
      ref={launcherRef}
      type="button"
      className="ai-launcher"
      aria-label="AI 助手"
      aria-expanded={open}
      aria-controls="ai-assistant-drawer"
      data-testid="ai-assistant-launcher"
      hidden={open || !active}
      onClick={() => { restoreFocus.current = true; setOpen(true); }}
    >
      <span className="ai-launcher-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M3 13h4l2-6 4 12 2-8h6" /></svg>
      </span>
      <span>AI 助手</span>
      {(busy.ai || interpreting) && <span className="ai-launcher-state">处理中</span>}
    </button>

    <section
      id="ai-assistant-drawer"
      className="ai-drawer"
      role="dialog"
      aria-modal="false"
      aria-labelledby="ai-assistant-title"
      data-testid="ai-assistant-drawer"
      hidden={!open || !active}
    >
      <header className="ai-drawer-header">
        <div><p className="eyebrow">计算验证 · 解释结果</p><h2 id="ai-assistant-title">AI 实验助手</h2></div>
        <Button onClick={close} aria-label="关闭 AI 实验助手">关闭</Button>
      </header>
      <div className="ai-drawer-context">
        <span title={exp.title}>{exp.title || '未命名实验'}</span>
        <span className="ai-context-version">配置 v{exp.version}</span>
        <span className={`ai-connection-state ${busy.ai || interpreting ? 'working' : ''}`} role="status">{stateText}</span>
      </div>

      <div className="ai-drawer-body">
        {!settings.hasKey && <div className="callout ai-setup-callout">
          <p>还没有配置 API 密钥。手动实验与自动整定可继续使用。</p>
          <Button onClick={onSettings}>配置 DeepSeek 或其他模型</Button>
        </div>}
        <TextField label="描述你观察到的问题">
          <textarea ref={questionRef} rows={4} value={question} onChange={event => setQuestion(event.target.value)} maxLength={8000} />
        </TextField>
        <div className="ai-request-actions">
          <Button kind="primary" disabled={!settings.hasKey || busy.ai || !question.trim()} onClick={() => askAi(question)}>
            {busy.ai ? 'AI 正在调用计算工具…' : '提出并验证建议'}
          </Button>
          <span className="hint">每次至多验证 3 套候选，选择应用后才会修改参数。</span>
        </div>

        <details className="ai-natural-settings">
          <summary>用自然语言提出模型或目标设置</summary>
          <p className="hint">先生成可检查的配置提案。缺少信息时补充说明，确认后才修改实验。</p>
          <TextField label="你想设置什么"><textarea rows={3} value={natural} onChange={event => setNatural(event.target.value)} placeholder="例如：目标值设为 2，超调不超过 5%，仿真 20 秒。" /></TextField>
          <Button disabled={!settings.hasKey || interpreting || !natural.trim()} onClick={interpret}>{interpreting ? '正在解析…' : '解析为配置提案'}</Button>
          {proposal && <div className="proposal">
            <p>{proposal.explanation}</p>
            {proposal.missing?.length > 0 && <div className="callout warning"><strong>需要补充</strong><ul>{proposal.missing.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
            <pre>{JSON.stringify(proposal.patch, null, 2)}</pre>
            <div className="action-row">
              <Button kind="primary" disabled={Boolean(proposal.missing?.length) || proposal.basedOnVersion !== exp.version || proposal.experimentId !== exp.id} onClick={applyProposal}>确认这些设置并应用</Button>
              <Button onClick={() => setProposal(null)}>放弃提案</Button>
            </div>
            {proposal.basedOnVersion !== exp.version && <p className="warning-text">实验已修改，需要重新解析。</p>}
          </div>}
        </details>

        {exp.aiSessions.length > 0 && <div className="ai-drawer-history">
          <div className="ai-history-heading"><h3>本次实验的问答</h3><span>{exp.aiSessions.length} 次</span></div>
          {exp.aiSessions.slice().reverse().map(session => <article className="ai-session" key={session.id}>
            <div className="section-heading"><strong>{session.question}</strong><span className="muted">配置 v{session.basedOnVersion}</span></div>
            <p className="preserve-lines">{session.summary}</p>
            <p className="hint">AI 解释供参考，数值以候选的实际计算结果为准。</p>
            <p className="hint">{session.model} · {dateText(session.createdAt)} · 实际记录 {session.toolLog?.length || 0} 次工具事件</p>
            <details><summary>查看工具调用与验证证据</summary><pre>{JSON.stringify(session.toolLog || [], null, 2)}</pre></details>
          </article>)}
        </div>}
      </div>

      <footer className="ai-drawer-footer">
        <span className="hint" title={settings.model}>{settings.model}{aiCandidates.length > 0 && <span> · {aiCandidates.length} 个 AI 候选</span>}</span>
        <Button onClick={openCandidates}>前往方案对比</Button>
      </footer>
    </section>
  </>, document.body);
}

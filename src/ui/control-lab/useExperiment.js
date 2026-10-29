import { useCallback, useEffect, useRef, useState } from 'react';
import { clone, createExperiment, experimentSize, makeId, mergeConfig } from './model.js';
import { conditionKey, validateConfig } from '../../core/index.mjs';
import { comparisonAfterRun, initializeComparison } from './comparison.js';

const LIMIT = 200;
const capacityMessage = '本实验记录已接近 200 条容量上限。请导出实验包，然后新建实验继续；历史记录不会被截断。';

export default function useExperiment(api, onSaved) {
  const [experiment, setExperiment] = useState(null);
  const experimentRef = useRef(null);
  const [saveState, setSaveState] = useState('未开始实验');
  const [busy, setBusy] = useState({});
  const [notice, setNotice] = useState(null);
  const [autoRun, setAutoRun] = useState(true);
  const [reproduction, setReproduction] = useState(null);
  const saveTimer = useRef(null);
  const saveChain = useRef(Promise.resolve());
  const runTimer = useRef(null);
  const latestRunRequest = useRef(0);
  const pendingManual = useRef(null);
  const transition = useRef(false);
  const sealed = useRef(false);
  const requestEpoch = useRef(0);
  const deletedIds = useRef(new Set());
  const saveEpochs = useRef(new Map());
  const [transitionRevision, setTransitionRevision] = useState(0);
  const onSavedRef = useRef(onSaved);
  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);
  const inform = useCallback((message, type = 'info') => setNotice({ message, type, id: Date.now() }), []);
  const commit = useCallback((updater, { existing = false } = {}) => {
    const previous = experimentRef.current;
    const next = typeof updater === 'function' ? updater(previous) : updater;
    if (next === previous || (sealed.current && !existing)) return previous;
    if (next) next.updatedAt = new Date().toISOString();
    if (next && !existing) {
      const size = experimentSize(next);
      if (size.nodes > 1400000 || size.bytes > 28 * 1024 * 1024) {
        setAutoRun(false);
        inform('本次新增内容超过单份实验的存储容量，未加入记录。原实验仍可保存，请导出后新建实验继续。', 'warning');
        return previous;
      }
    }
    experimentRef.current = next;
    setExperiment(next);
    return next;
  }, [inform]);
  const enqueueSave = useCallback(snapshot => {
    if (!snapshot) return Promise.resolve(null);
    setSaveState('正在保存');
    const copy = clone(snapshot);
    const epoch = saveEpochs.current.get(copy.id) || 0;
    const promise = saveChain.current.catch(() => {}).then(() => {
      if (deletedIds.current.has(copy.id) || (saveEpochs.current.get(copy.id) || 0) !== epoch) return null;
      return api.saveExperiment(copy);
    });
    saveChain.current = promise;
    promise.then(saved => {
      if (!saved || deletedIds.current.has(copy.id) || (saveEpochs.current.get(copy.id) || 0) !== epoch) return;
      if (experimentRef.current?.id === copy.id && experimentRef.current.updatedAt === copy.updatedAt) setSaveState('已保存到本机');
      onSavedRef.current?.(saved);
    }).catch(error => { setSaveState('保存失败'); inform(error.message, 'error'); });
    return promise;
  }, [api, inform]);
  const flushSave = useCallback(async ({ seal = false } = {}) => {
    for (;;) {
      clearTimeout(saveTimer.current);
      const snapshot = experimentRef.current;
      const saved = await enqueueSave(snapshot);
      const chain = saveChain.current;
      await chain;
      if (snapshot === experimentRef.current && chain === saveChain.current) {
        if (seal) sealed.current = true;
        return saved;
      }
    }
  }, [enqueueSave]);
  const beginTransition = useCallback(() => {
    if (transition.current) throw new Error('正在保存并切换实验，请稍候。');
    transition.current = true; sealed.current = false;
    clearTimeout(saveTimer.current); clearTimeout(runTimer.current);
    setBusy(value => ({ ...value, transition: true }));
  }, []);
  const resumeTransition = useCallback(() => {
    transition.current = false; sealed.current = false;
    setBusy(value => ({ ...value, transition: false }));
    setTransitionRevision(value => value + 1);
  }, []);
  const prepareClose = useCallback(async () => {
    beginTransition();
    try { await flushSave({ seal: true }); requestEpoch.current++; }
    catch (error) { resumeTransition(); throw error; }
  }, [beginTransition, flushSave, resumeTransition]);
  useEffect(() => {
    clearTimeout(saveTimer.current);
    if (experiment && !transition.current) {
      setSaveState('有未保存修改');
      saveTimer.current = setTimeout(() => { enqueueSave(experiment).catch(() => {}); }, 550);
    }
    return () => clearTimeout(saveTimer.current);
  }, [experiment, enqueueSave, transitionRevision]);
  async function changeExperiment(next) {
    beginTransition();
    try {
      await flushSave({ seal: true });
      requestEpoch.current++; latestRunRequest.current++;
      setBusy(value => ({ ...value, simulation: false }));
      setReproduction(null);
      commit(initializeComparison(clone(next)), { existing: true });
    } finally { resumeTransition(); }
  }
  async function startCase(id) { await changeExperiment(createExperiment(id)); }
  const editConfig = useCallback(patch => {
    const current = experimentRef.current;
    if (!current) return;
    if (transition.current) { inform('正在保存并切换实验，参数暂未修改。', 'warning'); return false; }
    const config = mergeConfig(current.config, patch);
    const validation = validateConfig(config);
    if (!validation.valid) { inform(`未应用无效配置：${validation.errors.join('；')}`, 'error'); return false; }
    return commit(previous => previous ? { ...previous, version: previous.version + 1, config } : previous) !== current;
  }, [commit, inform]);
  const editMeta = useCallback(patch => {
    if (transition.current) return false;
    return commit(previous => previous ? { ...previous, ...patch } : previous);
  }, [commit]);
  const run = useCallback(async ({ automatic = false } = {}) => {
    const snapshot = experimentRef.current;
    if (!snapshot || transition.current) return;
    if (automatic && (snapshot.runs.some(item => item.configVersion === snapshot.version)
      || (pendingManual.current?.experimentId === snapshot.id && pendingManual.current?.version === snapshot.version))) return;
    if (!automatic) clearTimeout(runTimer.current);
    const epoch = requestEpoch.current;
    if (snapshot.runs.length >= LIMIT) { setAutoRun(false); inform(capacityMessage, 'warning'); return; }
    const sequence = ++latestRunRequest.current;
    if (!automatic) pendingManual.current = { experimentId: snapshot.id, version: snapshot.version, sequence };
    setBusy(value => ({ ...value, simulation: true }));
    try {
      const result = await api.simulate(clone(snapshot.config), { configVersion: snapshot.version });
      if (epoch !== requestEpoch.current || sealed.current) return result;
      commit(current => {
        if (!current || current.id !== snapshot.id) return current;
        if (current.runs.length >= LIMIT) { inform(capacityMessage, 'warning'); return current; }
        const currentResult = current.version === snapshot.version && sequence === latestRunRequest.current;
        const comparison = currentResult ? comparisonAfterRun(current, result, { automatic }) : {};
        return { ...current, ...comparison, runs: [...current.runs, result], activeRunId: currentResult ? result.id : current.activeRunId };
      });
      if (!automatic && experimentRef.current?.runs.some(item => item.id === result.id)) inform(result.status === 'completed' ? '仿真完成，结果已加入实验记录。' : result.reason || '本次仿真未成功完成。', result.status === 'completed' ? 'info' : 'warning');
      return result;
    } catch (error) { if (!automatic || sequence === latestRunRequest.current) inform(error.message, 'error'); }
    finally {
      if (pendingManual.current?.sequence === sequence) pendingManual.current = null;
      if (sequence === latestRunRequest.current) setBusy(value => ({ ...value, simulation: false }));
    }
  }, [api, commit, inform]);
  useEffect(() => {
    clearTimeout(runTimer.current);
    if (!transition.current && autoRun && experiment && !experiment.runs.some(result => result.configVersion === experiment.version)) runTimer.current = setTimeout(() => { run({ automatic: true }); }, 450);
    return () => clearTimeout(runTimer.current);
    // Only configuration changes trigger automatic runs, not notes or returned results.
  }, [experiment?.id, experiment?.version, autoRun, run, transitionRevision]);
  async function tune(budget, seed) {
    const snapshot = experimentRef.current;
    if (!snapshot || busy.tune || transition.current) return;
    const epoch = requestEpoch.current;
    if (snapshot.candidates.length > LIMIT - 3) { inform(capacityMessage, 'warning'); return; }
    setBusy(value => ({ ...value, tune: true }));
    try {
      const result = await api.autotune(clone(snapshot.config), { budget, seed, configVersion: snapshot.version });
      if (epoch !== requestEpoch.current || sealed.current) return result;
      const candidates = (result.candidates || []).map((candidate, index) => ({ ...candidate, id: makeId(), source: 'autotune', label: `自动整定 ${index + 1}`, basedOnVersion: snapshot.version }));
      if (experimentRef.current?.id === snapshot.id && experimentRef.current.candidates.length + candidates.length > LIMIT) throw new Error(capacityMessage);
      commit(current => current?.id === snapshot.id ? { ...current, candidates: [...current.candidates, ...candidates] } : current);
      if (experimentRef.current?.id === snapshot.id && (!candidates.length || experimentRef.current.candidates.some(item => item.id === candidates[0].id))) inform(`${result.summary || '自动整定完成'}（实际评估 ${result.evaluated ?? 0} 套参数）`);
      return result;
    } catch (error) { inform(error.message, 'error'); }
    finally { setBusy(value => ({ ...value, tune: false })); }
  }
  async function askAi(question) {
    const snapshot = experimentRef.current;
    if (!snapshot || !question.trim() || busy.ai || transition.current) return;
    const epoch = requestEpoch.current;
    if (snapshot.candidates.length > LIMIT - 3 || snapshot.aiSessions.length >= LIMIT) { inform(capacityMessage, 'warning'); return; }
    setBusy(value => ({ ...value, ai: true }));
    try {
      const history = snapshot.aiSessions.slice(-2).flatMap(session => [{ role: 'user', content: session.question }, { role: 'assistant', content: session.summary }]);
      history.push({ role: 'user', content: `以下为本软件保存的实验过程，用于理解问题；不同评价条件的记录不可直接比较：${JSON.stringify({ recentRuns: snapshot.runs.slice(-3).map(result => ({ configVersion: result.configVersion, sameConditions: result.conditionKey === conditionKey(snapshot.config), controller: result.config.controller, status: result.status, verdict: result.verdict, metrics: result.metrics })), notes: snapshot.notes.slice(-800), reflection: snapshot.reflection.slice(-500) })}` });
      const session = await api.requestAi({ experimentId: snapshot.id, configVersion: snapshot.version, config: clone(snapshot.config), question: question.trim(), history });
      if (epoch !== requestEpoch.current || sealed.current) return session;
      const candidates = (session.candidates || []).map((candidate, index) => ({ ...candidate, id: candidate.id || makeId(), source: 'ai', label: `AI 候选 ${index + 1}`, basedOnVersion: session.basedOnVersion ?? snapshot.version }));
      if (experimentRef.current?.id === snapshot.id && (experimentRef.current.candidates.length + candidates.length > LIMIT || experimentRef.current.aiSessions.length >= LIMIT)) throw new Error(capacityMessage);
      commit(current => current?.id === snapshot.id ? { ...current, candidates: [...current.candidates, ...candidates], aiSessions: [...current.aiSessions, session] } : current);
      if (experimentRef.current?.aiSessions.some(item => item.id === session.id)) inform('AI 请求结束。候选保留在比较区，当前控制器没有改变。');
      return session;
    } catch (error) { inform(error.message, 'error'); }
    finally { setBusy(value => ({ ...value, ai: false })); }
  }
  async function applyCandidate(candidate) {
    const snapshot = experimentRef.current;
    if (!snapshot || busy.apply || transition.current) return;
    const epoch = requestEpoch.current;
    if (snapshot.runs.length >= LIMIT) { inform(capacityMessage, 'warning'); return; }
    setBusy(value => ({ ...value, apply: true }));
    try {
      const config = mergeConfig(snapshot.config, { controller: candidate.controller });
      const result = await api.simulate(config, { configVersion: snapshot.version + 1 });
      if (epoch !== requestEpoch.current || transition.current) return;
      const current = experimentRef.current;
      if (current?.id !== snapshot.id || current.version !== snapshot.version) throw new Error('验证期间实验条件发生变化，请按当前条件重新应用。');
      if (current.runs.length >= LIMIT) throw new Error(capacityMessage);
      if (result.status !== 'completed') throw new Error(result.reason || '候选在当前条件下无法有效计算，未应用。');
      if (result.verdict !== 'pass' && !window.confirm(`此方案${result.verdict === 'fail' ? '尚未达标' : '有无法判定的指标'}。\n${result.reason || ''}\n是否作为探索方案应用？`)) return;
      commit(value => ({ ...value, version: snapshot.version + 1, config, runs: [...value.runs, result], activeRunId: result.id }));
      if (experimentRef.current?.activeRunId === result.id) inform('候选已按当前条件重新验证并应用，历史方案保持不变。');
    } catch (error) { inform(error.message, 'error'); }
    finally { setBusy(value => ({ ...value, apply: false })); }
  }
  async function reproduce(selectedRun) {
    const experimentId = experimentRef.current?.id;
    setBusy(value => ({ ...value, reproduce: true }));
    try { const result = await api.reproduceRun(selectedRun); if (experimentRef.current?.id === experimentId) { setReproduction(result); inform(result.comparison?.summary || '复算已完成。', result.comparison?.pass ? 'info' : 'warning'); } }
    catch (error) { inform(error.message, 'error'); }
    finally { setBusy(value => ({ ...value, reproduce: false })); }
  }
  async function exportAs(format) {
    const requestedId = experimentRef.current?.id;
    if (!requestedId) return;
    try {
      const saved = await flushSave();
      if (!saved || saved.id !== requestedId || experimentRef.current?.id !== requestedId) throw new Error('保存期间切换了实验，请在目标实验中重新导出。');
      const result = await api.exportExperiment(clone(saved), format);
      if (!result.canceled) inform(`已导出：${result.path}`);
    }
    catch (error) { inform(error.message, 'error'); }
  }
  function addPrediction(text) {
    if (!text.trim() || transition.current) return false;
    if (experimentRef.current.predictions.length >= LIMIT) { inform(capacityMessage, 'warning'); return; }
    const before = experimentRef.current;
    const after = commit(current => ({ ...current, predictions: [...current.predictions, { id: makeId(), createdAt: new Date().toISOString(), configVersion: current.version, text: text.trim(), observation: '' }] }));
    if (after !== before) inform('预测已保存。实验后的观察可另行填写，不会覆盖原预测。');
    return after !== before;
  }
  function discard() { clearTimeout(saveTimer.current); clearTimeout(runTimer.current); latestRunRequest.current++; requestEpoch.current++; setBusy(value => ({ ...value, simulation: false })); commit(null, { existing: true }); setSaveState('未开始实验'); }
  async function removeExperiment(id) {
    beginTransition();
    let previous = null;
    try {
      await flushSave({ seal: true });
      previous = experimentRef.current?.id === id ? experimentRef.current : null;
      deletedIds.current.add(id);
      saveEpochs.current.set(id, (saveEpochs.current.get(id) || 0) + 1);
      if (previous) discard();
      await saveChain.current.catch(() => {});
      await api.deleteExperiment(id);
    } catch (error) {
      deletedIds.current.delete(id);
      if (previous && !experimentRef.current) commit(previous, { existing: true });
      throw error;
    } finally { resumeTransition(); }
  }
  return { experiment, experimentRef, commit, changeExperiment, startCase, editConfig, editMeta, saveState, flushSave, prepareClose, resumeTransition, removeExperiment, discard, busy, notice, inform, clearNotice: () => setNotice(null), autoRun, setAutoRun, run, tune, askAi, applyCandidate, reproduce, reproduction, exportAs, addPrediction };
}

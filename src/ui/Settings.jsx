import React, { useState } from 'react';
import { Button, Modal, NumberField, TextField } from './components.jsx';
import { AUDIO_STATUS_LABELS } from '../audio/preferences.mjs';
import './audio-settings.css';

const deepseekPreset = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', timeoutMs: 90000 };

export default function Settings({ api, settings = {}, dataPath, onSaved, onClose, colorTheme, onColorTheme, themeSaved = true, audio }) {
  const [draft, setDraft] = useState({ ...deepseekPreset, ...settings });
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  async function save(test = false) {
    setBusy(true); setMessage(null);
    try {
      const result = await api.saveSettings({ provider: draft.provider, baseUrl: draft.baseUrl.trim(), model: draft.model.trim(), timeoutMs: draft.timeoutMs, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), clearKey });
      onSaved(result); setDraft(value => ({ ...value, ...result })); setApiKey(''); setClearKey(false);
      if (test) {
        const connection = await api.testConnection();
        setMessage({ type: connection.ok ? 'info' : 'error', text: connection.message || (connection.ok ? '模型服务连接成功。' : '连接失败。') });
      } else setMessage({ type: 'info', text: '设置已保存。密钥不会进入实验包或运行报告。' });
    } catch (error) { setMessage({ type: 'error', text: error.message }); }
    finally { setBusy(false); }
  }
  async function openData() { try { await api.openDataDirectory(); } catch (error) { setMessage({ type: 'error', text: error.message }); } }
  return <Modal title="模型与本机设置" onClose={onClose}>
    <section className="appearance-settings" aria-label="外观设置">
      <div><h3>界面配色</h3><p className="hint">主页、实验库与工作台同步切换，立即保存。</p></div>
      <div className="segmented" role="group" aria-label="界面配色">
        <Button className={colorTheme === 'light' ? 'selected' : ''} aria-pressed={colorTheme === 'light'} onClick={() => onColorTheme('light')}>亮色</Button>
        <Button className={colorTheme === 'dark' ? 'selected' : ''} aria-pressed={colorTheme === 'dark'} onClick={() => onColorTheme('dark')}>暗色</Button>
      </div>
    </section>
    {!themeSaved && <p className="warning-text" role="status">配色已应用，但本机存储暂时不可写，重启后可能无法保留。</p>}
    {audio && <section className="audio-settings" aria-label="声音设置" data-audio-control>
      <div className="audio-settings-heading"><div><h3>声音</h3><p className="hint">主页与实验台共用配乐，切换页面继续循环播放。修改立即保存。</p></div><Button aria-pressed={audio.preferences.enabled} onClick={() => audio.configure({ enabled: !audio.preferences.enabled })} data-testid="audio-master">{audio.preferences.enabled ? '关闭全部声音' : '开启声音'}</Button></div>
      <div className="audio-setting-grid">
        <label className="check"><input type="checkbox" aria-label="交互音效" checked={audio.preferences.sound} onChange={event => audio.configure({ sound: event.target.checked })} />交互音效</label>
        <label className="audio-volume"><span>音效音量</span><input aria-label="音效音量" type="range" min="0" max="100" step="1" value={Math.round(audio.preferences.soundVolume * 100)} onChange={event => audio.configure({ soundVolume: Number(event.target.value) / 100 })} /><output>{Math.round(audio.preferences.soundVolume * 100)}%</output></label>
        <label className="check"><input type="checkbox" aria-label="背景配乐" checked={audio.preferences.music} onChange={event => audio.configure({ music: event.target.checked })} />背景配乐 · 观测室</label>
        <label className="audio-volume"><span>配乐音量</span><input aria-label="配乐音量" type="range" min="0" max="100" step="1" value={Math.round(audio.preferences.musicVolume * 100)} onChange={event => audio.configure({ musicVolume: Number(event.target.value) / 100 })} /><output>{Math.round(audio.preferences.musicVolume * 100)}%</output></label>
        <label className="check"><input type="checkbox" aria-label="文字解析音效" checked={audio.preferences.typing} onChange={event => audio.configure({ typing: event.target.checked })} />文字解析音效</label><p className="hint">仅用于主页文字揭示，轻声合成，可单独关闭。</p>
      </div>
      <p className="hint" role="status">{AUDIO_STATUS_LABELS[audio.status] || AUDIO_STATUS_LABELS.idle}{!audio.preferences.enabled ? '，各项偏好仍会保留。' : '。'}</p>
      {!audio.saved && <p className="warning-text" role="status">声音设置已应用，但本机存储暂时不可写，重启后可能无法保留。</p>}
    </section>}
    <p className="muted">仿真与自动整定在本机执行。只有主动请求 AI 或测试连接时，才会调用配置的模型服务。</p>
    <div className="section-toolbar"><label className="field grow"><span>服务类型</span><select value={draft.provider} onChange={event => setDraft(value => ({ ...value, provider: event.target.value }))}><option value="deepseek">DeepSeek</option><option value="custom">其他 OpenAI 兼容服务</option></select></label><Button onClick={() => setDraft(value => ({ ...value, ...deepseekPreset }))}>使用 DeepSeek 预设</Button></div>
    <TextField label="服务地址" value={draft.baseUrl} onChange={event => setDraft(value => ({ ...value, baseUrl: event.target.value }))} placeholder="https://api.deepseek.com" hint="填写服务基础地址；软件通过兼容接口发送请求。" />
    <TextField label="模型名称" value={draft.model} onChange={event => setDraft(value => ({ ...value, model: event.target.value }))} list="model-presets" />
    <datalist id="model-presets"><option value="deepseek-flash" /><option value="deepseek-v4-pro" /></datalist>
    <TextField label={`API 密钥${draft.hasKey ? '（已保存，留空保持原值）' : '（尚未配置）'}`} type="password" autoComplete="off" spellCheck="false" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="在此填写，不会回显已保存密钥" />
    <label className="check"><input type="checkbox" checked={clearKey} onChange={event => setClearKey(event.target.checked)} />清除已保存密钥</label>
    <NumberField label="请求超时" suffix="秒" value={draft.timeoutMs / 1000} min={5} max={180} onChange={number => setDraft(value => ({ ...value, timeoutMs: number * 1000 }))} />
    {message && <div className={`notice ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</div>}
    <div className="modal-actions"><Button kind="primary" onClick={() => save(false)} disabled={busy}>{busy ? '处理中…' : '保存设置'}</Button><Button onClick={() => save(true)} disabled={busy}>保存并测试连接</Button></div>
    <hr /><h3>实验存储位置</h3><p className="path-text">{dataPath}</p><Button onClick={openData}>打开本机数据目录</Button>
    <p className="small muted">没有密钥、断网或模型不可用时，手动实验、自动整定、保存与计算复现仍可使用。</p>
  </Modal>;
}

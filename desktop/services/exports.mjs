import { assertExperiment, inspectJson, isPlain, stripSecrets, MAX_PACKAGE_BYTES } from './validation.mjs';
export { MAX_PACKAGE_BYTES };

export function validateExperimentPackage(obj) {
  try {
    inspectJson(obj);
    if (!isPlain(obj) || obj.format !== 'kongxiaozhu-experiment' || obj.schemaVersion !== 1) throw new Error('不是受支持的控小助实验包。');
    assertExperiment(obj.experiment);
    return { valid: true, errors: [] };
  } catch(error) { return { valid: false, errors: [error.message] }; }
}

export function createExperimentPackage(experiment) {
  assertExperiment(experiment);
  return { format: 'kongxiaozhu-experiment', schemaVersion: 1, exportedAt: new Date().toISOString(), experiment: stripSecrets(experiment) };
}

function csvCell(value) {
  let str = value == null ? '' : String(value);
  // Excel must not interpret user-controlled strings as formulas.
  if (/^[=+@\-\t\r]/.test(str) && typeof value !== 'number') str = `'${str}`;
  return /[",\n\r]/.test(str) ? `"${str.replaceAll('"', '""')}"` : str;
}
export function exportCsv(experiment) {
  const clean = createExperimentPackage(experiment).experiment;
  const rows = [['experiment_id','run_id','config_version','status','verdict','time_s','reference','output','error','control','disturbance']];
  for(const run of clean.runs) for(let i=0;i<run.curves.t.length;i++) rows.push([clean.id,run.id,run.configVersion,run.status,run.verdict,...['t','r','y','e','u','d'].map(k=>run.curves[k][i])]);
  return '\uFEFF' + rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
export function exportHtml(experiment) {
  const exp = createExperimentPackage(experiment).experiment;
  const h=escapeHtml;
  const state={pass:'达标',fail:'未达标',unknown:'无法判定'};
  const runs=exp.runs.map(run=>`<section><h2>运行 ${h(run.id)}</h2><p>配置版本 ${h(run.configVersion)} · ${h(state[run.verdict])} · ${h(run.reason)}</p><table><thead><tr><th>指标</th><th>实际值</th><th>限制</th><th>判定</th></tr></thead><tbody>${run.checks.map(c=>`<tr><td>${h(c.label)}</td><td>${c.value == null?'无法判定':h(c.value)}</td><td>${c.limit == null?'—':h(c.limit)}</td><td>${h(state[c.state] ?? c.state)} ${h(c.message)}</td></tr>`).join('')}</tbody></table><details><summary>模型、参数与评价条件</summary><pre>${h(JSON.stringify(run.config,null,2))}</pre></details></section>`).join('');
  const sessions=exp.aiSessions.map(session=>`<section><h2>AI 建议记录</h2><p>模型：${h(session.model)} · 对应配置版本 ${h(session.basedOnVersion)}</p><p>${h(session.question)}</p><pre>${h(session.summary)}</pre><p>实际候选数量：${h(session.candidates.length)}</p></section>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${h(exp.title)} · 控小助实验小结</title><style>body{font:15px/1.7 system-ui,'Microsoft YaHei',sans-serif;color:#182334;max-width:920px;margin:36px auto;padding:0 22px}h1{font-size:25px}h2{font-size:18px;margin-top:28px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px;border-bottom:1px solid #ccd4df}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f8;padding:15px}section{break-inside:avoid}small{color:#536173}@media print{details{display:block}body{margin:0;max-width:none}}</style></head><body><h1>${h(exp.title)}</h1><p>控小助桌面实验记录 · ${h(exp.caseId)} · ${h(exp.updatedAt)}</p><small>本报告记录教学模型下的计算结果，不代表真实设备实验或已证实的教学效果。</small><h2>预测记录</h2><pre>${h(JSON.stringify(exp.predictions,null,2))}</pre>${runs}${sessions}<h2>个人笔记</h2><pre>${h(exp.notes)}</pre><h2>复盘解释</h2><pre>${h(exp.reflection)}</pre><p>复算请使用对应 JSON 实验包；本报告不包含模型 API 密钥。</p></body></html>`;
}

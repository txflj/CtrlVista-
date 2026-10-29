import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { assertExperiment, assertSafeId, isPlain, normalizeEndpoint, stripSecrets, MAX_PACKAGE_BYTES } from './validation.mjs';
import { validateExperimentPackage } from './exports.mjs';

export const DEFAULT_SETTINGS = Object.freeze({provider:'deepseek',baseUrl:'https://api.deepseek.com',model:'deepseek-flash',timeoutMs:60_000});

export function createStore({dataDir,encrypt,decrypt}) {
  if (!path.isAbsolute(dataDir)) throw new Error('数据目录必须使用绝对路径。');
  const experimentsDir=path.join(dataDir,'experiments');
  const settingsFile=path.join(dataDir,'settings.json');
  let queue=Promise.resolve();
  const deletedIds=new Set();
  function serialize(action) { const next=queue.then(action,action); queue=next.catch(()=>{}); return next; }
  async function init() { await fs.mkdir(experimentsDir,{recursive:true}); return {dataDir}; }
  async function readJson(file,fallback) {
    try { const stat=await fs.stat(file); if(stat.size>MAX_PACKAGE_BYTES)throw new Error('本地数据文件超过允许大小。'); return JSON.parse(await fs.readFile(file,'utf8')); }
    catch(error) { if(error.code==='ENOENT')return fallback; if(error instanceof SyntaxError)throw new Error('本地数据文件损坏，请从实验备份恢复。'); throw error; }
  }
  async function atomicWrite(file,obj) {
    const encoded=JSON.stringify(obj);
    if(Buffer.byteLength(encoded,'utf8')>MAX_PACKAGE_BYTES)throw new Error('本地数据文件超过 32 MB 限制，未覆盖已有数据。');
    const temp=path.join(path.dirname(file),`.${path.basename(file)}.${randomUUID()}.tmp`);
    try { await fs.writeFile(temp,encoded,{encoding:'utf8',flag:'wx'}); await fs.rename(temp,file); }
    finally { await fs.rm(temp,{force:true}).catch(()=>{}); }
  }
  async function getPrivateSettings() {
    const saved=await readJson(settingsFile,{});
    const settings={...DEFAULT_SETTINGS,...saved};
    let apiKey='';
    if(saved.encryptedKey) {
      if(typeof decrypt!=='function')throw new Error('系统安全存储不可用，无法读取模型密钥。');
      try { apiKey=await decrypt(Buffer.from(saved.encryptedKey,'base64')); }
      catch { throw new Error('模型密钥无法解密，请在当前 Windows 用户下重新设置。'); }
    }
    delete settings.encryptedKey;
    return {...settings,apiKey};
  }
  async function getSettings() {
    const saved=await readJson(settingsFile,{});
    return {...DEFAULT_SETTINGS,...Object.fromEntries(Object.keys(DEFAULT_SETTINGS).filter(k=>saved[k]!==undefined).map(k=>[k,saved[k]])),hasKey:typeof saved.encryptedKey==='string'&&saved.encryptedKey.length>0};
  }
  async function saveSettings(input) {
    if(!isPlain(input))throw new Error('模型设置格式无效。');
    return serialize(async()=>{
      await init();
      const old=await readJson(settingsFile,{});
      const merged={...DEFAULT_SETTINGS,...old};
      for(const key of ['provider','baseUrl','model','timeoutMs'])if(input[key]!==undefined)merged[key]=input[key];
      if(typeof merged.provider!=='string'||merged.provider.length>80)throw new Error('服务商名称无效。');
      merged.baseUrl=normalizeEndpoint(merged.baseUrl);
      if(typeof merged.model!=='string'||!merged.model.trim()||merged.model.length>200||/[\r\n]/.test(merged.model))throw new Error('模型名称无效。');
      merged.model=merged.model.trim();
      if(!Number.isFinite(merged.timeoutMs)||merged.timeoutMs<5_000||merged.timeoutMs>180_000)throw new Error('请求超时必须在 5 至 180 秒之间。');
      if(input.clearKey)delete merged.encryptedKey;
      if(input.apiKey!==undefined && input.apiKey!=='') {
        if(typeof input.apiKey!=='string'||!input.apiKey.trim()||input.apiKey.length>4096||/[\r\n]/.test(input.apiKey))throw new Error('模型密钥格式无效。');
        if(typeof encrypt!=='function')throw new Error('系统安全存储不可用，不能保存密钥。');
        let encrypted;
        try { encrypted=await encrypt(input.apiKey.trim()); } catch { throw new Error('系统无法安全保存模型密钥。'); }
        if(!encrypted || (typeof encrypted!=='string'&&!Buffer.isBuffer(encrypted)))throw new Error('系统安全存储未返回有效结果。');
        merged.encryptedKey=Buffer.from(encrypted).toString('base64');
      }
      delete merged.apiKey;delete merged.hasKey;
      await atomicWrite(settingsFile,merged);return getSettings();
    });
  }
  async function listExperiments() {
    await init();
    const entries=await fs.readdir(experimentsDir,{withFileTypes:true});
    const experiments=[];
    for(const entry of entries) {
      if(!entry.isFile()||!entry.name.endsWith('.json'))continue;
      const id=entry.name.slice(0,-5);
      try {assertSafeId(id);const exp=await readJson(path.join(experimentsDir,entry.name));assertExperiment(exp);if(exp.id!==id)throw new Error('实验内容与文件标识不一致。');experiments.push(stripSecrets(exp));}
      catch(error) { throw new Error(`实验文件 ${entry.name} 无法读取：${error.message}`); }
    }
    return experiments.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  }
  async function saveExperiment(experiment) {
    assertExperiment(experiment);const clean=stripSecrets(experiment);
    return serialize(async()=>{
      if(deletedIds.has(clean.id))throw new Error('该实验已删除，已忽略旧的保存请求。请新建实验继续。');
      await init();const file=path.join(experimentsDir,`${clean.id}.json`);const absent=Symbol('absent');const old=await readJson(file,absent);
      if(old!==absent) {
        assertExperiment(old);
        if(clean.version<old.version)throw new Error('该实验已有更新配置，拒绝旧版本覆盖。');
        if(clean.version===old.version&&!isDeepStrictEqual(clean.config,old.config))throw new Error('配置已变化，必须递增版本后保存。');
        const newRuns=new Map(clean.runs.map(run=>[run.id,run]));
        for(const run of old.runs)if(!newRuns.has(run.id)||!isDeepStrictEqual(newRuns.get(run.id),run))throw new Error('已完成运行不可覆盖或删除；请另存为新实验。');
      }
      clean.updatedAt=new Date().toISOString();await atomicWrite(file,clean);return structuredClone(clean);
    });
  }
  async function deleteExperiment(id) {assertSafeId(id);return serialize(async()=>{await fs.rm(path.join(experimentsDir,`${id}.json`),{force:true});deletedIds.add(id);return {ok:true};});}
  async function importExperimentObject(obj) {
    const validation=validateExperimentPackage(obj);if(!validation.valid)throw new Error(validation.errors.join('；'));
    const exp=stripSecrets(obj.experiment);exp.id=randomUUID();exp.title=`${exp.title.slice(0,190)}（导入）`;exp.createdAt=new Date().toISOString();exp.updatedAt=exp.createdAt;
    return saveExperiment(exp);
  }
  return {init,listExperiments,saveExperiment,deleteExperiment,getSettings,saveSettings,getPrivateSettings,importExperimentObject};
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createStore, DEFAULT_SETTINGS } from '../desktop/services/storage.mjs';
import { createExperimentPackage, validateExperimentPackage, exportCsv, exportHtml } from '../desktop/services/exports.mjs';
import { normalizeEndpoint, inspectJson, MAX_PACKAGE_BYTES } from '../desktop/services/validation.mjs';
import { createAiService } from '../desktop/services/ai.mjs';
import { conditionKey } from '../src/core/index.mjs';

function config(){return {
  schemaVersion:1,caseId:'motor',title:'电机调速',plant:{numerator:[1],denominator:[0.5,1],inputUnit:'输入',outputUnit:'转速'},
  controller:{type:'PI',kp:2,ki:1,kd:0,tf:0.05},simulation:{duration:12,dt:0.01,initialState:[],integralInitial:0,filterInitial:0},
  signal:{initial:0,target:1,stepTime:0},disturbance:{enabled:false,time:6,amplitude:0.2,duration:null},
  goals:{overshootMax:10,settlingTimeMax:6,steadyErrorMax:0.02,recoveryTimeMax:6,controlPeakMax:15,absoluteTolerance:0.02,relativeTolerance:0.02,referenceScale:1,holdTime:1},bounds:{kp:[0,30],ki:[0,20],kd:[0,10]}
};}
function run(c=config(),{configVersion=1}={}){return {id:randomUUID(),configVersion,conditionKey:conditionKey(c),config:structuredClone(c),engineVersion:'test-fixture',createdAt:new Date().toISOString(),status:'completed',verdict:'fail',reason:'服务测试固定数据，不是科学计算证据',metrics:{overshoot:12,settlingTime:5,steadyError:0,recoveryTime:null,controlPeak:c.controller.kp,maxDisturbanceDeviation:null},checks:[{key:'overshoot',label:'超调',value:12,limit:10,state:'fail',message:'超过阈值'}],curves:{t:[0,1],r:[1,1],y:[0,1],e:[1,0],u:[2,0],d:[0,0]},poles:[{real:-1,imaginary:0}],warnings:[]};}
function experiment(){const now=new Date().toISOString();const r=run();return {id:randomUUID(),schemaVersion:1,version:1,caseId:'motor',title:'服务测试',mode:'guided',config:config(),runs:[r],candidates:[],aiSessions:[],predictions:[],notes:'',reflection:'',createdAt:now,updatedAt:now,activeRunId:r.id};}
async function fixtureStore(t){
  const root=path.resolve('.test-service-data');await fs.mkdir(root,{recursive:true});const dir=await fs.mkdtemp(path.join(root,'case-'));
  t.after(async()=>{await fs.rm(dir,{recursive:true,force:true});await fs.rmdir(root).catch(()=>{});});
  // This reversible test codec is NOT the production Windows safeStorage implementation.
  const store=createStore({dataDir:dir,encrypt:async value=>Buffer.from(`TEST-CIPHER:${value}`),decrypt:async value=>value.toString().replace(/^TEST-CIPHER:/,'')});
  await store.init();return {store,dir};
}
async function server(t,handler){
  const requests=[];const instance=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;let body;try{body=JSON.parse(raw);}catch{body={};}requests.push({body,url:req.url,authorization:req.headers.authorization});try{await handler(body,res,requests.length);}catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}));}});
  await new Promise(resolve=>instance.listen(0,'127.0.0.1',resolve));t.after(async()=>{instance.closeAllConnections();await new Promise(resolve=>instance.close(resolve));});
  return {baseUrl:`http://127.0.0.1:${instance.address().port}/v1`,requests};
}
function reply(res,message){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]}));}
function tool(id,kp=3,extra={}){return {id,type:'function',function:{name:'validate_candidate',arguments:JSON.stringify({hypothesis:'验证比例作用',controller:{type:'PI',kp,ki:1,kd:0,tf:0.05},...extra})}};}
async function aiFixture(t,handler,{provider='deepseek'}={}){
  const {store,dir}=await fixtureStore(t);const net=await server(t,handler);await store.saveSettings({provider,baseUrl:net.baseUrl,apiKey:'test-key-not-real'});
  const simulated=[];const ai=createAiService({store,simulate:async(c,o)=>{simulated.push(structuredClone(c));return run(c,o);}});
  return {store,dir,...net,simulated,ai};
}
const request=()=>({experimentId:'experiment-test',configVersion:1,config:config(),question:'减少超调，同时解释代价。'});

test('settings: DeepSeek defaults, encrypted-only persistence, blank retention and clearing',async t=>{
  const {store,dir}=await fixtureStore(t);assert.equal(DEFAULT_SETTINGS.model,'deepseek-flash');assert.equal((await store.getSettings()).hasKey,false);
  const settings=await store.saveSettings({apiKey:'sk-test-sensitive'});assert.equal(settings.hasKey,true);assert.equal('apiKey' in settings,false);assert.equal('encryptedKey' in settings,false);
  const raw=await fs.readFile(path.join(dir,'settings.json'),'utf8');assert.equal(raw.includes('sk-test-sensitive'),false);assert.equal((await store.getPrivateSettings()).apiKey,'sk-test-sensitive');
  await store.saveSettings({apiKey:''});assert.equal((await store.getPrivateSettings()).apiKey,'sk-test-sensitive');
  await assert.rejects(()=>store.saveSettings({apiKey:'   '}),/格式无效/);await store.saveSettings({clearKey:true});assert.equal((await store.getSettings()).hasKey,false);
});

test('store: immutable runs, failed imports leave originals, imports get new IDs, path traversal blocked',async t=>{
  const {store,dir}=await fixtureStore(t);const exp=experiment();await store.saveExperiment(exp);
  const broken=structuredClone(exp);broken.runs[0].metrics.overshoot=1;await assert.rejects(()=>store.saveExperiment(broken),/不可覆盖/);
  const pack=createExperimentPackage(exp);pack.experiment.runs[0].curves.y=[];await assert.rejects(()=>store.importExperimentObject(pack),/长度不一致/);
  assert.equal((await store.listExperiments()).length,1);assert.equal((await store.listExperiments())[0].runs[0].metrics.overshoot,12);
  const imported=await store.importExperimentObject(createExperimentPackage(exp));assert.notEqual(imported.id,exp.id);assert.equal((await store.listExperiments()).length,2);
  await assert.rejects(()=>store.deleteExperiment('../settings'),/标识无效/);const malicious=structuredClone(exp);malicious.id='../settings';await assert.rejects(()=>store.saveExperiment(malicious),/标识无效/);
  const leftovers=(await fs.readdir(path.join(dir,'experiments'))).filter(name=>name.endsWith('.tmp'));assert.deepEqual(leftovers,[]);
});

test('exports: secret keys excluded, HTML escaped, CSV includes deterministic samples and safe cells',()=>{
  const exp=experiment();exp.id='-formula';exp.title='<img src=x onerror=alert(1)>';exp.notes='<script>unsafe()</script>';exp.apiKey='do-not-export';exp.config.authorization='do-not-export';
  const pack=createExperimentPackage(exp);assert.equal(JSON.stringify(pack).includes('do-not-export'),false);assert.equal(validateExperimentPackage(pack).valid,true);
  const html=exportHtml(exp);assert.equal(html.includes('<script>unsafe'),false);assert.ok(html.includes('&lt;script&gt;'));assert.equal(html.includes('do-not-export'),false);
  const csv=exportCsv(exp);assert.ok(csv.startsWith('\uFEFFexperiment_id'));assert.ok(csv.includes("'-formula"));assert.equal(csv.split('\r\n').length,3);
});

test('comparison pointers: old packages remain valid, valid pins survive import, invalid references are rejected',async t=>{
  const {store}=await fixtureStore(t);const exp=experiment();
  assert.equal(validateExperimentPackage(createExperimentPackage(exp)).valid,true);
  exp.comparisonRunId=exp.runs[0].id;exp.lastManualRunId=exp.runs[0].id;
  const imported=await store.importExperimentObject(createExperimentPackage(exp));
  assert.equal(imported.comparisonRunId,exp.comparisonRunId);assert.equal(imported.lastManualRunId,exp.lastManualRunId);
  const missing=structuredClone(exp);missing.comparisonRunId='missing-run';
  assert.equal(validateExperimentPackage({...createExperimentPackage(exp),experiment:missing}).valid,false);
  const incomplete=structuredClone(exp);incomplete.runs[0].status='numerical_error';incomplete.runs[0].verdict='unknown';
  assert.equal(validateExperimentPackage({...createExperimentPackage(exp),experiment:incomplete}).valid,false);
});

test('store: changed configuration requires a new version and corrupt existing data is never replaced',async t=>{
  const {store,dir}=await fixtureStore(t);const exp=experiment();await store.saveExperiment(exp);
  const changed=structuredClone(exp);changed.config.controller.kp=3;
  await assert.rejects(()=>store.saveExperiment(changed),/递增版本/);
  changed.version=2;await store.saveExperiment(changed);assert.equal((await store.listExperiments())[0].config.controller.kp,3);
  await assert.rejects(()=>store.saveExperiment(exp),/旧版本/);
  const file=path.join(dir,'experiments',`${exp.id}.json`);await fs.writeFile(file,'null');
  await assert.rejects(()=>store.saveExperiment(changed),/记录版本/);assert.equal(await fs.readFile(file,'utf8'),'null');
});

test('store: a large valid experiment remains below the disk limit and can be reopened',async t=>{
  const {store,dir}=await fixtureStore(t);const exp=experiment();
  const tAxis=Array.from({length:23000},(_,index)=>index/2000);
  const samples=Array(23000).fill(0.123456789123);
  const curves={t:tAxis,r:samples,y:samples,e:samples,u:samples,d:samples};
  exp.runs=Array.from({length:10},()=>({...run(exp.config),curves}));exp.activeRunId=exp.runs[0].id;
  assert.ok(Buffer.byteLength(JSON.stringify(exp),'utf8')<MAX_PACKAGE_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(exp,null,2),'utf8')>MAX_PACKAGE_BYTES,'fixture must exercise the previous pretty-JSON overflow');
  await store.saveExperiment(exp);
  const file=path.join(dir,'experiments',`${exp.id}.json`);assert.ok((await fs.stat(file)).size<=MAX_PACKAGE_BYTES);
  const restored=await store.listExperiments();assert.equal(restored.length,1);assert.equal(restored[0].runs.length,10);
  assert.equal(restored[0].runs[9].curves.y[22999],samples[22999]);
});

test('store: queued save-delete-save cannot resurrect a deleted experiment',async t=>{
  const {store}=await fixtureStore(t);const exp=experiment();
  const results=await Promise.allSettled([store.saveExperiment(exp),store.deleteExperiment(exp.id),store.saveExperiment({...exp,notes:'stale autosave'})]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'fulfilled');assert.equal(results[2].status,'rejected');assert.match(results[2].reason.message,/已删除/);
  assert.deepEqual(await store.listExperiments(),[]);
  const imported=await store.importExperimentObject(createExperimentPackage(exp));assert.notEqual(imported.id,exp.id);assert.equal((await store.listExperiments()).length,1);
});

test('packages: condition keys, candidate versions and completed status are cross-checked',()=>{
  const exp=experiment();const candidate={id:'candidate-1',basedOnVersion:1,controller:structuredClone(exp.config.controller),run:structuredClone(exp.runs[0])};
  exp.candidates=[candidate];assert.equal(validateExperimentPackage(createExperimentPackage(exp)).valid,true);
  candidate.basedOnVersion=2;assert.throws(()=>createExperimentPackage(exp),/版本/);candidate.basedOnVersion=1;
  candidate.run.conditionKey='other-conditions';assert.throws(()=>createExperimentPackage(exp),/评价条件/);candidate.run.conditionKey=conditionKey(candidate.run.config);
  candidate.run.status='unstable';candidate.run.verdict='pass';assert.throws(()=>createExperimentPackage(exp),/不能标记为达标/);
});

test('packages: leading zero numerator accepted consistently with the compute engine',()=>{
  const exp=experiment();exp.config.plant.numerator=[0,1];assert.equal(validateExperimentPackage(createExperimentPackage(exp)).valid,true);
  exp.config.bounds.kp=[0,1];assert.throws(()=>createExperimentPackage(exp),/超出声明/);
});

test('validation: rejects malformed metrics, deep objects, poison fields and unsafe URLs',()=>{
  const pack=createExperimentPackage(experiment());pack.experiment.runs[0].metrics.overshoot='forged';assert.equal(validateExperimentPackage(pack).valid,false);
  assert.throws(()=>inspectJson(JSON.parse('{"__proto__":{}}')),/字段/);const cycle={};cycle.self=cycle;assert.throws(()=>inspectJson(cycle),/层级/);
  for(const url of ['http://example.com','file:///secret','https://u:p@example.com','https://example.com?key=x'])assert.throws(()=>normalizeEndpoint(url));
  assert.equal(normalizeEndpoint('https://api.deepseek.com/v1/'),'https://api.deepseek.com/v1');assert.equal(normalizeEndpoint('http://localhost:1234'),'http://localhost:1234');
});

test('AI: real HTTP tool loop computes only 3 candidates, returns actual results, preserves reasoning and config',async t=>{
  const f=await aiFixture(t,(body,res,n)=>n===1?reply(res,{role:'assistant',content:null,reasoning_content:'compatibility-test',tool_calls:[tool('a',3),tool('b',4),tool('c',5),tool('d',6)]}):reply(res,{role:'assistant',content:'三套方案均未满足超调要求，请查看实际结果并继续观察。'}));
  const input=request(),before=JSON.stringify(input.config);const session=await f.ai.requestAi(input);
  assert.equal(f.requests.length,2);assert.equal(f.simulated.length,4);assert.equal(session.candidates.length,3);assert.equal(session.toolLog.length,4);assert.equal(session.toolLog[3].status,'error');assert.match(session.toolLog[3].error,/预算/);
  assert.equal(session.candidates[0].run.metrics.controlPeak,3);assert.equal(session.candidates[0].run.metrics.overshoot,12);assert.equal(JSON.stringify(input.config),before);
  assert.deepEqual(f.requests[0].body.thinking,{type:'disabled'});assert.equal(f.requests[1].body.tool_choice,'none');
  assert.equal(f.requests[1].body.messages.find(m=>m.tool_calls).reasoning_content,'compatibility-test');
  const feedback=f.requests[1].body.messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));assert.equal(feedback[0].metrics.overshoot,12);assert.ok(feedback[3].error);
  assert.equal(JSON.stringify(session).includes('test-key-not-real'),false);assert.equal(f.requests[0].url,'/v1/chat/completions');
  const exp=experiment();exp.aiSessions=[session];exp.candidates=session.candidates.map(c=>({...c,source:'ai',label:'AI 候选'}));assert.equal(validateExperimentPackage(createExperimentPackage(exp)).valid,true);
});

test('AI: forged result fields and unsupported tools rejected before compute; failures never become fake candidates',async t=>{
  const f=await aiFixture(t,(body,res,n)=>n===1?reply(res,{role:'assistant',content:null,tool_calls:[tool('forged',3,{metrics:{overshoot:0}}),{id:'code',type:'function',function:{name:'execute_code',arguments:'{}'}},tool('valid',4)]}):reply(res,{role:'assistant',content:'仅最后一套经过验证。'}),{provider:'openai-compatible'});
  const session=await f.ai.requestAi(request());assert.equal(session.candidates.length,1);assert.equal(f.simulated.length,2);assert.equal(session.toolLog.filter(log=>log.status==='error').length,2);assert.equal('thinking' in f.requests[0].body,false);
});

test('AI: mismatched compute results are rejected before becoming model evidence',async t=>{
  const f=await aiFixture(t,(body,res)=>reply(res,{role:'assistant',content:'unreachable'}));
  const ai=createAiService({store:f.store,simulate:async(c,o)=>run({...c,controller:{...c.controller,kp:9}},o)});
  await assert.rejects(()=>ai.requestAi(request()),/不同版本或参数/);assert.equal(f.requests.length,0);
});

test('AI: proposal is validated and returned without changing configuration or running simulations',async t=>{
  const f=await aiFixture(t,(body,res)=>reply(res,{role:'assistant',content:null,tool_calls:[{id:'proposal',type:'function',function:{name:'propose_configuration',arguments:JSON.stringify({patch:{goals:{overshootMax:5}},missing:[],explanation:'建议将超调目标设为 5%。'})}}]}));
  const original=config();const result=await f.ai.interpretGoal({text:'超调不超过 5%',config:original});assert.equal(result.patch.goals.overshootMax,5);assert.equal(original.goals.overshootMax,10);assert.equal(f.simulated.length,0);
});

test('AI: compute failures consume candidate budget instead of permitting unlimited retries',async t=>{
  const f=await aiFixture(t,(body,res,n)=>n===1?reply(res,{role:'assistant',content:null,tool_calls:[tool('a',3),tool('b',4),tool('c',5),tool('d',6)]}):reply(res,{role:'assistant',content:'部分计算失败，仅第一套结果可用。'}));
  let calls=0;
  const ai=createAiService({store:f.store,simulate:async(c,o)=>{calls++;if(calls>=3)throw new Error('测试计算故障');return run(c,o);}});
  const session=await ai.requestAi(request());assert.equal(calls,4);assert.equal(session.candidates.length,1);assert.match(session.toolLog.at(-1).error,/预算/);assert.equal(session.toolLog.at(-2).result.remainingBudget,0);
});

test('AI: proposal cannot mutate IDs, settings, or arbitrary objects',async t=>{
  const f=await aiFixture(t,(body,res)=>reply(res,{role:'assistant',content:null,tool_calls:[{id:'proposal',type:'function',function:{name:'propose_configuration',arguments:JSON.stringify({patch:{apiKey:'secret'},missing:[],explanation:'invalid'})}}]}));
  await assert.rejects(()=>f.ai.interpretGoal({text:'更改设置',config:config()}),/不支持/);
});

test('AI: no key, invalid JSON, and no tools give explicit errors',async t=>{
  const {store}=await fixtureStore(t);const ai=createAiService({store,simulate:async c=>run(c)});await assert.rejects(()=>ai.requestAi(request()),/尚未配置/);
  const f=await aiFixture(t,(body,res)=>{res.end('not JSON');});await assert.rejects(()=>f.ai.testConnection(),/有效 JSON/);
  const g=await aiFixture(t,(body,res)=>reply(res,{role:'assistant',content:'我已经优化好了。'}));await assert.rejects(()=>g.ai.requestAi(request()),/没有执行候选验证/);
});

test('AI: malformed tool entries fail explicitly instead of producing unsavable sessions',async t=>{
  const f=await aiFixture(t,(body,res)=>reply(res,{role:'assistant',content:null,tool_calls:[null]}));
  await assert.rejects(()=>f.ai.requestAi(request()),/函数结构无效/);assert.equal(f.simulated.length,1);
});

test('AI: authenticated redirects are not followed',async t=>{
  const destination=await server(t,(body,res)=>reply(res,{role:'assistant',content:'OK'}));
  const f=await aiFixture(t,(body,res)=>{res.writeHead(307,{Location:destination.baseUrl+'/chat/completions'});res.end();});
  await assert.rejects(()=>f.ai.testConnection(),/无法连接/);assert.equal(destination.requests.length,0);
});

test('AI: successful connection checks text only and timeout remains explicit',async t=>{
  const f=await aiFixture(t,(body,res)=>reply(res,{role:'assistant',content:'OK'}));assert.equal((await f.ai.testConnection()).ok,true);
  const g=await aiFixture(t,()=>{});await g.store.saveSettings({timeoutMs:5000});await assert.rejects(()=>g.ai.testConnection(),/超时/);
});

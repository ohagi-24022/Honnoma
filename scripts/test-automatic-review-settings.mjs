import assert from 'node:assert/strict';
import {automaticReviewPanel,saveAutomaticReviewSettings} from './shushuka-automatic-review-settings.mjs';
let config={enabled:false,daily_limit:50},updates=[],wakes=0;
const db={
  from(table){
    assert.equal(table,'book_content_review_config');
    return {
      select(){return {eq(){return {single:async()=>({data:{...config},error:null})};}};},
      update(row){updates.push(row);return {eq:async()=>{Object.assign(config,row);return {error:null};}};},
    };
  },
  rpc:async name=>{assert.equal(name,'wake_book_content_review');wakes++;return {data:null};},
};
const unavailable={ready:()=>false,mailReady:()=>false};
const available={ready:()=>true,mailReady:()=>true};
assert.equal((await saveAutomaticReviewSettings(db,unavailable,{action:'start'})).code,400);
assert.equal(updates.length,0);
assert.equal((await saveAutomaticReviewSettings(db,available,{action:'start'})).code,303);
assert.equal(config.enabled,true);assert.deepEqual(updates.at(-1),{enabled:true});assert.equal(wakes,1);
assert.equal((await saveAutomaticReviewSettings(db,unavailable,{action:'stop',daily_limit:'bad'})).code,303);
assert.equal(config.enabled,false);assert.deepEqual(updates.at(-1),{enabled:false});assert.equal(wakes,1);
assert.equal((await saveAutomaticReviewSettings(db,unavailable,{action:'limit',daily_limit:'20'})).code,303);
assert.equal(config.daily_limit,20);assert.equal(config.enabled,false);
assert.equal((await saveAutomaticReviewSettings(db,available,{action:'limit',daily_limit:'0'})).code,400);
assert.equal((await saveAutomaticReviewSettings(db,available,{action:'limit',daily_limit:'501'})).code,400);
assert.equal((await saveAutomaticReviewSettings(db,available,{action:'limit',daily_limit:'2.5'})).code,400);
assert.equal((await saveAutomaticReviewSettings(db,available,{action:'invalid'})).code,400);
const e=x=>String(x??'').replaceAll('<','&lt;').replaceAll('"','&quot;');
let html=automaticReviewPanel({config,service:unavailable,token:'<input name="csrf">',escapeHtml:e});
assert.ok(html.includes('role="switch"'));assert.ok(html.includes('aria-checked="false"'));assert.ok(html.includes('OFF：'));assert.ok(html.includes('value="start" disabled'));assert.ok(html.includes('name="csrf"'));assert.ok(html.includes('Renderの設定を開く'));
html=automaticReviewPanel({config:{...config,enabled:true},service:unavailable,token:'',escapeHtml:e});
assert.ok(html.includes('value="stop" >'));assert.ok(html.includes('aria-checked="true"'));assert.ok(html.includes('auto-review-thumb'));assert.ok(html.includes('開始済みの処理は完了する場合'));
console.log('Automatic review settings passed: readiness, explicit start/stop, stop without key, limits, no job mutations, state preservation.');
// Status uses the existing worker credential and never starts paid processing.
const {registerReviewPublic}=await import('./shushuka-content-review.mjs');
const routes=new Map();let runs=0;
const statusDb={from:()=>({select:()=>({eq:()=>({single:async()=>({data:{worker_token:'worker-secret',enabled:false},error:null})})})})};
registerReviewPublic({post:(p,h)=>routes.set(p,h),options(){}},statusDb,{...unavailable,run:async()=>{runs++}});
let code=200,payload;
const res={status(v){code=v;return this;},sendStatus(v){code=v;return this;},json(v){payload=v;return this;}};
await routes.get('/api/content-review-worker')({headers:{authorization:'Bearer wrong'},body:{action:'status'}},res);
assert.equal(code,401);
code=200;
await routes.get('/api/content-review-worker')({headers:{authorization:'Bearer worker-secret'},body:{action:'status'}},res);
assert.equal(code,200);assert.deepEqual(payload,{enabled:false,apiReady:false,mailReady:false});assert.equal(runs,0);
assert.ok(!JSON.stringify(payload).includes('worker-secret'));
console.log('Worker readiness status: authenticated, no API request, no credential exposure.');

const readyToggle=automaticReviewPanel({config:{...config,enabled:false},service:available,token:'',escapeHtml:e});
assert.ok(readyToggle.includes('value="start" >'));
assert.ok(readyToggle.includes('aria-checked="false"'));
assert.ok(!readyToggle.includes('name="action" value="start" disabled'));
console.log('Accessible toggle: ON/OFF, checked state, readiness, keyboard focus, reduced motion, native form submission: OK');

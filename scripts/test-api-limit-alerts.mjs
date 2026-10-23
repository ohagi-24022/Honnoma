import assert from 'node:assert/strict';
import {createApiLimitAlerts,openAiLimitKind} from './shushuka-api-limit-alerts.mjs';
import {createWishlistSearch} from './shushuka-wishlist-search.mjs';
import {assessContent,registerReviewPublic} from './shushuka-content-review.mjs';
const response=(status,code,type)=>({ok:false,status,json:async()=>({error:{code,type,message:'SECRET QUERY DO NOT MAIL'}})});
for(const code of ['insufficient_quota','credit_balance_exhausted','project_spend_limit_exceeded','organization_spend_limit_exceeded','organization_usage_limit_exceeded'])assert.equal(await openAiLimitKind(response(429,code)),'quota');
assert.equal(await openAiLimitKind(response(429,'rate_limit_exceeded')),'rate_limit');
assert.equal(await openAiLimitKind({status:429,json:async()=>{throw Error('HTML')}}),'rate_limit');
assert.equal(await openAiLimitKind(response(500,'server_error')),null);
const rows=new Map();let clock=0;
const db={rpc:async(name,args)=>{
 if(name==='enqueue_api_limit_mail') {const key=args.p_source+':'+args.p_kind;if(![...rows.values()].some(r=>r.source===args.p_source&&r.kind===args.p_kind&&!r.recovered_at)){const id=key+':'+rows.size;rows.set(id,{id,source:args.p_source,kind:args.p_kind,status:'pending',attempts:0,available:0,created_at:'2000-01-01T00:00:00Z'});}return {};}
 if(name==='recover_api_limit_mail'){for(const row of rows.values())if(row.source===args.p_source&&row.kind===args.p_kind&&!row.recovered_at&&row.created_at<=args.p_request_started_at)row.recovered_at=new Date().toISOString();return {};}
 if(name==='claim_api_limit_mail'){const row=[...rows.values()].find(r=>['pending','sending'].includes(r.status)&&r.attempts<5&&r.available<=clock);if(!row)return {data:[]};row.status='sending';row.attempts++;row.available=clock+300000;row.lease_token='lease'+row.attempts;return {data:[{...row}]};}
 if(name==='finish_api_limit_mail'){const row=rows.get(args.p_id);if(row.lease_token===args.p_lease){row.status=args.p_sent?'sent':row.attempts>=5?'failed':'pending';row.available=clock+900000;}return {};}
 throw Error(name);
}};
const env=Object.fromEntries(['HOST','USER','PASSWORD'].map(k=>['CONTENT_REVIEW_SMTP_'+k,'test-only']));Object.assign(env,{CONTENT_REVIEW_MAIL_FROM:'sender@example.test',CONTENT_REVIEW_MAIL_TO:'registered@example.test'});
let fail=true;const mails=[];
const transport={sendMail:async mail=>{if(fail)throw Error('SMTP down');mails.push(mail);}};
const a=createApiLimitAlerts(db,env,{transport}),b=createApiLimitAlerts(db,env,{transport});
await Promise.all([a.notify('wishlist_search','quota'),b.notify('wishlist_search','quota')]);
assert.equal(rows.size,1);await a.flush();assert.equal(mails.length,0);assert.equal([...rows.values()][0].status,'pending');
fail=false;await b.flush();assert.equal(mails.length,0);clock+=900001;
await Promise.all([a.flush(),b.flush()]);assert.equal(mails.length,1);
assert.equal(mails[0].to,'registered@example.test');assert.match(mails[0].text,/クレジット不足/);assert(!mails[0].text.includes('SECRET'));
await a.notify('wishlist_search','quota');await a.flush();assert.equal(mails.length,1);
await a.recover('content_review','quota','2026-10-22T00:00:00Z');
await a.notify('wishlist_search','quota');await a.flush();assert.equal(mails.length,1);
await a.recover('wishlist_search','quota','2026-10-22T00:00:00Z');
await a.notify('wishlist_search','quota');await a.flush();assert.equal(mails.length,2);
assert.equal(rows.size,2);assert.notEqual(mails[0].messageId,mails[1].messageId);
rows.set('test-mail',{id:'test-mail',source:'wishlist_search',kind:'rate_limit',status:'pending',attempts:0,available:clock,created_at:new Date().toISOString(),is_test:true,recovered_at:new Date().toISOString()});
await a.flush();assert.equal(mails.length,3);assert.match(mails[2].subject,/テストメール/);assert.match(mails[2].text,/実際のAPI制限やクレジット不足は発生していません/);
await a.flush();assert.equal(mails.length,3);
const calls=[];const alerts={notify:async(...args)=>calls.push(args)};
const searchDb={rpc:async()=>({data:'claimed'}),from(){return {update(){return this},eq(){return this},then(resolve){resolve({});}};}};
const search=createWishlistSearch(searchDb,{env:{OPENAI_API_KEY:'not-real'},alerts,fetcher:async()=>response(429,'insufficient_quota')});
assert.equal((await search('private search','user')).code,503);assert.deepEqual(calls.pop(),['wishlist_search','quota']);
await assert.rejects(()=>assessContent({title:'private',description:''},null,{OPENAI_API_KEY:'not-real'},async()=>response(429,'rate_limit_exceeded'),alerts));
assert.deepEqual(calls.pop(),['content_review','rate_limit']);
let count=10;const limitedDb={rpc:async()=>({data:'limited'}),from(){return {select(){return this},gte:async()=>({count})}}};
const limited=createWishlistSearch(limitedDb,{env:{OPENAI_API_KEY:'not-real'},alerts});
await limited('user cap','user');assert.equal(calls.length,0);count=100;await limited('global cap','user');assert.deepEqual(calls.pop(),['wishlist_search','daily_limit']);
const recovered=[];
const fresh=createWishlistSearch(searchDb,{env:{OPENAI_API_KEY:'not-real'},alerts:{...alerts,recover:async(...args)=>recovered.push(args)},fetcher:async()=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{"queries":[]}'}]}]})})});
assert.equal((await fresh('new uncached query','user')).code,200);
assert.deepEqual(recovered.map(r=>r.slice(0,2)),[['wishlist_search','daily_limit'],['wishlist_search','rate_limit'],['wishlist_search','quota']]);
assert(recovered.every(r=>!Number.isNaN(Date.parse(r[2]))));
const cached=createWishlistSearch({rpc:async()=>({data:'cached'}),from:()=>({select(){return this},eq(){return this},single:async()=>({data:{status:'completed',queries:[]}})})},{env:{OPENAI_API_KEY:'not-real'},alerts:{recover:()=>{throw Error('Cache must not prove recovery')}}});
assert.equal((await cached('cached','user')).code,200);
// An authenticated alert-only worker request drains mail even while AI is OFF,
// and does not invoke paid AI, metadata preparation, or book review.
const routes=new Map();let flushes=0;
const workerDb={from:()=>({select(){return this},eq(){return this},single:async()=>({data:{worker_token:'test-worker',enabled:false}})})};
registerReviewPublic({options(){},post:(path,fn)=>routes.set(path,fn)},workerDb,{flushAlerts:async()=>flushes++});
let status;const res={sendStatus(n){status=n;return this},json(){status=200;return this},status(n){status=n;return this}};
await routes.get('/api/content-review-worker')({headers:{authorization:'Bearer test-worker'},body:{action:'flush-alerts'}},res);
assert.equal(status,200);assert.equal(flushes,1);
console.log('API limit mail: quota/rate/daily detection, existing recipient, persistent daily dedup, concurrent claims, SMTP retry, same-day recurrence after confirmed recovery, cached results do not prove recovery, no sensitive payload, worker while AI OFF: OK');

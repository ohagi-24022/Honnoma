import assert from 'node:assert/strict';
import { registerReviewAdmin, bulkGeneralSelectionScript } from './shushuka-review-admin.mjs';
import { runInNewContext } from 'node:vm';
const jobs=[{isbn13:'9784088914763',title:'Sample <book>',adult_only:null,status:'pending_review',content_hash:'hash',cover_status:'unreviewed',candidate:{title:'Sample <book>',publisher:'集英社',cover_hash:'cover',source_url:'https://example.test'}},
 {isbn13:'9780306406157',title:'Other',adult_only:false,status:'pending_review',content_hash:'other',cover_status:'unreviewed',candidate:{title:'Other',publisher:'講談社'}}];
const handlers=new Map(),writes=[];
let csrf;
const app={get:(p,fn)=>handlers.set('GET '+p,fn),post:(p,fn)=>handlers.set('POST '+p,fn)};
function query(table){const filters=[];let fields,options={},start=0,end=999;
 const q={select(f,o={}){fields=f;options=o;return q},eq(k,v){filters.push([k,v]);return q},is(k,v){filters.push([k,v]);return q},not(k){filters.push([k,'not-null']);return q},ilike(k,v){filters.push([k,v]);return q},order(){return q},in(){return q},limit(){return q},range(a,b){start=a;end=b;return q},single:async()=>({data:table==='book_content_review_config'?{enabled:false,daily_limit:50}:jobs.find(x=>x.isbn13===filters.find(x=>x[0]==='isbn13')?.[1])}),then(resolve){
  let data=table==='book_content_review_jobs'?jobs:[];
  for(const [k,v]of filters){if(k==='adult_only')data=data.filter(x=>x.adult_only===v);if(k==='candidate->>title')data=data.filter(x=>v==='not-null'?!!x.candidate?.title:!x.candidate?.title);if(k==='candidate->>publisher')data=data.filter(x=>x.candidate?.publisher===v);if(k==='title'||k==='isbn13'){const needle=v.replaceAll('%','');data=data.filter(x=>String(x[k]).includes(needle));}}
  const count=data.length;data=data.slice(start,end+1);
  if(fields==='candidate->>publisher')data=data.map(x=>({publisher:x.candidate.publisher}));
  resolve({data:options.head?null:data,count});}};return q;}
const db={from:query,rpc:async(name,args)=>{writes.push({name,args});return {data:true}}};
const escape=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
registerReviewAdmin(app,db,{ready:()=>false,mailReady:()=>false},(_title,body)=>body,escape);
let html='',code=200,redirect;
const res={send(x){html=x;return this},status(x){code=x;return this},sendStatus(x){code=x},redirect(x,y){redirect=y}};
await handlers.get('GET /reviews')({query:{}},res);
csrf=html.match(/name="csrf" value="([^"]+)"/)[1];
assert(html.includes('class="review-row"'));assert(html.includes('Sample &lt;book>'));
assert(html.includes('type="radio" name="adult_0" value="false"'));assert(html.includes('type="radio" name="adult_0" value="true"'));
assert(!html.includes('name="adult_1"'));assert(html.includes('未選択の本は変更されません'));
await handlers.get('POST /reviews/classify')({method:'POST',body:{csrf,row:'all',isbn_0:jobs[0].isbn13,hash_0:'hash',adult_0:'false',isbn_1:jobs[1].isbn13,hash_1:'other'}},res);
assert.equal(writes.length,1);assert.equal(writes[0].args.p_adult,false);assert.equal(writes[0].args.p_cover,null);assert.equal(redirect,'/reviews');
await handlers.get('POST /reviews/classify')({method:'POST',body:{csrf,row:'0',isbn_0:jobs[0].isbn13,hash_0:'hash',adult_0:'true',approve_cover:'on'}},res);
assert.equal(writes.at(-1).args.p_adult,true);assert.equal(writes.at(-1).args.p_cover,null);
const before=writes.length;
await handlers.get('POST /reviews/classify')({method:'POST',body:{csrf,row:'0',isbn_0:jobs[0].isbn13,hash_0:'stale',adult_0:'false'}},res);
assert.equal(writes.length,before);assert.equal(code,409);
await handlers.get('POST /reviews/classify')({method:'POST',body:{csrf:'bad',row:'0',isbn_0:jobs[0].isbn13,hash_0:'hash',adult_0:'false'}},res);
assert.equal(code,403);assert.equal(writes.length,before);
const original=[...jobs];
for(let n=0;n<105;n++)jobs.push({...original[0],isbn13:String(9800000000000+n),title:`Paged book ${n}`,candidate:{title:`Paged book ${n}`,publisher:n<100?'小学館':'白泉社'}});
for(const size of [10,30,50,100]){await handlers.get('GET /reviews')({query:{size:String(size),page:'2'}},res);assert.equal((html.match(/class="review-row"/g)||[]).length,Math.min(size,106-size));assert(html.includes(`size=${size}&amp;page=1`));assert(html.includes('前へ'));}
await handlers.get('GET /reviews')({query:{size:'10',publisher:'白泉社'}},res);assert.equal((html.match(/class="review-row"/g)||[]).length,5);assert(html.includes('全5件'));assert(html.includes('Paged book 104'));
await handlers.get('GET /reviews')({query:{size:'10',q:'Paged book 104'}},res);assert.equal((html.match(/class="review-row"/g)||[]).length,1);assert(html.includes('全1件'));
await handlers.get('GET /reviews')({query:{size:'10',page:'99999'}},res);assert(html.includes('11 / 11ページ'));assert.equal((html.match(/class="review-row"/g)||[]).length,6);
console.log('Pagination: 10/30/50/100, publisher/search before paging, last-page clamp: OK');
console.log('Manual list: horizontal cards, two-state classification, unselected rows, adult image exclusion, stale data and CSRF: OK');
assert(html.includes('type="button" data-select-general'));
const buttons={select:{},undo:{disabled:true},status:{textContent:''}};
const radios=[{value:'false',checked:false},{value:'true',checked:false},{value:'false',checked:false},{value:'true',checked:true},{value:'false',checked:true},{value:'true',checked:false}];
const initial=radios.map(x=>x.checked);const cover={checked:false};const otherPage={checked:false};
for(const button of [buttons.select,buttons.undo])button.addEventListener=(_event,handler)=>{button.click=handler;};
const form={querySelector(selector){return {'[data-select-general]':buttons.select,'[data-undo-general]':buttons.undo,'[data-selection-status]':buttons.status}[selector];},querySelectorAll(selector){assert.equal(selector,'input[type="radio"][name^="adult_"]');return radios;}};
runInNewContext(bulkGeneralSelectionScript,{document:{querySelector(selector){assert.equal(selector,'[data-review-classify]');return form;}}});
const countBefore=writes.length;buttons.select.click();
assert.deepEqual(radios.map(x=>x.checked),[true,false,true,false,true,false]);assert.equal(buttons.undo.disabled,false);assert(buttons.status.textContent.includes('3件'));
assert.equal(writes.length,countBefore);assert.equal(cover.checked,false);assert.equal(otherPage.checked,false);
buttons.undo.click();assert.deepEqual(radios.map(x=>x.checked),initial);assert.equal(buttons.undo.disabled,true);
console.log('Bulk general selection: mixed radio states, current form only, no auto-save/cover approval, undo: OK');
assert(html.includes('formaction="/reviews/cover"'));assert(html.includes('name="cover_0" value="show"'));
const coverHandlers=new Map();let imageReads=0, snapshots=0;
registerReviewAdmin({get:(p,f)=>coverHandlers.set('GET '+p,f),post:(p,f)=>coverHandlers.set('POST '+p,f)},db,{ready:()=>false,mailReady:()=>false},(_t,b)=>b,escape,{
  fetchCover:async()=>{imageReads++;return {hash:'cover'};},snapshotCover:async()=>{snapshots++;return 'https://example.test/snapshot.jpeg';},
});
await coverHandlers.get('GET /reviews')({query:{}},res);const coverCsrf=html.match(/name="csrf" value="([^"]+)"/)[1];
const coverRequest=fields=>coverHandlers.get('POST /reviews/cover')({method:'POST',body:{csrf:coverCsrf,cover_row:'0',isbn_0:original[0].isbn13,hash_0:'hash',cover_0:'show',return_to:'/reviews?size=30&page=2',...fields}},res);
const beforeCover=writes.length;
await coverRequest({csrf:'bad'});assert.equal(code,403);assert.equal(writes.length,beforeCover);
await coverRequest({});assert.equal(code,400);assert.equal(imageReads,0);assert.equal(writes.length,beforeCover);
original[0].adult_only=false;await coverRequest({});assert.equal(imageReads,1);assert.equal(snapshots,1);assert.equal(writes.at(-1).name,'set_book_cover_review');assert.equal(writes.at(-1).args.p_show,true);assert.equal(redirect,'/reviews?size=30&page=2');assert(!('p_adult' in writes.at(-1).args));
original[0].adult_only=true;const beforeBlocked=writes.length;await coverRequest({});assert.equal(code,400);assert.equal(writes.length,beforeBlocked);
await coverRequest({cover_0:'hide',adult_0:'false'});assert.equal(writes.at(-1).args.p_show,false);assert.equal(writes.at(-1).args.p_cover,null);assert.equal(imageReads,1);assert(!('p_adult' in writes.at(-1).args));
const beforeStale=writes.length;await coverRequest({hash_0:'stale',cover_0:'hide'});assert.equal(writes.length,beforeStale);
console.log('Individual cover control: separate save, general-only approval, immutable snapshot, hide without fetch/classification, CSRF and stale content: OK');

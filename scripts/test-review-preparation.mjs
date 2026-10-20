import assert from 'node:assert/strict';
import { createReviewService, registerReviewPublic } from './shushuka-content-review.mjs';
const isbn='9784088928623';
const jobs=new Map([[isbn,{status:'queued',adult_only:null,candidate:null,classification_source:null}]]);
const writes=[];let externalCalls=0;
const db={
  from(table){let selected;const q={select(){return q},in(){return q},is(){return q},lte(){return q},order(){return q},async limit(){return {data:[...jobs.keys()].map(isbn13=>({isbn13})),error:null}},eq(key,value){if(key==='isbn13')selected=value;return q},async maybeSingle(){return {data:table==='book_content_review_jobs'?jobs.get(selected):null,error:null}},async single(){return {data:{worker_token:'fixture-token',enabled:false},error:null}}};return q;},
  functions:{invoke:async(_name,{body})=>({data:{body:{Items:[{Item:{isbn:body.params.isbn,title:'のあ先輩はともだち。 1',publisherName:'集英社',largeImageUrl:'https://cover.openbd.jp/'+isbn+'.jpg'}}]}},error:null})},
  rpc:async(name,args)=>{writes.push({name,args});return {data:true,error:null}},
};
const service=createReviewService(db,{}, {fetch:async(url)=>{externalCalls++;assert(!url.includes('openai.com'));return new Response(Buffer.from([255,216,255,10]));}});
assert.equal(service.ready(),false);
const prepared=await service.prepare([isbn]);
assert.deepEqual(prepared.prepared,[isbn]);assert.equal(externalCalls,1);
assert.equal(writes[0].name,'prepare_book_content_review');
assert.equal(writes[0].args.p_candidate.review_origin,'registration');
assert.equal(writes[0].args.p_candidate.cover_hash.length,64);
assert(!writes.some(x=>x.name.includes('finish')||x.name.includes('classify')||x.name.includes('mail')));
jobs.get(isbn).classification_source='manual';
assert.deepEqual((await service.prepare([isbn])).skipped,[isbn]);assert.equal(externalCalls,1);
const handlers=new Map();registerReviewPublic({options(){},post:(path,fn)=>handlers.set(path,fn)},db,service);
let code=200,payload;
const res={status(value){code=value;return this},sendStatus(value){code=value;return this},json(value){payload=value;return this}};
await handlers.get('/api/content-review-worker')({headers:{},body:{action:'prepare',isbns:[isbn]}},res);
assert.equal(code,401);
await handlers.get('/api/content-review-worker')({headers:{authorization:'Bearer fixture-token'},body:{action:'prepare',isbns:[isbn,isbn,isbn,isbn]}},res);
assert.equal(code,400);
code=200;await handlers.get('/api/content-review-worker')({headers:{authorization:'Bearer fixture-token'},body:{action:'prepare',isbns:[isbn]}},res);
assert.deepEqual(payload.skipped,[isbn]);assert.equal(code,200);
console.log('Authenticated preparation: works with AI OFF/no API key, no AI/mail/approval calls, source hash, manual protection, authentication and bounded intake: OK');

jobs.get(isbn).classification_source=null;
const beforePreparation=writes.length;
await handlers.get('/api/content-review-worker')({headers:{authorization:'Bearer fixture-token'},body:{action:'prepare-pending'}},res);
assert.deepEqual(payload.prepared,[isbn]);
assert.equal(writes.length,beforePreparation+1);
assert.equal(writes.at(-1).name,'prepare_book_content_review','AI OFF must only prepare editable metadata.');
assert(!writes.some(x=>x.name.includes('claim_book_content_review')));
const failedCoverService=createReviewService(db,{}, {fetch:async()=>new Response('missing',{status:404})});
assert.deepEqual((await failedCoverService.prepare([isbn])).prepared,[isbn]);
assert.equal(writes.at(-1).args.p_candidate.cover_hash,null,'Failed cover must not prevent title editing.');
console.log('Pending preparation while AI OFF: bounded metadata-only path, no classification/mail; failed images retain editable metadata: OK');

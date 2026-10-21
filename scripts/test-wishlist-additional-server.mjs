import assert from 'node:assert/strict';
import {createWishlistSearch,registerWishlistSearch} from './shushuka-wishlist-search.mjs';
const cache=new Map();let paid=0,claims=0,invalid=false;
const db={auth:{getUser:async token=>token==='valid'?{data:{user:{id:'user'}}}:{error:true}},rpc:async(_n,{p_hash})=>{claims++;if(cache.has(p_hash))return {data:'cached'};cache.set(p_hash,{status:'processing'});return {data:'claimed'};},from(){let hash,patch;const q={select(){return q},update(p){patch=p;return q},eq(k,v){if(k==='query_hash')hash=v;return q},single:async()=>({data:cache.get(hash)}),then(resolve){Object.assign(cache.get(hash),patch);resolve({});}};return q;}};
const options={env:{OPENAI_API_KEY:'test-only'},fetcher:async(_url,request)=>{paid++;const body=JSON.parse(request.body);assert.equal(body.store,false);assert.equal(body.max_output_tokens,256);assert(!body.tools);return {ok:true,json:async()=>({status:'completed',usage:{input_tokens:100,output_tokens:20},output:[{content:[{type:'output_text',text:invalid?'bad-json':JSON.stringify({queries:['正式な作品名']})}]}]})};}};
const search=createWishlistSearch(db,options);
assert.equal((await search('略称','user')).code,200);assert.equal(paid,1);
assert.equal((await search(' 略称 ','another-user')).cached,true);assert.equal(paid,1);
invalid=true;assert.equal((await search('別の略称','user')).code,503);assert.equal(paid,2);assert.equal((await search('別の略称','user')).code,503);assert.equal(paid,2);
const claimCount=claims;assert.equal((await createWishlistSearch(db,{env:{}})('未設定','user')).code,503);assert.equal(claims,claimCount);
const routes=new Map();registerWishlistSearch({options(){},post:(p,f)=>routes.set(p,f)},db,()=>true,options);
async function post(query,token){let code,payload;const res={set(){return this},status(c){code=c;return this},json(v){payload=v;return this;}};await routes.get('/api/wishlist-search')({body:{query},headers:{authorization:token?'Bearer '+token:''}},res);return {code,payload};}
assert.equal((await post('作品名')).code,401);assert.equal((await post('作品名','expired')).code,401);assert.equal((await post('x'.repeat(81),'valid')).code,400);assert.equal(paid,2);
console.log('Additional search server: one paid request per normalized word, shared persistent cache, failure deduplication, output validation, token cap/no tools/no storage, authenticated callers only: OK');

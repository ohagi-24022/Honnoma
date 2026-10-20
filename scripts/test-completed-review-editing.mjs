import assert from 'node:assert/strict';
import { registerReviewAdmin } from './shushuka-review-admin.mjs';
const handlers=new Map(), calls=[];
const job={isbn13:'9784088914763',title:'確認済みの本',status:'approved',adult_only:false,content_hash:'current',cover_status:'approved',description_status:'approved',candidate:{title:'確認済みの本',cover_url:'https://example.test/cover',cover_hash:'image',description:'確認した紹介文',source_url:'https://example.test/book'}};
const db={from(){return {select(){return this},eq(){return this},single:async()=>({data:job})}},rpc:async(name,args)=>{calls.push({name,args});job.status=args.p_approved?'approved':'rejected';return {data:true}}};
let imageHash='image';
registerReviewAdmin({get:(p,f)=>handlers.set('GET '+p,f),post:(p,f)=>handlers.set('POST '+p,f)},db,{},(_t,b)=>b,x=>String(x??''),{fetchCover:async()=>({hash:imageHash}),snapshotCover:async()=> 'https://ccaregwftbjqwaztvwdu.supabase.co/storage/v1/object/public/reviewed-book-covers/'+ 'a'.repeat(64)+'.jpeg'});
async function request(method,body={},query={}){
 const res={code:200,html:'',status(c){this.code=c;return this},send(h){this.html=h;return this},redirect(c,url){this.code=c;this.url=url}};
 await handlers.get(method+' /reviews/:isbn')({method,params:{isbn:job.isbn13},query,body},res);return res;
}
let res=await request('GET');
const csrf=res.html.match(/name="csrf" value="([^"]+)"/)[1];
assert(res.html.includes('確認済みの内容も'));
assert(res.html.includes('<button  name="decision" value="approve">'));
const valid={csrf,hash:'current',decision:'approve',cover:'on',description:'on'};
res=await request('POST',valid);assert.equal(res.code,303);assert.equal(calls.at(-1).name,'resolve_book_content_review');assert(calls.at(-1).args.p_display.cover_url.endsWith('.jpeg'));assert.equal(calls.at(-1).args.p_display.description,job.candidate.description);
res=await request('POST',{...valid,description:undefined});assert.equal(res.code,303);assert.equal(calls.at(-1).args.p_display.description,null);
res=await request('POST',{csrf,hash:'current',decision:'reject'});assert.equal(res.code,303);assert.equal(calls.at(-1).args.p_approved,false);
res=await request('GET');assert(res.html.includes('<button  name="decision" value="approve">'));
res=await request('POST',valid);assert.equal(res.code,303);
const count=calls.length;
for(const invalid of [{...valid,csrf:'bad'},{...valid,hash:'old'},{...valid,decision:'other'},{...valid,cover:undefined,description:undefined}]){res=await request('POST',invalid);assert(res.code>=400);assert.equal(calls.length,count);}
imageHash='changed';res=await request('POST',valid);assert.equal(res.code,400);assert.equal(calls.length,count);imageHash='image';
for(const status of ['queued','processing','retry']){job.status=status;res=await request('GET');assert(res.html.includes('<button disabled name="decision" value="approve">'));res=await request('POST',valid);assert.equal(res.code,400);}
job.status='approved';job.adult_only=true;res=await request('GET');assert(res.html.includes('一般向けとして分類を保存'));res=await request('POST',valid);assert.equal(res.code,400);assert.equal(calls.length,count);
res=await request('POST',{csrf,hash:'current',decision:'reject'});assert.equal(res.code,303);
res=await request('GET',{}, {saved:'1'});assert(res.html.includes('表示設定を保存しました'));
console.log('Completed reviews: editable approval and rejection, independent choices, stale/image checks, adult/processing restrictions and CSRF: OK');

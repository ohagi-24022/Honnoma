import assert from 'node:assert/strict';
import { validIsbn,safeCoverUrl,fetchBook,fetchCover,assessContent,decideContent,createReviewService,registerReviewPublic } from './shushuka-content-review.mjs';
const good={safe:true,uncertain:false,categories:[]};
const held={safe:false,uncertain:false,categories:['sexual']};
const assessment={title:good,cover:good,description:good,reason:'表示可'};
const book={title:'書籍',description:'紹介文',cover_url:'https://cover.openbd.jp/9784088914763.jpg',source_url:'https://api.openbd.jp/v1/get?isbn=9784088914763'};
assert(validIsbn('9784088914763'));assert(!validIsbn('9784088914764'));assert(!validIsbn('1929979006006'));
for(const url of ['http://cover.openbd.jp/a','https://cover.openbd.jp.attacker.test/a','https://127.0.0.1/a','https://cover.openbd.jp:444/a','https://user@cover.openbd.jp/a'])assert(!safeCoverUrl(url));
assert(safeCoverUrl(book.cover_url));
assert.deepEqual(decideContent(book,{},assessment),{cover_status:'approved',description_status:'approved',status:'approved'});
assert.equal(decideContent(book,{}, {...assessment,cover:held}).description_status,'approved');
assert.equal(decideContent(book,{}, {...assessment,cover:held}).status,'pending_review');
assert.equal(decideContent(book,null,assessment).cover_status,'held');
assert.equal(decideContent(book,{}, {...assessment,title:held}).description_status,'held');
assert.equal(decideContent(book,{}, {...assessment,cover:{...good,uncertain:true}}).cover_status,'held');
assert.throws(()=>decideContent(book,{}, {...assessment,cover:{safe:true}}));
await assert.rejects(()=>fetchCover('https://127.0.0.1/a',()=>{throw new Error('Must not fetch');}));
await assert.rejects(()=>fetchCover(book.cover_url,async()=>new Response('<html>bad</html>')));
const image=await fetchCover(book.cover_url,async()=>new Response(Buffer.from([255,216,255,10])));
assert.equal(image.mime,'image/jpeg');
let calls=0;
const matched=await fetchBook({functions:{invoke:async()=>({data:{body:{Items:[{Item:{isbn:'9784088914764',title:'Wrong'}}]}}})}},'9784088914763',async(url)=>{
  calls++;return new Response(JSON.stringify(url.includes('openbd')?[{summary:{isbn:'9784088914763',title:'Correct',cover:''}}]:{}));
});
assert.equal(matched.title,'Correct');assert.equal(calls,1);
let request;
const result=await assessContent(book,image,{OPENAI_API_KEY:'fake'},async(url,options)=>{
  request=JSON.parse(options.body);return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(assessment)}]}]}));
});
assert.equal(result.reason,'表示可');assert.equal(request.store,false);assert.equal(request.text.format.strict,true);
assert(request.input[0].content[1].image_url.startsWith('data:image/jpeg;base64,'));
await assert.rejects(()=>assessContent(book,null,{OPENAI_API_KEY:'fake'},async()=>new Response(JSON.stringify({status:'incomplete',output:[]}))));
await assert.rejects(()=>assessContent(book,null,{OPENAI_API_KEY:'fake'},async()=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'refusal'}]}]}))));
let dbCalls=0;await createReviewService({rpc:()=>{dbCalls++;}},{}).run();assert.equal(dbCalls,0);
const logs=[];let claimed=false;
const env={OPENAI_API_KEY:'fake',CONTENT_REVIEW_SMTP_HOST:'smtp.test',CONTENT_REVIEW_SMTP_USER:'test',CONTENT_REVIEW_SMTP_PASSWORD:'fake',CONTENT_REVIEW_MAIL_FROM:'from@example.test',CONTENT_REVIEW_MAIL_TO:'to@example.test'};
const db={rpc:async(name,args)=>{
  logs.push({name,args});
  if(name==='claim_book_content_review')return {data:[]};
  if(name==='claim_book_content_review_mail'){if(claimed)return {data:[]};claimed=true;return {data:[{id:'one',isbn13:'9784088914763',lease_token:'lease'}]};}
  return {data:null};
}};
let mails=0;const service=createReviewService(db,env,{transport:{sendMail:async(mail)=>{mails++;assert(mail.text.includes('/reviews'));assert(!mail.text.includes('fake'));}}});
await service.run();await service.run();assert.equal(mails,1);assert.equal(logs.find(x=>x.name==='finish_book_content_review_mail').args.p_sent,true);
claimed=false;const failing=createReviewService(db,env,{transport:{sendMail:async()=>{throw new Error('SMTP');}}});await failing.run();assert.equal(logs.at(-1).args.p_sent,false);
const handlers=new Map();registerReviewPublic({post:(path,fn)=>handlers.set(path,fn),options:()=>{}},null,service);
const res={code:200,set(){return this;},status(code){this.code=code;return this;},json(){return this;}};
await handlers.get('/api/book-content-review')({body:{isbns:['9784088914764']},socket:{remoteAddress:'test'}},res);assert.equal(res.code,400);
console.log('Automatic content review: source matching, independent gates, fail-closed AI, image hosts, disabled keys, mail success/retry and ISBN validation: OK');

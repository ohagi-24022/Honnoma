import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const cache=new Map();
let providerItems=[];
function load(file){
  file=path.resolve(file);
  if(cache.has(file))return cache.get(file);
  const exports={};cache.set(file,exports);
  let source=fs.readFileSync(file,'utf8');
  if(file.endsWith('/bookApis.ts')) source+='\nexport { findLatestVolumeFromTitles, mergeBookMetadata, selectRakutenItem };';
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{
    exports,console,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,
    require:name=>{
      if(name==='./env')return {env:{}};
      if(name==='./supabase')return {supabase:{functions:{invoke:async()=>({data:{ok:true,status:200,body:{Items:providerItems}},error:null})}}};
      if(name==='./confirmedBookMetadata')return {getConfirmedBookMetadata:async()=>null};
      if(name==='./knownBookOverrides')return {getKnownBookCoverOverride:()=>undefined,getKnownIsbnCoverOverride:()=>undefined};
      if(name==='./kana')return {normalizeKanaReading:x=>x};
      if(!name.startsWith('.'))throw Error(name);
      return load(path.resolve(path.dirname(file),name)+'.ts');
    }
  });return exports;
}
const {resolveUserSeriesName:resolve,hasUserSeriesName}=load('src/lib/userSeriesNames.ts');
const base={id:'main',userId:'test',title:'久保さんは僕（モブ）を許さない 1',seriesTitle:'久保さんは僕（モブ）を許さない',status:'unread',volumeKind:'main',publisher:'集英社'};
const fan={title:'GIFT 久保さんは僕（モブ）を許さない 完結記念公式ファンブック',seriesTitle:'GIFT 久保さんは僕（モブ）を許さない',volumeKind:'extra',status:'unread',publisher:'集英社'};
assert.equal(resolve([base],fan).seriesTitle,base.seriesTitle);
assert.equal(resolve([base],fan).volumeKind,'extra');
assert.equal(hasUserSeriesName(resolve([base],fan)),true,'Keep grouping during later metadata refresh.');
const renamed={...base,seriesTitle:'自分の久保さん',seriesAliases:[base.seriesTitle]};
assert.equal(resolve([renamed],fan).seriesTitle,renamed.seriesTitle);
assert.equal(resolve([base],{...fan,publisher:'別の出版社'}).seriesTitle,fan.seriesTitle);
assert.equal(resolve([base],{...fan,volumeKind:'main'}).seriesTitle,fan.seriesTitle,'Manual main classification is respected.');
const ordinary={...fan,title:'久保さんは僕（モブ）を許さない 2'};
assert.equal(resolve([base],ordinary).seriesTitle,ordinary.seriesTitle,'An explicit extra flag alone does not justify grouping unrelated source metadata.');
assert.equal(resolve([base,{...renamed,seriesTitle:'別グループ'}],fan).seriesTitle,fan.seriesTitle,'Ambiguous destinations remain unchanged.');
const {findDuplicateBook}=load('src/lib/duplicate.ts');
const main1={...base,volumeNumber:1};
const extra1={...resolve([base],fan),id:'extra',volumeNumber:1};
assert.equal(findDuplicateBook([main1],extra1),undefined,'A companion volume 1 is not the main volume 1.');
assert.equal(findDuplicateBook([extra1],main1),undefined);
assert.equal(findDuplicateBook([extra1],extra1).id,'extra');
assert.equal(findDuplicateBook([extra1],{...extra1,title:'久保さんは僕（モブ）を許さない 公式ガイドブック'}),undefined);
const api=load('src/lib/bookApis.ts');
assert.equal(api.findLatestVolumeFromTitles(['ヒットマン 13','今日からヒットマン 31','ヒットマン 公式ファンブック 14','ヒットマンREBORN 42'],'ヒットマン'),13);
assert.equal(api.findLatestVolumeFromTitles(['ワールドトリガー 29','WORLD TRIGGER 30'],'ワールドトリガー'),30);
assert.equal((await api.lookupLatestSeriesPublication('ヒットマン')).latestVolume,13);
assert.equal((await api.lookupLatestSeriesPublication('ヒットマン')).isCompleted,true);
const verified=load('src/lib/verifiedSeriesPublication.ts').verifiedSeriesPublication;
assert.equal(verified('今日からヒットマン'),undefined);
providerItems=[{Item:{title:'双星の陰陽師 1',isbn:'9784088800158'}},{Item:{title:'双星の陰陽師 2',isbn:'9784088800998'}}];
const candidates=await api.searchBookCandidates('双星の陰陽師');
const mainCandidates=candidates.filter(book=>book.volumeKind!=='extra');
assert.equal(mainCandidates.length,2,'Two providers deduplicate identical ISBNs, while keeping separate volumes.');
assert.equal(mainCandidates[0].volumeNumber,1);assert.equal(mainCandidates[1].volumeNumber,2);
console.log('Related volumes: personal names, classification, publisher, ambiguity and refresh protection; publication: exact title and publisher correction; manual search: volumes and ISBN deduplication: OK');

const companions=load('src/lib/knownCompanionBooks.ts');
const formats=load('src/lib/bookFormat.ts');
const kinds=load('src/lib/volumeKind.ts');
for(const [i,isbn] of ['9784087032925','9784087033076','9784087033557'].entries()) {
  const book=await api.lookupBookByIsbn(isbn);
  assert.equal(book.isbn,isbn); assert.equal(book.volumeNumber,i+1);
  assert.equal(book.volumeKind,'extra');assert.equal(book.bookFormat,'novel');
  assert.ok(book.thumbnailUrl.includes(isbn));
  const personal=resolve([{...base,title:'ニセコイ 1',seriesTitle:'自分のニセコイ',seriesAliases:['ニセコイ'],bookFormat:'comic'}],book);
  assert.equal(personal.seriesTitle,'自分のニセコイ');
  assert.equal(findDuplicateBook([{...base,title:'ニセコイ 1',seriesTitle:'ニセコイ',volumeNumber:1}],book),undefined);
}
assert.equal(companions.knownCompanionByIsbn('9784086198103'),undefined,'Actual main comic volume 13 remains unchanged.');
for(const title of ['ニセコイ（1）ウラバナ','ニセコイ ウラバナ ３','ニセコイ ウラバナ1 集英社文庫(コミック版)']) {
  assert.equal(companions.isNisekoiUrabanaTitle(title),true);
  assert.equal(kinds.inferVolumeKindFromText(title),'extra');
  assert.equal(formats.inferBookFormat({title}),'novel');
}
assert.equal(companions.isNisekoiUrabanaTitle('別作品 ウラバナ'),false);
assert.equal((await api.lookupBookByTitle('ニセコイ ウラバナ 1 文庫版')).isbn,'9784086198127');
assert.equal(await api.lookupBookByTitle('ニセコイ ウラバナ 3 文庫版'),null);
assert.equal(await api.lookupBookByTitle('ニセコイ ウラバナ 13'),null);
assert.equal(await api.lookupBookByTitle('ニセコイ ウラバナ 1','9784086198103'),null);
assert.equal((await api.searchBookCandidates('ニセコイ ウラバナ')).length,5);
const sparse={title:'ニセコイ ウラバナ',isbn:'9784087032925',status:'unread'};
assert.equal(api.mergeBookMetadata(sparse,{title:'ニセコイ 13',isbn:'9784086198103',volumeNumber:13}).volumeNumber,undefined);
assert.equal(api.mergeBookMetadata(sparse,{...sparse,volumeNumber:1}).volumeNumber,1);
assert.equal(api.mergeBookMetadata(sparse,{title:'ニセコイ 13',volumeNumber:13}).volumeNumber,undefined);
console.log('Urabana: exact original ISBNs, separate paperback editions, novel/extra classification, personal grouping, and mismatched metadata rejection: OK');

for(const [isbn,subtitle] of [['9784087034028','天縁若虎'],['9784087034158','士牙繭闢'],['9784087034677','三天破邪']]) {
 const book=await api.lookupBookByIsbn(isbn);
 assert.equal(book.bookFormat,'novel');assert.equal(book.volumeKind,'extra');assert.equal(book.seriesTitle,'双星の陰陽師');
 assert(book.title.includes(subtitle));assert.equal(book.volumeNumber,undefined,'Standalone subtitles must not inherit comic volume numbers.');
 assert.equal((await api.lookupBookByTitle(book.title)).isbn,isbn);
}
assert.equal((await api.lookupBookByTitle('ニセコイ 13')).isbn,'9784088801520');
assert.equal((await api.lookupBookByIsbn('9784065130872')).publisher,'講談社');
assert.notEqual((await api.lookupBookByTitle('ニセコイ 13 文庫版'))?.isbn,'9784088801520');
const editionItems=[{Item:{title:'ニセコイ 2',isbn:'paperback',seriesName:'集英社文庫 コミック版',largeImageUrl:'https://cover/paper'}},{Item:{title:'ニセコイ 2',isbn:'regular',seriesName:'ジャンプコミックス',largeImageUrl:'https://cover/normal'}}];
assert.equal(api.selectRakutenItem(editionItems,{seriesTitle:'ニセコイ',volumeNumber:2,edition:'standard'}).isbn,'regular');
assert.equal(api.selectRakutenItem(editionItems,{isbn:'missing-exact'}),undefined);
assert.equal(api.selectRakutenItem(editionItems.slice(0,1),{seriesTitle:'ニセコイ',volumeNumber:2,edition:'standard'}),undefined);
console.log('Publisher novels preserve subtitles/parent/format; standard edition searches reject paperback substitutions and mismatched ISBNs: OK');

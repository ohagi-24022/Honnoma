import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const cache=new Map();
let rakutenItems=[];
function load(file){
  file=path.resolve(file);if(cache.has(file))return cache.get(file);
  const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{
    exports,console,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,
    require:name=>{
      if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
      if(name==='react-native')return {Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:v=>v}};
      if(name.endsWith('/ThemeContext'))return {useAppTheme:()=>({colors:{}})};
      if(name==='./supabase')return {supabase:{functions:{invoke:async()=>({data:{ok:true,status:200,body:{Items:rakutenItems}},error:null})}}};
      if(name==='./env')return {env:{}};
      if(name==='./confirmedBookMetadata')return {getConfirmedBookMetadata:async()=>null};
      if(name==='./knownBookOverrides')return {getKnownBookCoverOverride:()=>undefined,getKnownIsbnCoverOverride:()=>undefined};
      if(name==='./kana')return {normalizeKanaReading:s=>s};
      if(!name.startsWith('.'))throw Error(name);
      const base=path.resolve(path.dirname(file),name);return load(fs.existsSync(base+'.ts')?base+'.ts':base+'.tsx');
    }
  });return exports;
}
const format=load('src/lib/bookFormat.ts');
assert.equal(format.inferBookFormat({title:'普通の書名',size:9}),'comic');
assert.equal(format.inferBookFormat({title:'普通の書名',size:'コミック'}),'comic');
assert.equal(format.inferBookFormat({title:'Novelty collection'}),'unknown');
assert.equal(format.inferBookFormat({title:'普通の書名',labels:['Comics & Graphic Novels']}),'comic');
assert.equal(format.inferBookFormat({title:'小説 化物語'}),'novel');
assert.equal(format.inferBookFormat({title:'小説家になる方法'}),'unknown');
assert.equal(format.inferBookFormat({title:'普通の書名',labels:['Fiction'],size:2}),'unknown','Paperback or generic Fiction does not prove a novel.');
assert.equal(format.resolveBookFormat({title:'コミック Something',bookFormat:'novel'}),'novel','Manual classification wins.');
assert.equal(format.inferBookFormat({isbn:'9784832273146'}),'comic');
const kinds=load('src/lib/volumeKind.ts');
for(const title of ['がっこうぐらし！〜おたより〜','がっこうぐらし! : おたより','がっこうぐらし！ ～おたより～'])assert.equal(kinds.inferVolumeKindFromText(title),'extra');
assert.equal(kinds.inferVolumeKindFromText('がっこうぐらし！ 12'),'main');
assert.equal(kinds.inferVolumeKindFromText('季節のおたより'),'main','Do not classify every title containing おたより as a companion.');
const resolve=load('src/lib/userSeriesNames.ts').resolveUserSeriesName;
const main={id:'main',userId:'u',title:'がっこうぐらし！ 1',seriesTitle:'がっこうぐらし！',volumeNumber:1,volumeKind:'main',bookFormat:'comic',publisher:'芳文社',status:'read',createdAt:''};
const companion={title:'がっこうぐらし! : おたより',seriesTitle:'がっこうぐらし! : おたより',volumeKind:'extra',bookFormat:'comic',publisher:'芳文社',status:'unread'};
assert.equal(resolve([main],companion).seriesTitle,main.seriesTitle);
const {findDuplicateBook}=load('src/lib/duplicate.ts');
assert.equal(findDuplicateBook([main],{...main,isbn:undefined,bookFormat:'novel'}),undefined);
assert.equal(findDuplicateBook([main],main).id,main.id);
const renamed={...main,seriesTitle:'自分の本',seriesAliases:[main.seriesTitle]};
assert.equal(resolve([renamed],{...main,bookFormat:'novel'}).seriesTitle,main.seriesTitle,'Do not borrow comic rename aliases for a novel.');
// Real provider fields survive book search, with no extra classification request.
const api=load('src/lib/bookApis.ts');
rakutenItems=[{Item:{isbn:'comic',title:'候補 1',size:'コミック',seriesName:'KRコミックス'}},{Item:{isbn:'novel',title:'候補 1',seriesName:'電撃文庫'}}];
const candidates=await api.searchBookCandidates('候補');
assert.equal(candidates.find(book=>book.isbn==='comic').bookFormat,'comic');
assert.equal(candidates.find(book=>book.isbn==='novel').bookFormat,'novel');
// Execute the actual home filtering and grouping expressions for both display modes.
const source=fs.readFileSync('app/(tabs)/index.tsx','utf8');
const ast=ts.createSourceFile('home.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const helperNames=new Set(['getActiveFilters','getMetadataFilter','getSelectedMetadataFilters','toggleFilterValue']);
const helpers=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&helperNames.has(node.name?.text)).map(node=>node.getText(ast)).join('\n');
const formatsSource=source.slice(source.indexOf('  const formatFilter ='),source.indexOf('  const [viewMode,'));
const visibleSource=source.slice(source.indexOf('  const visibleGroups = useMemo'),source.indexOf('  const selectedMetadataFilters'));
const selectCode=ts.transpileModule(`(()=>{${formatsSource}\n${visibleSource}\nreturn {visibleBooks,visibleGroups,formatBooks};})()`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const helperCode=ts.transpileModule(helpers,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const {buildSeriesGroups}=load('src/lib/seriesSelectors.ts');
const {normalizeSeriesKey}=load('src/lib/series.ts');
const books=[{...main,id:'comic'}, {...main,id:'novel',bookFormat:'novel'}, {...main,id:'unknown',bookFormat:'unknown',seriesTitle:'未分類作品'}];
const context={...format,useMemo:fn=>fn(),books,seriesGroups:buildSeriesGroups(books),buildSeriesGroups,filters:[],normalizeSeriesKey,
 readingFilters:['read','unread','reading'],query:'',seriesStats:new Map(),effectivePublicationCache:{},favoriteSeriesKeySet:new Set(),readingCorrections:new Map(),
 seriesSort:'recent',seriesSortDirection:'asc',bookSort:'recent',bookSortDirection:'asc',
 compareText:(a='',b='')=>a.localeCompare(b),normalizeText:text=>text.toLowerCase(),applySortDirection:n=>n};
vm.createContext(context);vm.runInContext(helperCode,context);
for(const [filter,id] of [['comic','comic'],['novel','novel'],['unknown','unknown']]){
 context.filters=[`format:${filter}`];const result=vm.runInContext(selectCode,context);
 assert.equal(result.visibleBooks.length,1);assert.equal(result.visibleBooks[0].id,id);
 assert.equal(result.visibleGroups.length,1);assert.equal(result.visibleGroups[0].representative.id,id,'The series cover must come from the filtered format.');
}
context.filters=['all'];assert.equal(vm.runInContext(selectCode,context).visibleBooks.length,3);
const toggled=vm.runInContext("toggleFilterValue(['unread','format:comic'],'format:novel')",context);
assert.deepEqual(Array.from(toggled),['unread','format:novel']);
context.filters=['format:novel','unread'];assert.equal(vm.runInContext(selectCode,context).visibleBooks.length,0,'Reading status and format combine.');
// The shared control emits user-selected formats and marks selection accessibly.
const {BookFormatControl}=load('src/components/BookFormatControl.tsx');let selected;
const tree=BookFormatControl({label:'本の種類',value:'comic',includeAll:true,onChange:value=>{selected=value;}});
function nodes(node){if(!node||typeof node!=='object')return[];return[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];}
const controls=nodes(tree).filter(node=>node.type==='Pressable');assert.equal(controls.length,4);
const novel=controls.find(node=>node.props.accessibilityLabel==='本の種類：小説');novel.props.onPress();assert.equal(selected,'novel');
assert.equal(controls.find(node=>node.props.accessibilityLabel==='本の種類：コミック').props.accessibilityState.checked,true);
console.log('Book formats: provider hints, unknown safety, manual priority, ISBN/companion recognition, cross-format duplicates, home series/book filters, filter combinations, accessible controls: OK');

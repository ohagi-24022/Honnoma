import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import ts from 'typescript';
const modules=new Map();function load(file){file=path.resolve(file);if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>load(path.resolve(path.dirname(file),name)+'.ts')});return exports;}
const {planAutomaticLibraryOrganization:plan}=load('src/lib/libraryOrganization.ts');
const base={id:'a',title:'りゅうおうのおしごと! 2',seriesTitle:'りゅうおうのおしごと!',volumeNumber:2,status:'unread',createdAt:'',userId:'owner'};
const novel={...base,id:'novel',isbn:'9784797386769'};
const comic={...base,id:'comic',isbn:'9784757549920'};
const unknown={...base,id:'unknown',title:'情報のない本',seriesTitle:'情報のない本',bookFormat:'unknown'};
const manual={...comic,id:'manual',bookFormat:'novel'};
const custom={...base,id:'custom',title:'ニセコイ ウラバナ 1',isbn:'9784087032925',seriesTitle:'自分のシリーズ',seriesAliases:['ニセコイ'],bookFormat:'novel',volumeKind:'extra'};
const books=[novel,comic,unknown,manual,custom];const result=plan(books);
assert.equal(result.find(x=>x.id==='novel').patch.bookFormat,'novel');assert.equal(result.find(x=>x.id==='comic').patch.bookFormat,'comic');
assert(!result.some(x=>x.id==='unknown'));assert(!result.some(x=>x.id==='manual'&&x.patch.bookFormat));assert(!result.some(x=>x.id==='custom'&&x.patch.seriesTitle));
const source=fs.readFileSync('src/store/LibraryContext.tsx','utf8');
const effect=source.slice(source.indexOf('  const organizationAttempts = useRef'),source.indexOf('  const seriesGroups ='));
const code=ts.transpileModule(`(()=>{${effect}})()`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const callbacks=[],cleanups=[],writes=[],attempts=new Set();let timerId=0;
const context={useRef:()=>({current:attempts}),useEffect:fn=>cleanups.push(fn()),hydrated:true,loading:false,initializing:false,user:{id:'owner'},books,planAutomaticLibraryOrganization:plan,
 updateBook:async(id,patch)=>writes.push({id,patch}),setTimeout:fn=>{callbacks.push(fn);return ++timerId;},clearTimeout:()=>{}};
vm.runInNewContext(code,context);await callbacks.shift()();assert.equal(writes.length,result.length,'The actual library effect performs organization automatically.');
vm.runInNewContext(code,context);assert.equal(callbacks.length,0,'A repeated failed or unchanged plan never spins on every render.');
const settings=fs.readFileSync('app/(tabs)/settings.tsx','utf8');assert(!settings.includes('本棚の整理'));assert(!settings.includes('表紙・紹介文を表示'));assert(!settings.includes('setShowBookContent'));
const provider=fs.readFileSync('src/store/AppSettingsContext.tsx','utf8');
const hydration=provider.slice(provider.indexOf('        setDeviceSettings({'),provider.indexOf('      })',provider.indexOf('        setDeviceSettings({')));
let restored;vm.runInNewContext(ts.transpileModule(hydration,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{setDeviceSettings:value=>restored=value,cleanDeviceSettings:{showBookContent:false},defaultDeviceSettings:{trackPurchasePrices:false}});assert.equal(restored.showBookContent,true,'Previously saved OFF must not leave books permanently hidden after the toggle is removed.');
console.log('Automatic organization: actual effect, exact comic/novel ISBNs, no blind comic default, custom names/manual types, no retry loop; settings removed and legacy OFF migrated: OK');

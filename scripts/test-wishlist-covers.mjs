import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const cache=new Map();
function load(file,mocks={}) {
  const name=path.resolve(file);if(cache.has(name))return cache.get(name);
  const exports={};cache.set(name,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(name,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{
    exports,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,console,
    require:(dep)=>dep in mocks?mocks[dep]:load(path.resolve(path.dirname(name),dep)+'.ts',mocks),
  });return exports;
}
const {normalizeCoverIsbn,wishlistCoverIdentity,resolveWishlistCover}=load('src/lib/wishlistCover.ts');
const isbn='9784088800158',raw='https://thumbnail.image.rakuten.co.jp/@0_mall/book/cabinet/0158/'+isbn+'.jpg?_ex=200x200';
assert.equal(normalizeCoverIsbn('0306406152'),'9780306406157');
assert.equal(normalizeCoverIsbn('９７８４０８８８００１５８'),isbn);
assert.equal(normalizeCoverIsbn('9784088800159'),undefined);
assert.equal(wishlistCoverIdentity({coverUrl:raw}).isbn,isbn);
assert.equal(wishlistCoverIdentity({coverUrl:raw.replace('rakuten.co.jp','attacker.test')}).isbn,undefined);
const book={id:'one',userId:'local',title:'双星の陰陽師 1',seriesTitle:'双星の陰陽師',volumeNumber:1,isbn,thumbnailUrl:raw,status:'read',createdAt:''};
assert.equal(resolveWishlistCover({title:'双星の陰陽師'},[book]).isbn,isbn);
assert.equal(resolveWishlistCover({title:'陰陽師'},[book]).isbn,undefined,'Never borrow a similarly named work cover.');
const chosen={title:'双星の陰陽師',isbn:'9784088827315',coverUrl:'https://example.test/chosen.jpg'};
assert.equal(resolveWishlistCover(chosen,[book]).isbn,chosen.isbn,'Keep the explicitly selected publication.');
assert.equal(resolveWishlistCover({title:book.seriesTitle},[book,{...book,isbn:'9784088827315'}]).isbn,undefined,'Conflicting first-volume editions require a choice.');

// Real provider search: ISBN must survive conversion and series candidate merging.
const api=load('src/lib/bookApis.ts',{
  './env':{env:{}},'./kana':{normalizeKanaReading:x=>x},'./confirmedBookMetadata':{getConfirmedBookMetadata:async()=>null},
  './knownBookOverrides':{getKnownBookCoverOverride:()=>undefined,getKnownIsbnCoverOverride:()=>undefined},
  './supabase':{supabase:{functions:{invoke:async()=>({data:{ok:true,status:200,body:{Items:[{Item:{isbn,title:'双星の陰陽師 1',largeImageUrl:raw}}]}},error:null})}}},
});
const candidates=await api.searchSeriesCandidates('双星の陰陽師');
assert.equal(candidates[0].isbn,isbn);

// Real wishlist store: search identity survives saving, cloud payloads, editing,
// a restart/hydration and the deletion/undo input path.
let user={id:'fixture-user'},slot=0,refSlot=0;
const states=[],refs=[],effects=[],writes=[],storage=new Map();
const cloud=[{id:'cloud-item',title:book.seriesTitle,normalized_title:book.seriesTitle,score:75,cover_url:raw,isbn,created_at:'2026-10-17',updated_at:'2026-10-17'}];
const client={from:()=>({
  select:()=>({eq:async()=>({data:cloud,error:null})}),
  upsert:async(value)=>{writes.push(value);return {error:null}},
  delete:()=>({eq:()=>({eq:async()=>({error:null}),in:async()=>({error:null})})}),
})};
const react={createContext:()=>({Provider:'Provider'}),useCallback:x=>x,useMemo:fn=>fn(),useEffect:fn=>effects.push(fn),
  useState:initial=>{const i=slot++;if(!(i in states))states[i]=initial;return [states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next;}]},
  useRef:initial=>{const i=refSlot++;return refs[i]??={current:initial}}};
const jsx=(type,props)=>({type,props});
const {WishlistProvider}=load('src/store/WishlistContext.tsx',{
  react,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{AppState:{addEventListener:()=>({remove(){}})}},
  '@react-native-async-storage/async-storage':{setItem:async(k,v)=>storage.set(k,v)},
  '../lib/asyncStorageCompat':{getStorageItemWithLegacy:async(k)=>storage.get(k)??null},
  '../lib/supabase':{supabase:client},'./AuthContext':{useAuth:()=>({user})},
});
function renderStore(){slot=0;refSlot=0;effects.length=0;return WishlistProvider({children:null}).props.value;}
let store=renderStore();effects[0]();await new Promise(r=>setTimeout(r,0));
store=renderStore();assert.equal(store.items[0].isbn,isbn);
store.addItem({title:'新しい候補',score:75,isbn,coverUrl:raw});
store=renderStore();const added=store.items.find(x=>x.title==='新しい候補');
assert.equal(added.isbn,isbn);assert.equal(writes.at(-1).isbn,isbn);
store.updateItem(added.id,{score:90});store=renderStore();assert.equal(store.items.find(x=>x.id===added.id).isbn,isbn);
const undo={...store.items.find(x=>x.id===added.id)};store.deleteItem(added.id);store=renderStore();store.addItem(undo);store=renderStore();assert.equal(store.items.find(x=>x.title===undo.title).isbn,isbn);
for(const effect of [...effects])effect();await new Promise(r=>setTimeout(r,0));
assert.ok([...storage.values()].some(text=>text.includes(isbn)));

// Real screen: both list cards and search-result cards pass ISBN into BookCover.
let uiSlot=0,uiRef=0;const uiStates=[],uiRefs=[],submitted=[];
const uiReact={useCallback:x=>x,useMemo:fn=>fn(),useState:v=>{const i=uiSlot++;if(!(i in uiStates))uiStates[i]=v;return [uiStates[i],n=>{uiStates[i]=typeof n==='function'?n(uiStates[i]):n}]},useRef:v=>{const i=uiRef++;return uiRefs[i]??={current:v}}};
const native=Object.fromEntries(['View','Text','Pressable','ScrollView','TextInput'].map(x=>[x,x]));
native.StyleSheet={create:x=>x};native.Animated={Value:function(){this.setValue=()=>{}},View:'Animated.View',timing:()=>({start(){}})};native.Alert={alert(){}};
const {default:Screen}=load('app/(tabs)/wishlist.tsx',{
  react:uiReact,'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':native,
  'expo-router/react-navigation':{useScrollToTop(){}},'@expo/vector-icons/Ionicons':'Icon','expo-web-browser':{},
  '../../src/components/BookCover':{BookCover:'BookCover'},
  '../../src/lib/bookApis':{searchSeriesCandidates:async()=>candidates,buildPurchaseUrl:()=>''},
  '../../src/store/AppSettingsContext':{useAppSettings:()=>({})},'../../src/store/LibraryContext':{useLibrary:()=>({books:[]})},
  '../../src/store/ThemeContext':{useAppTheme:()=>({colors:{}})},
  '../../src/store/WishlistContext':{useWishlist:()=>({items:[{...book,coverUrl:raw,score:75,updatedAt:''}],addItem:x=>submitted.push(x)})},
});
const nodes=t=>!t||typeof t!=='object'?[]:[t,...[t.props?.children].flat(Infinity).flatMap(nodes)];
function renderScreen(){uiSlot=0;uiRef=0;return Screen();}
let tree=renderScreen();assert(nodes(tree).filter(n=>n.type==='BookCover').every(n=>n.props.isbn===isbn && n.props.displayContext==='personal'));
nodes(tree).find(n=>n.props?.accessibilityLabel==='欲しい漫画の追加パネルを開く').props.onPress();tree=renderScreen();
nodes(tree).find(n=>n.type==='TextInput'&&n.props.placeholder==='作品名、シリーズ名').props.onChangeText(book.seriesTitle);tree=renderScreen();
await nodes(tree).find(n=>n.type==='TextInput'&&n.props.placeholder==='作品名、シリーズ名').props.onSubmitEditing();await new Promise(r=>setTimeout(r,0));tree=renderScreen();
assert.equal(nodes(tree).filter(n=>n.type==='BookCover').length,3);
assert(nodes(tree).filter(n=>n.type==='BookCover').every(n=>n.props.isbn===isbn && n.props.displayContext==='personal'));
nodes(tree).find(n=>n.props?.accessibilityLabel==='欲しい漫画に追加').props.onPress();assert.equal(submitted[0].isbn,isbn);
console.log('Wishlist covers: ISBN from provider to search cards, selected item, local/cloud persistence, list cards, legacy URL, undo, exact-title fallback and edition ambiguity: OK');

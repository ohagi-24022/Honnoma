import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync('src/components/OnboardingGate.tsx','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
}).outputText;
const key=id=>`honnoma.onboarding.login.v1:${id}`;
function harness({initialPath='/settings',seen=false,ready=true}={}){
  let user={id:'first-user'},recoveryReady=false,pathname=initialPath,navReady=ready,focus=null,dirty=true,slot=0,effectSlot=0,tree;
  const states=[],effects=[],pendingEffects=[],routes=[],storage=new Map(seen?[[key(user.id),'seen']]:[]);
  const pendingReads=new Map();
  const setFocus=value=>{focus=value;};
  const native=Object.fromEntries(['Modal','Pressable','ScrollView','Text','View'].map(name=>[name,name]));
  native.StyleSheet={create:value=>value};native.useWindowDimensions=()=>({height:844,width:390});
  const mocks={
    '@react-native-async-storage/async-storage':{setItem:async(k,v)=>storage.set(k,v)},
    '@expo/vector-icons/Ionicons':'Icon',
    'expo-router':{usePathname:()=>pathname,useRootNavigationState:()=>navReady?{key:'root'}:undefined,
      router:{replace:route=>{routes.push(route);pathname=route.replace('/(tabs)','')||'/';dirty=true;}}},
    react:{useState:initial=>{const i=slot++;if(!(i in states))states[i]=initial;return[states[i],value=>{const next=typeof value==='function'?value(states[i]):value;if(!Object.is(next,states[i])){states[i]=next;dirty=true;}}];},
      useEffect:(fn,deps)=>{const i=effectSlot++,old=effects[i];if(!old || deps.some((value,index)=>!Object.is(value,old.deps[index]))){
        effects[i]={deps,cleanup:old?.cleanup};pendingEffects.push(()=>{effects[i].cleanup?.();effects[i].cleanup=fn();});
      }}},
    'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
    'react-native':native,
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({bottom:34})},
    '../lib/asyncStorageCompat':{getStorageItemWithLegacy:async(k,legacy)=>pendingReads.has(k)?pendingReads.get(k):(storage.get(k)??storage.get(legacy)??null)},
    '../store/AuthContext':{useAuth:()=>({user,recoveryReady})},
    '../store/OnboardingContext':{useOnboardingTour:()=>({focus,setFocus})},
    '../store/ThemeContext':{useAppTheme:()=>({colors:{}})},
  };
  const exports={};vm.runInNewContext(code,{exports,console,require:name=>{assert(name in mocks,name);return mocks[name];}});
  async function render(){dirty=true;for(let count=0;count<30;count++){
    dirty=false;slot=0;effectSlot=0;tree=exports.OnboardingGate();
    while(pendingEffects.length)pendingEffects.shift()();
    await new Promise(resolve=>setTimeout(resolve,0));
    if(!dirty)return tree;
  }throw Error('Render loop');}
  function nodes(node){if(!node||typeof node!=='object')return[];return[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];}
  const button=label=>nodes(tree).find(node=>node.type==='Pressable'&&node.props.accessibilityLabel===label);
  return {render,button,routes,storage,pendingReads,get tree(){return tree;},get focus(){return focus;},get pathname(){return pathname;},
    auth:(next,recovery=false)=>{user=next;recoveryReady=recovery;},path:value=>{pathname=value;},ready:value=>{navReady=value;},
    unmount:()=>effects.forEach(effect=>effect.cleanup?.())};
}
const first=harness();await first.render();assert.equal(first.focus,'shelf');assert.equal(first.pathname,'/');
first.button('次へ').props.onPress();await first.render();assert.equal(first.focus,'scan');assert.equal(first.pathname,'/scan');
const routeCount=first.routes.length;
first.button('次へ').props.onPress();await first.render();assert.equal(first.focus,'series');assert.equal(first.routes.length,routeCount,'Same-screen explanation highlights the entry without another navigation.');
first.button('前の案内へ戻る').props.onPress();await first.render();assert.equal(first.focus,'scan');
first.button('次へ').props.onPress();await first.render();
first.button('次へ').props.onPress();await first.render();assert.equal(first.focus,'wishlist');assert.equal(first.pathname,'/wishlist');
first.button('次へ').props.onPress();await first.render();assert.equal(first.focus,'settings');assert.equal(first.pathname,'/settings');
first.button('本を登録する').props.onPress();await first.render();assert.equal(first.tree,null);assert.equal(first.focus,null);assert.equal(first.pathname,'/scan');assert.equal(first.storage.get(key('first-user')),'seen');
const old=harness({seen:true});await old.render();assert.equal(old.tree,null);assert.equal(old.routes.length,0,'Existing completed tours must not run again.');
const waiting=harness({ready:false});await waiting.render();assert.equal(waiting.tree,null);assert.equal(waiting.routes.length,0);waiting.ready(true);await waiting.render();assert.equal(waiting.focus,'shelf');
const recovery=harness({initialPath:'/auth-callback'});await recovery.render();assert.equal(recovery.tree,null);assert.equal(recovery.routes.length,0);
recovery.path('/reset-password');recovery.auth({id:'first-user'},true);await recovery.render();assert.equal(recovery.tree,null);
recovery.path('/settings');recovery.auth({id:'first-user'});await recovery.render();assert.equal(recovery.focus,'shelf');
recovery.button('オンボーディングをスキップ').props.onPress();await recovery.render();assert.equal(recovery.tree,null);assert.equal(recovery.focus,null);assert.equal(recovery.storage.get(key('first-user')),'seen');
const switched=harness();await switched.render();
let release;switched.pendingReads.set(key('second-user'),new Promise(resolve=>{release=resolve;}));
switched.auth({id:'second-user'});await switched.render();assert.equal(switched.tree,null);assert.equal(switched.focus,null);
switched.storage.set(key('third-user'),'seen');switched.auth({id:'third-user'});await switched.render();
release(null);await switched.render();assert.equal(switched.tree,null,'A stale account lookup cannot reopen the guide for a different account.');
const logout=harness();await logout.render();logout.auth(null);await logout.render();assert.equal(logout.tree,null);assert.equal(logout.focus,null);
logout.unmount();assert.equal(logout.focus,null);
console.log('Onboarding: screen navigation, series entry, previous/next, skip/finish persistence, seen accounts, navigator readiness, recovery protection, stale account reads and logout cleanup: OK');

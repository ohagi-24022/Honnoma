import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function compile(file, require) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require });
  return exports;
}
let value, currentUser = { id: 'user-a' }, slot = 0, refSlot = 0;
const states = [], refs = [], effects = [];
const jsx = (type, props) => ({ type, props });
const { RegistrationProgressProvider } = compile('src/store/RegistrationProgressContext.tsx', (name) => {
  if (name === 'react') return {
    createContext: () => ({ Provider: 'Provider' }), useCallback: (fn) => fn,
    useState: (initial) => { const i = slot++; if (!(i in states)) states[i] = initial; return [states[i], (next) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; },
    useRef: (initial) => { const i = refSlot++; return refs[i] ??= { current: initial }; },
    useEffect: (fn) => effects.push(fn),
  };
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (name === './AuthContext') return { useAuth: () => ({ user: currentUser }) };
  throw Error(name);
});
function renderProvider() { slot = 0; refSlot = 0; effects.length = 0; value = RegistrationProgressProvider({ children: 'Any route' }).props.value; return value; }
const alerts = [];
const { RegistrationProgressBanner } = compile('src/components/RegistrationProgressBanner.tsx', (name) => {
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (name === 'react-native') return { ActivityIndicator: 'ActivityIndicator', Text: 'Text', View: 'View', Pressable: 'Pressable', Alert: { alert: (...args) => alerts.push(args) }, StyleSheet: { create: (v) => v } };
  if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 34 }) };
  if (name.endsWith('RegistrationProgressContext')) return { useRegistrationProgress: () => value };
  if (name.endsWith('ThemeContext')) return { useAppTheme: () => ({ colors: {} }) };
  throw Error(name);
});
const nodes = (tree) => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const text = (tree) => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : text(tree?.props?.children ?? '');
renderProvider();
assert.equal(RegistrationProgressBanner(), null);
const id = value.begin('化物語', 3);
assert.throws(() => value.begin('別作品', 2), /進行中/);
renderProvider();
let banner = RegistrationProgressBanner();
assert.ok(nodes(banner).some((n) => n.type === 'ActivityIndicator'));
assert.match(text(banner), /0／3冊/);
value.update(id, { completed: 1, currentTitle: '化物語 6', added: 1 });
// Route changes do not unmount the provider: render another child screen and
// keep the same active operation and completed count.
renderProvider(); banner = RegistrationProgressBanner();
assert.match(text(banner), /1／3冊/);
assert.match(text(banner), /化物語 6/);
value.dismiss(); renderProvider(); assert.ok(value.job, 'A running operation cannot be hidden accidentally.');
value.finish(id, { added: 1, skipped: 1, failures: [{ title: '化物語 7', message: '通信失敗' }] });
renderProvider(); banner = RegistrationProgressBanner();
assert.ok(!nodes(banner).some((n) => n.type === 'ActivityIndicator'));
assert.match(text(banner), /1冊を追加/);
assert.match(text(banner), /追加できなかった本 1冊/);
const details = nodes(banner).find((n) => n.type === 'Pressable' && text(n).includes('追加できなかった本を確認'));
details.props.onPress(); assert.match(alerts[0][1], /化物語 7: 通信失敗/);
value.dismiss(); renderProvider(); assert.equal(RegistrationProgressBanner(), null);
const next = value.begin('次のシリーズ', 2);
value.update(id, { completed: 99 }); // Late response from previous operation.
value.finish(id, { added: 99, skipped: 0, failures: [] });
renderProvider(); assert.equal(value.job.id, next); assert.equal(value.job.completed, 0);
currentUser = { id: 'user-b' }; renderProvider(); effects[0](); renderProvider();
assert.equal(value.job, null, 'Previous account progress must not leak after switching users.');
value.finish(next, { added: 2, skipped: 0, failures: [] }); renderProvider(); assert.equal(value.job, null);
console.log('Global registration progress: survives route changes, spinner/counts, one active job, completion/error details, dismiss, late responses, account isolation: OK');

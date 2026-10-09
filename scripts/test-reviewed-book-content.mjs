import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compile = (path, require, globals = {}) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require, ...globals });
  return exports;
};
const policy = compile('../src/lib/reviewedBookContent.ts', () => ({}));
const approved = { isbn13: '9784088914763', cover_url: 'https://example.test/approved.jpg', description: 'Reviewed description' };
assert.equal(policy.resolveReviewedContent(false, 'isbn:9784088914763', [approved]), null);
assert.equal(policy.resolveReviewedContent(true, 'isbn:9784088914763', []), null);
assert.equal(policy.resolveReviewedContent(true, 'isbn:9784088914764', [approved]), null);
assert.equal(policy.resolveReviewedContent(true, '', [approved]), null);
assert.equal(policy.resolveReviewedContent(true, 'isbn:9784088914763', [approved]), approved);
assert.equal(policy.contentLookupKey(undefined, 'javascript:alert(1)'), '');

let content = null;
let enabled = true;
let failedUrl = null;
const jsx = (type, props) => ({ type, props });
const { BookCover } = compile('../src/components/BookCover.tsx', (name) => {
  if (name === 'react') return { useState: () => [failedUrl, (value) => { failedUrl = value; }] };
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (name === 'react-native') return { Image: 'Image', View: 'View', Text: 'Text', StyleSheet: { create: (value) => value } };
  if (name.endsWith('BookContentContext')) return { useReviewedBookContent: () => content };
  if (name.endsWith('AppSettingsContext')) return { useAppSettings: () => ({ showBookContent: enabled }) };
  if (name.endsWith('ThemeContext')) return { useAppTheme: () => ({ colors: {} }) };
  throw new Error(`Unexpected import: ${name}`);
});
const input = { isbn: approved.isbn13, thumbnailUrl: 'https://example.test/unreviewed.jpg', preferIsbnCover: true };
assert.equal(BookCover(input).type, 'View'); // Even with ISBN, no automatic external fallback.
content = approved;
const rendered = BookCover(input);
assert.equal(rendered.type, 'Image');
assert.equal(rendered.props.source.uri, approved.cover_url); // User URL cannot replace reviewed cover.
rendered.props.onError();
assert.equal(BookCover(input).type, 'View'); // Failed approved cover never switches provider.
enabled = false;
content = null;
assert.equal(BookCover(input).type, 'View');
console.log('Reviewed rendering: OFF / unknown / changed user URL / image failure => no unreviewed media: OK');

// Exercise the real provider's batched lookup, cache clearing and failure path.
let slot = 0;
const states = [0, []];
const keysRef = { current: new Map() };
const cleanups = [];
let lifecycle;
let networkError = false;
const queries = [];
const client = { from: () => ({ select: () => ({ eq: () => ({ in: (column, values) => {
  queries.push({ column, values });
  return { abortSignal: async () => networkError ? { data: null, error: new Error('offline') } : { data: [approved], error: null } };
} }) }) }) };
const { BookContentProvider } = compile('../src/store/BookContentContext.tsx', (name) => {
  if (name === 'react') return {
    createContext: () => ({ Provider: 'Provider' }), useCallback: (fn) => fn, useRef: () => keysRef,
    useEffect: (fn) => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); },
    useState: (initial) => { const index = slot++; if (states[index] === undefined) states[index] = initial; return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
  };
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (name === 'react-native') return { AppState: { currentState: 'active', addEventListener: (_name, fn) => { lifecycle = fn; return { remove() {} }; } } };
  if (name.endsWith('reviewedBookContent')) return policy;
  if (name.endsWith('bookContentReviewQueue')) return { queueBookContentReviews: async () => {} };
  if (name.endsWith('/supabase')) return { supabase: client };
  if (name.endsWith('AppSettingsContext')) return { useAppSettings: () => ({ hydrated: true, showBookContent: enabled }) };
  throw new Error(name);
}, { setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, AbortController });
const renderProvider = () => { for (const fn of cleanups.splice(0)) fn(); slot = 0; return BookContentProvider({ children: null }).props.value; };
enabled = true;
const provider = renderProvider();
provider.register('isbn:9784088914763');
provider.register('isbn:9784088914763');
provider.register('isbn:9784088914764');
await new Promise((resolve) => setTimeout(resolve, 180));
assert.equal(queries.length, 1);
assert.equal(queries[0].values.length, 2); // Duplicate visible covers share one request.
assert.equal(states[1][0], approved);
lifecycle('background');
assert.equal(states[1].length, 0);
networkError = true;
renderProvider();
await new Promise((resolve) => setTimeout(resolve, 180));
assert.equal(states[1].length, 0);
enabled = false;
const callsBeforeOff = queries.length;
renderProvider();
await new Promise((resolve) => setTimeout(resolve, 180));
assert.equal(queries.length, callsBeforeOff);
for (const fn of cleanups.splice(0)) fn();
console.log('Provider: batching / duplicate requests / background clearing / offline / OFF: OK');

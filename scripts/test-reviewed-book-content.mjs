import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compile = (path, require, globals = {}) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require, URL, ...globals });
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
let lookupState = 'ready';
let enabled = true;
let failedUrls = [];
const jsx = (type, props) => ({ type, props });
const { BookCover } = compile('../src/components/BookCover.tsx', (name) => {
  if (name === 'react') return { useState: () => [failedUrls, (value) => { failedUrls = typeof value === 'function' ? value(failedUrls) : value; }] };
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (name === 'react-native') return { Image: 'Image', View: 'View', Text: 'Text', StyleSheet: { create: (value) => value } };
  if (name.endsWith('reviewedBookContent')) return policy;
  if (name.endsWith('BookContentContext')) return { useReviewedBookContent: () => content, useBookContentLookupState: () => lookupState };
  if (name.endsWith('AppSettingsContext')) return { useAppSettings: () => ({ showBookContent: enabled }) };
  if (name.endsWith('ThemeContext')) return { useAppTheme: () => ({ colors: {} }) };
  throw new Error(`Unexpected import: ${name}`);
});
const input = { isbn: approved.isbn13, thumbnailUrl: 'https://example.test/unreviewed.jpg', preferIsbnCover: true };
const pendingCover=BookCover(input);
assert.equal(pendingCover.type,'Image');
assert.equal(pendingCover.props.source.uri,policy.PENDING_BOOK_COVER_URL);
assert.notEqual(pendingCover.props.source.uri,input.thumbnailUrl);
pendingCover.props.onError();
assert.equal(BookCover(input).type,'View'); // Placeholder failure uses local text.
failedUrls=[];
content = approved;
const rendered = BookCover(input);
assert.equal(rendered.type, 'Image');
assert.equal(rendered.props.source.uri, approved.cover_url); // User URL cannot replace reviewed cover.
rendered.props.onError();
assert.equal(BookCover(input).type, 'View'); // Failed approved cover never switches provider.
enabled = false;
content = null;
assert.equal(BookCover(input).type, 'View');
console.log('Reviewed rendering: hosted pending placeholder, offline fallback, OFF, approved covers, no unreviewed provider media: OK');

// Personal wishlist is explicitly opted in; public screens still fail closed.
enabled=true; content=null; failedUrls=[]; lookupState='loading';
const personalInput={...input,displayContext:'personal'};
assert.equal(BookCover({...personalInput,thumbnailUrl:undefined}).props.children.props.children,'表紙確認中','Private missing covers use the requested neutral placeholder.');
assert.equal(BookCover(personalInput).props.source.uri,input.thumbnailUrl);
lookupState='error';
assert.equal(BookCover(personalInput).props.source.uri,input.thumbnailUrl);
content=approved;
assert.equal(BookCover(personalInput).props.source.uri,approved.cover_url);
content={...approved,cover_url:null};
assert.equal(BookCover(personalInput).props.source.uri,input.thumbnailUrl);
content=null; lookupState='ready';
BookCover(personalInput).props.onError();
assert.equal(BookCover(personalInput).type,'View');
assert.equal(BookCover(personalInput).props.children.props.children,'表紙確認中');
failedUrls=[];
assert.notEqual(BookCover({...personalInput,thumbnailUrl:'file:///private/image.jpg'}).props.source?.uri,'file:///private/image.jpg');
enabled=false;
assert.equal(BookCover(personalInput).type,'View');
assert.equal(BookCover(personalInput).props.children.props.children,'非表示');
enabled=true; content=null; failedUrls=[]; lookupState='ready';
assert.equal(BookCover(input).props.source.uri,policy.PENDING_BOOK_COVER_URL);
console.log('Personal wishlist/search: source cover before review, approved priority, OFF, failure fallback, public isolation: OK');

// A shared ranking card must opt in only for the user's private priority list.
const { RankingCard } = compile('../src/components/RankingCard.tsx', (name) => {
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (name === '@expo/vector-icons/Ionicons') return { default:'Icon' };
  if (name === 'react-native') return { Pressable:'Pressable', View:'View', Text:'Text', StyleSheet:{create:value=>value} };
  if (name.endsWith('ThemeContext')) return { useAppTheme:()=>({colors:{}}) };
  if (name === './BookCover') return { BookCover };
  throw new Error(`Unexpected import: ${name}`);
});
const cardProps={index:0,row:{title:'Test',coverUrl:input.thumbnailUrl}};
const publicCard=RankingCard(cardProps).props.children.find(child=>child?.type===BookCover);
const privateCard=RankingCard({...cardProps,personal:true}).props.children.find(child=>child?.type===BookCover);
assert.equal(publicCard.props.displayContext,'reviewed');
assert.equal(privateCard.props.displayContext,'personal');
assert.equal(BookCover(publicCard.props).props.source.uri,policy.PENDING_BOOK_COVER_URL);
assert.equal(BookCover(privateCard.props).props.source.uri,input.thumbnailUrl);
console.log('Ranking integration: public approval retained; personal priority covers visible: OK');

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
assert.equal(states[2], 'error');
enabled = false;
const callsBeforeOff = queries.length;
renderProvider();
await new Promise((resolve) => setTimeout(resolve, 180));
assert.equal(queries.length, callsBeforeOff);
for (const fn of cleanups.splice(0)) fn();
console.log('Provider: batching / duplicate requests / background clearing / offline / OFF: OK');

const worldTrigger = '9784088708096';
const oldRakutenUrl='https://thumbnail.image.rakuten.co.jp/@0_mall/book/cabinet/8096/9784088708096.jpg?_ex=200x200';
assert.equal(policy.contentLookupKey(undefined,oldRakutenUrl),'isbn:'+worldTrigger);
assert.equal(policy.contentLookupKey(approved.isbn13,oldRakutenUrl),'isbn:'+approved.isbn13,'Explicit ISBN must take priority.');
assert.equal(policy.contentLookupKey(undefined,'https://cover.openbd.jp/'+worldTrigger+'.jpg'),'isbn:'+worldTrigger);
assert.equal(policy.contentLookupKey(undefined,'https://dosbg3xlm0x1t.cloudfront.net/images/items/'+worldTrigger+'/1200/'+worldTrigger+'.jpg'),'isbn:'+worldTrigger);
for(const url of [oldRakutenUrl.replace('rakuten.co.jp','rakuten.co.jp.attacker.test'),oldRakutenUrl.replace('8096.jpg','8097.jpg'),'https://example.test/'+worldTrigger+'.jpg']) assert.ok(policy.contentLookupKey(undefined,url).startsWith('url:'),'Do not infer ISBN from an unknown host or invalid checksum.');
content=null;enabled=true;failedUrls=[];lookupState='error';
let fallback=BookCover(input);assert.equal(fallback.type,'View');assert.equal(fallback.props.children.props.children,'表紙を取得できません');
lookupState='loading';fallback=BookCover(input);assert.equal(fallback.type,'View');assert.equal(fallback.props.children.props.children,'表紙を取得中');
lookupState='ready';assert.equal(BookCover(input).props.source.uri,policy.PENDING_BOOK_COVER_URL);
content={...approved,cover_url:null};fallback=BookCover(input);assert.equal(fallback.props.children.props.children,'No Cover');
console.log('Missing ISBN: validated publisher URL maps to approved ISBN; loading/offline never labelled unreviewed: OK');

content=approved;enabled=true;failedUrls=[];lookupState='ready';
let cover=BookCover({...input,displayContext:'personal'});cover.props.onError();
cover=BookCover({...input,displayContext:'personal'});assert.equal(cover.props.source.uri,input.thumbnailUrl);cover.props.onError();
for(let i=0;i<3;i++){cover=BookCover({...input,displayContext:'personal'});assert.equal(cover.type,'View');assert.equal(cover.props.children.props.children,'表紙確認中');}
assert.equal(BookCover({...input,displayContext:'personal',thumbnailUrl:'https://example.test/new.jpg'}).props.source.uri,'https://example.test/new.jpg');
console.log('Private cover fallback: failed approved source tries personal source once, no retry loop, corrected URL retried: OK');

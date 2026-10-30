import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { parseUrlUsingCustomBase, safeDecodeURIComponent: decode } = require('../node_modules/expo-router/build/utils/url.js');
const params = Object.fromEntries(parseUrlUsingCustomBase('/auth-callback?title=%E3%83%8B%E3%82%BB%E3%82%B3%E3%82%A4&token=a%2Bb%3D&code=abc+def&volume=2').searchParams);
assert.equal(params.title, 'ニセコイ');
assert.equal(params.token, 'a+b=');
assert.equal(params.code, 'abc def');
assert.equal(params.volume, '2');
assert.equal(decode('%E3%81%82%FF%41'), '%E3%81%82%FF%41');
assert.equal(decode('%F0%9F%93%9A'), '📚');
assert.equal(decode('%FE%FF'), '%FE%FF');
const query = new URLSearchParams({ redirect: 'honnoma://account-help?token=a+b=', title: '本の間' });
const roundtrip = parseUrlUsingCustomBase('/auth-callback?' + query).searchParams;
assert.equal(roundtrip.get('title'), '本の間');
assert.equal(roundtrip.get('redirect'), 'honnoma://account-help?token=a+b=');
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
assert(!Object.keys(lock.packages).some(name => /node_modules\/(decode-uri-component|query-string)$/.test(name)));

// Use a separate process with a hard deadline: the vulnerable recursive decoder
// can hang or exhaust its stack on malformed external authentication links.
const result = spawnSync(process.execPath, ['-e', `
  const assert = require('node:assert/strict');
  const { parseUrlUsingCustomBase, safeDecodeURIComponent } = require('./node_modules/expo-router/build/utils/url.js');
  const input = '%41%FF'.repeat(20000);
  assert.equal(safeDecodeURIComponent(input), input);
  const parsed = parseUrlUsingCustomBase('/auth-callback?token=' + input);
  assert.equal(parsed.searchParams.get('token'), 'A\\uFFFD'.repeat(20000));
`], { cwd: process.cwd(), timeout: 3000, encoding: 'utf8' });
assert.ifError(result.error);
assert.equal(result.status, 0, result.stderr);
console.log('URI decoding compatibility and malformed-link regression tests passed.');

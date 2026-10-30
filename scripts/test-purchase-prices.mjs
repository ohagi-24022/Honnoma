import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/purchasePrices.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:api});
assert.equal(api.initialPurchasePriceText({listPrice:594}), '594');
assert.equal(api.initialPurchasePriceText({purchasePrice:110,listPrice:594}), '110');
assert.equal(api.initialPurchasePriceText({purchasePrice:0,listPrice:594}), '0');
assert.equal(api.initialPurchasePriceText({listPrice:0}), '0');
assert.equal(api.initialPurchasePriceText({listPrice:NaN}), '');
assert.equal(api.registrationPurchasePrice({listPrice:594},true),594);
assert.equal(api.registrationPurchasePrice({purchasePrice:100,listPrice:594},true),100);
assert.equal(api.registrationPurchasePrice({purchasePrice:0,listPrice:594},true),0);
assert.equal(api.registrationPurchasePrice({purchasePrice:null,listPrice:594},true),null);
assert.equal(api.registrationPurchasePrice({listPrice:594},false),undefined);
assert.equal(api.registrationPurchasePrice({listPrice:-1},true),undefined);
// Exercise the real series action: each selected volume has its own price,
// unknown prices must not clear an existing payment, and unselected books stay put.
const source=fs.readFileSync('app/series/[title].tsx','utf8');
const start=source.indexOf('  const updateSelectedPurchasePrice =');
const end=source.indexOf('  const toggleAllSelected',start);
const writes=[];let message;
const exports={};
vm.runInNewContext(ts.transpileModule(source.slice(start,end)+'\nexports.run=updateSelectedPurchasePrice;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{
 exports,selectedIds:['one','two','unknown','free'],bulkPurchasePrice:'123',
 ownedItems:[{id:'one',listPrice:594},{id:'two',listPrice:880},{id:'unknown',purchasePrice:200},{id:'free',listPrice:0},{id:'unselected',listPrice:900}],
 hasBookPrice:api.hasBookPrice,updateBook:async(id,patch)=>writes.push({id,...patch}),setBulkPurchasePrice(){},setSelectedIds(){},Alert:{alert:(title,text)=>message={title,text}},
});
await exports.run(true);
assert.deepEqual(writes,[{id:'one',purchasePrice:594},{id:'two',purchasePrice:880},{id:'free',purchasePrice:0}]);
assert(message.text.includes('1冊は変更していません'));
console.log('Purchase prices: retail defaults, existing/zero/manual values preserved, unknown skipped, each selected volume uses its own retail price.');

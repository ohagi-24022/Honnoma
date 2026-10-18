import assert from 'node:assert/strict';
import { notificationActivity, notificationPageSize, loadNotificationActivity, registerNotificationAdmin } from './shushuka-notification-admin.mjs';
const at = '2026-10-16T02:30:06.000Z';
const ops = [
 {id:'start',created_at:at,status:'ok',metadata:{mode:'check',phase:'started'}},
 {id:'done',created_at:at,status:'error',metadata:{mode:'check',phase:'completed',checkedCount:2,newReleaseCount:1,checkResults:[{seriesTitle:'作品B',failed:true}],error:'secret backend error'}},
 {id:'old',created_at:at,status:'ok',metadata:{mode:'check',checkedCount:4}},
 {id:'auth',created_at:at,status:'error',metadata:{reason:'unauthorized'}},
 {id:'health',created_at:at,status:'ok',metadata:{mode:'health'}},
];
const rows = [
 {id:'a',series_key:'a',series_title:'<script>作品A</script>',volume_number:3,created_at:at,status:'sent',delivered_at:null},
 {id:'b',series_key:'a',series_title:'作品A',volume_number:3,created_at:at,status:'failed'},
];
const events=notificationActivity(ops, rows);
assert.equal(events.length,4);
assert.equal(events.filter(x=>x.kind==='release').length,1);
assert.ok(events.find(x=>x.id==='operation:start').message.includes('11:30の新刊確認を開始'));
assert.ok(events.find(x=>x.id==='operation:done').details.includes('『作品B』を確認できませんでした。'));
assert.ok(!events.find(x=>x.id==='operation:old').details.some(x=>x.includes('ありませんでした')),'Legacy totals cannot prove no new releases.');
assert.ok(!JSON.stringify(events).includes('secret backend error'));
assert.ok(events.find(x=>x.kind==='release').details.includes('配信サービス受付済み・到達未確認：1件'));
assert.equal(notificationPageSize(undefined,'honnoma_notification_size=100'),100);
assert.equal(notificationPageSize('50',''),50);
assert.equal(notificationPageSize('500',''),30);
const tables=[];
let fail=false;
const db={from(table){tables.push(table);const chain=new Proxy({}, {get(_,key){if(key==='then')return resolve=>resolve({data:table==='server_operation_logs'?ops:rows,error:fail?{message:'private database error'}:null});return ()=>chain;}});return chain;}};
assert.equal((await loadNotificationActivity(db)).events.length,4);
let handler;
registerNotificationAdmin({get(path,fn){assert.equal(path,'/notifications');handler=fn;}},db,(_title,body)=>body,v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'));
let output='',status=200,cookie;
const res={setHeader(_k,v){cookie=v;},send(v){output=v;return this;},status(v){status=v;return this;}};
await handler({query:{q:'作品A',size:'10',page:'999',kind:'release'},headers:{},secure:true},res);
assert.equal(status,200);assert.ok(cookie.includes('Secure'));
assert.ok(output.includes('&lt;script&gt;作品A&lt;/script&gt;'));
assert.ok(!output.includes('<script>'));
assert.ok(output.includes('1件 ／ 1 / 1ページ'));
assert.ok(!output.includes('11:30の新刊確認を開始'));
fail=true;await handler({query:{},headers:{}},res);
assert.equal(status,503);assert.ok(!output.includes('private database error'));
console.log('Notification history checks passed: Japanese summaries, legacy results, deduplication, delivery states, filters, paging, escaping, unavailable database.');
const progressRows = [
 {id:'s',created_at:'2026-10-16T02:30:00Z',status:'ok',metadata:{mode:'check',runId:'run',phase:'started',stage:'subscriptions'}},
 {id:'p',created_at:'2026-10-16T02:30:01Z',status:'ok',metadata:{mode:'check',runId:'run',phase:'progress',stage:'provider',seriesTitle:'作品C'}},
];
let progressEvents=notificationActivity(progressRows,[],Date.parse('2026-10-16T03:00:00Z'));
assert.equal(progressEvents.find(x=>x.id==='operation:p').state,'中断の可能性');
assert.ok(progressEvents.find(x=>x.id==='operation:p').details.some(x=>x.includes('書籍情報サービスからの取得')));
progressRows.push({id:'c',created_at:'2026-10-16T02:30:05Z',status:'error',metadata:{mode:'check',runId:'run',phase:'completed',checkResults:[{failed:true,seriesTitle:'作品C',stage:'provider',reason:'rate_limit'}]}});
progressEvents=notificationActivity(progressRows,[],Date.parse('2026-10-16T03:00:00Z'));
assert.ok(!progressEvents.some(x=>x.state==='中断の可能性'));
assert.ok(progressEvents.find(x=>x.id==='operation:c').details.some(x=>x.includes('利用回数制限')));
const privateFailure=notificationActivity([], [{...rows[0],status:'failed',last_error:'DeviceNotRegistered token=PRIVATE'}]);
assert.ok(!JSON.stringify(privateFailure).includes('PRIVATE'));
assert.ok(privateFailure[0].details.some(x=>x.includes('端末登録')));
console.log('Progress history checks passed: failure stages, safe reasons, incomplete runs, completed-run correlation.');

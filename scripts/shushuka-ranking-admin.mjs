export const rankingKey = title => String(title ?? '').normalize('NFKC').toLowerCase().replace(/[\s\[\]()]/g, '');
const sizes = [10,30,50,100];
export function rankingPageSize(value, cookie='') {
  const remembered = cookie.match(/(?:^|;\s*)honnoma_ranking_size=(10|30|50|100)(?:;|$)/)?.[1];
  return sizes.includes(Number(value)) ? Number(value) : sizes.includes(Number(remembered)) ? Number(remembered) : 30;
}
async function allRows(db,table,fields,order) {
  const rows=[];
  for(let offset=0;;offset+=1000){
    const {data,error}=await db.from(table).select(fields).order(order,{ascending:true}).range(offset,offset+999);
    if(error)throw error;
    rows.push(...(data??[]));if((data??[]).length<1000)return rows;
  }
}
export async function rankingCandidates(db){
  const [catalog,jobs,covers,aliasRows]=await Promise.all([
    allRows(db,'public_ranking_catalog','*','ranking_key'),
    allRows(db,'book_content_review_jobs','isbn13,title,adult_only,candidate','isbn13'),
    allRows(db,'reviewed_book_content','isbn13,enabled,cover_url,source_url','isbn13'),
    allRows(db,'public_ranking_aliases','alias_key,ranking_key','alias_key'),
  ]);
  const approved=new Map(covers.filter(x=>x.enabled).map(x=>[x.isbn13,x]));
  const aliases=new Map(aliasRows.map(row=>[row.alias_key,row.ranking_key]));
  const resolveKey=title=>aliases.get(rankingKey(title))??rankingKey(title);
  const rows=new Map(catalog.filter(row=>!aliases.has(row.ranking_key)).map(row=>[row.ranking_key,{...row,cover_url:row.cover_url??approved.get(row.isbn)?.cover_url??null,registered:true}]));
  const comparable=title=>rankingKey(title).replace(/[!！?？・･ー―〜～「」『』【】]/g,'');
  const series=new Map();
  for(const job of jobs){const title=job.candidate?.series_title;if(title){const k=comparable(title);if(!series.has(k))series.set(k,title);else if(series.get(k)!==title)series.set(k,null);}}

  const selected=new Map();
  for(const job of jobs){
    const info=job.candidate;
    if(!info || !/^\d{13}$/.test(job.isbn13))continue;
    const parsed=String(info.title??job.title??'').normalize('NFKC').match(/^(.*?)\s*(?:[.．]?\s*(?:volume|vol\.?)[ \t]*|第\s*|\(\s*)?(\d+)\s*(?:巻|\))?$/i);
    const parsedName=parsed?.[1]?.trim();
    const inferred=parsedName&&series.has(comparable(parsedName))?series.get(comparable(parsedName))
      : parsedName&&(/(?:\s+\d+|\(\s*\d+\s*\)|\d+巻|(?:volume|vol\.?)\s*\d+)$/i.test(String(info.title??job.title??'').normalize('NFKC').trim())
        || (Number(info.volume_number)>0&&Number(info.volume_number)===Number(parsed?.[2])))?parsedName:null;
    const seriesTitle=info.series_title??inferred;
    if(!seriesTitle)continue;
    const key=resolveKey(seriesTitle);
    if(!key || rows.has(key))continue;
    const prev=selected.get(key);
    const volume=Number(info.volume_number??parsed?.[2])||9999;
    const cover=approved.get(job.isbn13);
    const hasCover=!!cover?.cover_url&&job.adult_only===false;
    if(prev && (Number(prev.hasCover)>Number(hasCover)||(prev.hasCover===hasCover&&(volume>prev.volume||(volume===prev.volume&&(prev.hasPreview||!info.cover_hash))))))continue;
    selected.set(key,{volume,hasCover,hasPreview:!!info.cover_hash,row:{ranking_key:key,title:seriesTitle,isbn:job.isbn13,adult_only:job.adult_only,
      cover_url:hasCover?cover.cover_url:null,preview_url:job.adult_only===false&&info.cover_hash?`/reviews/${job.isbn13}/cover`:null,source_url:info.source_url??cover?.source_url??null,enabled:false,registered:false}});
  }
  for(const [key,{row}] of selected)rows.set(key,row);
  for(const row of rows.values()){
    const job=jobs.find(j=>j.isbn13===row.isbn);
    if(!row.cover_url&&row.adult_only===false&&job?.adult_only===false&&job?.candidate?.cover_hash)row.preview_url=`/reviews/${row.isbn}/cover`;
  }
  return [...rows.values()].sort((a,b)=>a.title.localeCompare(b.title,'ja'));
}
export const rankingSelectionScript=`<script>(()=>{
 const form=document.querySelector('[data-ranking-list]');if(!form)return;
 const select=form.querySelector('[data-ranking-select]'),undo=form.querySelector('[data-ranking-undo]'),status=form.querySelector('[data-ranking-status]');
 let previous;
 select.addEventListener('click',()=>{const radios=[...form.querySelectorAll('input[type="radio"][name^="listing_"]')];previous=radios.map(r=>[r,r.checked]);
 let count=0;form.querySelectorAll('[data-ranking-eligible="true"]').forEach(row=>{row.querySelectorAll('input[name^="listing_"]').forEach(r=>{r.checked=r.value==='show';});count++;});undo.disabled=false;status.textContent=count+'件を掲載に選択しました。保存すると反映されます。';});
 undo.addEventListener('click',()=>{previous?.forEach(([r,v])=>r.checked=v);previous=null;undo.disabled=true;status.textContent='一括選択を戻しました。';});
})();</script>`;
function state(row){return row.enabled&&row.adult_only===false?'show':row.registered?'hide':'new';}
export function rankingReturnTo(value){
  try{const u=new URL(String(value??''),'https://admin.invalid');if(u.origin!=='https://admin.invalid'||u.pathname!=='/rankings')return '/rankings';const q=new URLSearchParams();for(const k of ['q','view','size','page'])if(u.searchParams.has(k))q.set(k,u.searchParams.get(k));return '/rankings'+(q.size?'?'+q:'');}catch{return '/rankings';}
}
export function registerRankingAdmin(app,db,page,e,{csrf,guarded,https,token}){
 const styles=`<style>.ranking-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.ranking-filters{display:flex;gap:12px;flex-wrap:wrap;align-items:end;margin:20px 0}.ranking-filters label{margin:0;min-width:140px}.ranking-filters input,.ranking-filters select{margin-top:6px}.ranking-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:16px 0}.ranking-row{display:flex;gap:18px;align-items:center;border-top:1px solid var(--line);padding:20px 0}.ranking-cover{width:64px;height:90px;object-fit:contain;border-radius:5px;background:#f3f4f6;flex-shrink:0}.ranking-placeholder{display:flex;align-items:center;justify-content:center;font-size:12px;color:#777}.ranking-info{flex:1;min-width:150px}.ranking-info strong{display:block;font-size:18px}.ranking-info small{display:block;color:var(--muted);margin-top:6px}.ranking-options{display:flex;gap:14px;flex-wrap:wrap}.ranking-options label{display:flex;gap:6px;align-items:center;margin:0;white-space:nowrap}.ranking-options input{width:auto;margin:0}.ranking-row .button{white-space:nowrap}.ranking-pager{display:flex;justify-content:space-between;align-items:center;margin-top:20px}.ranking-save{position:sticky;bottom:0;background:var(--panel,#fff);padding:16px 0;border-top:1px solid var(--line);display:flex;justify-content:flex-end}.ranking-editor{max-width:850px}.ranking-editor details{margin:18px 0;padding:16px;border:1px solid var(--line);border-radius:10px}@media(max-width:850px){.ranking-row{flex-wrap:wrap}.ranking-options{width:100%;padding-left:82px}.ranking-heading{align-items:start}.ranking-filters label{flex:1}.ranking-row button{margin-left:auto}}</style>`;
 const field=(name,label,value='')=>`<label>${e(label)}<input name="${name}" value="${e(value??'')}"></label>`;
 const radios=(name,values,chosen)=>`<div class="ranking-options">${values.map(([v,label])=>`<label><input type="radio" name="${name}" value="${v}" ${chosen===v?'checked':''}>${label}</label>`).join('')}</div>`;
 app.get('/rankings',guarded(async(req,res)=>{
  const rows=await rankingCandidates(db),key=String(req.query.key??'');
  const q=String(req.query.q??'').trim().slice(0,200),view=['show','hide','new','all'].includes(req.query.view)?req.query.view:'all';
  const size=rankingPageSize(req.query.size,req.headers?.cookie);
  res.setHeader?.('Set-Cookie',`honnoma_ranking_size=${size}; Path=/rankings; Max-Age=31536000; HttpOnly; SameSite=Lax${req.secure?'; Secure':''}`);
  const filtered=rows.filter(row=>(view==='all'||state(row)===view)&&(!q||[row.title,row.isbn,row.ranking_key].some(v=>String(v??'').normalize('NFKC').toLowerCase().includes(q.normalize('NFKC').toLowerCase()))));
  const count=filtered.length,pages=Math.max(1,Math.ceil(count/size)),current=Math.min(pages,Math.max(1,Number.parseInt(req.query.page,10)||1));
  const query=new URLSearchParams({q,view,size:String(size),page:String(current)}),returnTo='/rankings?'+query;
  const link=p=>{const copy=new URLSearchParams(query);copy.set('page',String(p));return '/rankings?'+copy;};
  const selected=rows.find(row=>row.ranking_key===key);
  let editor='';
  if(key || req.query.add==='manual'){
    const row=selected??{};
    editor=`<section class="panel ranking-editor"><h2>${row.registered?'掲載情報を編集':'掲載作品を追加'}</h2><p>${e(row.title??'新しい作品')}</p><form method="post" action="/rankings">${token}<input type="hidden" name="return_to" value="${e(returnTo)}">${field('title','公開作品名',row.title)}${field('isbn13','代表巻のISBN',row.isbn)}<label>分類</label>${radios('adult_only',[['false','一般向け'],['true','成人向け']],row.adult_only===false?'false':row.adult_only===true?'true':'')}<p class="muted">未選択は確認待ちとして保存します。</p><label>掲載</label>${radios('enabled',[['true','掲載'],['false','非掲載']],state(row)==='show'?'true':'false')}<details><summary>作品の識別情報・表紙・確認元を編集</summary>${field('ranking_key','シリーズキー（自動入力）',row.ranking_key)}${field('cover_url','確認済み表紙URL（空欄なら表紙なし）',row.cover_url)}${field('source_url','確認元URL',row.source_url)}</details><div class="actions"><a class="button secondary" href="${e(returnTo)}">閉じる</a><button>掲載情報を保存</button></div></form></section>`;
  }
  res.send(page('ランキング掲載管理',styles+`<section class="panel"><div class="ranking-heading"><h2>ランキングの掲載作品</h2><a class="button secondary" href="/rankings?add=manual">手入力で追加</a></div><p class="muted">一般向けとして確認した作品を掲載候補にできます。実際の順位・表示は登録数などの集計条件で決まります。</p>${req.query.saved?'<p role="status">掲載設定を保存しました。</p>':''}
   <form class="ranking-filters" method="get"><label>作品・ISBNで検索<input name="q" value="${e(q)}" placeholder="作品名・ISBN"></label><label>掲載状態<select name="view">${[['all','すべて'],['show','掲載対象'],['hide','非掲載'],['new','未追加の作品']].map(([v,t])=>`<option value="${v}" ${view===v?'selected':''}>${t}</option>`).join('')}</select></label><label>表示件数<select name="size">${sizes.map(n=>`<option value="${n}" ${size===n?'selected':''}>${n}件</option>`).join('')}</select></label><button>絞り込む</button></form><p>全${count}作品 ／ ${current} / ${pages}ページ</p></section>${editor}
   <section class="panel"><form method="post" action="/rankings/listing" data-ranking-list>${token}<input type="hidden" name="return_to" value="${e(returnTo)}"><div class="ranking-toolbar"><button type="button" class="secondary" data-ranking-select>このページの一般向け作品を掲載に選択</button><button type="button" class="secondary" data-ranking-undo disabled>一括選択を戻す</button><small data-ranking-status>選択後に保存すると反映されます。</small></div>
   ${filtered.slice((current-1)*size,current*size).map((row,i)=>{const eligible=row.adult_only===false&&!!row.source_url;return `<div class="ranking-row" data-ranking-eligible="${eligible}"><input type="hidden" name="key_${i}" value="${e(row.ranking_key)}"><input type="hidden" name="isbn_${i}" value="${e(row.isbn)}">${row.cover_url||row.preview_url?`<img class="ranking-cover" src="${e(row.cover_url??row.preview_url)}" alt="${e(row.title)}の${row.cover_url?'確認済み表紙':'確認候補'}" loading="lazy">`:'<span class="ranking-cover ranking-placeholder">表紙なし</span>'}<div class="ranking-info"><strong>${e(row.title)}</strong><small>${e(row.isbn)} ／ ${row.cover_url?'表紙許可済み':row.preview_url?'表紙候補・表示未許可':'表紙未取得'} ／ ${row.adult_only===false?'一般向け':row.adult_only===true?'成人向け':'分類未確認'} ／ ${state(row)==='show'?'掲載対象':row.registered?'非掲載':'未追加'}</small></div>${eligible?radios('listing_'+i,[['show','掲載'],['hide','非掲載']],state(row)==='show'?'show':row.registered?'hide':''):'<small>分類・確認元を確認してください</small>'}${!row.cover_url?`<a class="button secondary" href="/reviews?q=${e(row.isbn)}&view=all">表紙確認</a>`:''}<a class="button secondary" href="${e(returnTo+'&key='+encodeURIComponent(row.ranking_key))}">編集</a>${eligible?`<button name="row" value="${i}">保存</button>`:''}</div>`;}).join('')||'<p>該当する作品はありません。</p>'}<div class="ranking-save"><button name="row" value="all">選択した掲載設定をまとめて保存</button></div></form><div class="ranking-pager">${current>1?`<a class="button secondary" href="${e(link(current-1))}">前へ</a>`:'<span></span>'}<span>${current} / ${pages}ページ</span>${current<pages?`<a class="button secondary" href="${e(link(current+1))}">次へ</a>`:'<span></span>'}</div></section>`+rankingSelectionScript));
 }));
 app.post('/rankings',guarded(async(req,res)=>{
  const key=String(req.body.ranking_key??'').trim(),title=String(req.body.title??'').trim(),isbn=String(req.body.isbn13??'').replace(/[^0-9]/g,'');
  if(!key||!title||!/^\d{13}$/.test(isbn))throw new Error('作品名・ISBN・シリーズキーを入力してください。');
  const adult=req.body.adult_only==='false'?false:req.body.adult_only==='true'?true:null;
  const {data:alias,error:aliasError}=await db.from('public_ranking_aliases').select('ranking_key').eq('alias_key',key).maybeSingle();
  if(aliasError)throw aliasError;
  if(alias)throw new Error('この作品は既存作品に統合されています。一覧から統合先を編集してください。');
  const {error}=await db.from('public_ranking_catalog').upsert({ranking_key:key,title,isbn,cover_url:https(req.body.cover_url),source_url:https(req.body.source_url,true),adult_only:adult,enabled:req.body.enabled==='true'&&adult===false,reviewed_at:new Date().toISOString()});
  if(error)throw error;
  const to=rankingReturnTo(req.body.return_to);res.redirect(303,to+(to.includes('?')?'&':'?')+'saved=1');
 }));
 app.post('/rankings/listing',guarded(async(req,res)=>{
  const rows=new Map((await rankingCandidates(db)).map(row=>[row.ranking_key,row]));
  const indices=req.body.row==='all'?Object.keys(req.body).filter(k=>/^listing_\d+$/.test(k)).map(k=>k.slice(8)):[String(req.body.row??'')];
  if(indices.length>100)throw new Error('一度に保存できるのは100作品までです。');
  // Validate the whole selection before writing, including classification changes made in another tab.
  const writes=[];
  for(const i of indices){
    if(!/^\d+$/.test(i)||!['show','hide'].includes(req.body['listing_'+i]))throw new Error('掲載設定を選択してください。');
    const row=rows.get(req.body['key_'+i]);
    if(!row||row.isbn!==req.body['isbn_'+i])throw new Error('作品情報が更新されています。一覧を開き直してください。');
    const show=req.body['listing_'+i]==='show';
    if(show&&(row.adult_only!==false||!row.source_url))throw new Error('一般向け分類と確認元を確認してから掲載してください。');
    if((!row.registered&&!show)||(row.registered&&row.enabled===show))continue;
    writes.push({...row,enabled:show});
  }
  let saved=0;
  for(const row of writes){
    const {data,error}=row.registered?await db.from('public_ranking_catalog').update({enabled:row.enabled,reviewed_at:new Date().toISOString()}).eq('ranking_key',row.ranking_key).eq('isbn',row.isbn).eq('reviewed_at',row.reviewed_at).select('ranking_key'):
      await db.from('public_ranking_catalog').upsert({ranking_key:row.ranking_key,title:row.title,isbn:row.isbn,cover_url:row.cover_url,source_url:https(row.source_url,true),adult_only:false,enabled:true,reviewed_at:new Date().toISOString()},{onConflict:'ranking_key',ignoreDuplicates:true}).select('ranking_key');
    if(error || !data?.length) return res.status(409).send(page('掲載設定を確認',`<p>${saved}作品を保存しました。残りは情報が更新されたか、保存できませんでした。一覧を開き直して確認してください。</p><a href="${e(rankingReturnTo(req.body.return_to))}">一覧へ戻る</a>`));
    saved++;
  }
  const to=rankingReturnTo(req.body.return_to);res.redirect(303,to+(to.includes('?')?'&':'?')+'saved=1');
 }));
}

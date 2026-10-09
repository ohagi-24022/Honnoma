import { randomBytes } from 'node:crypto';

export const normalizeIsbn = value => String(value ?? '').normalize('NFKC').replace(/[^0-9X]/gi, '').toUpperCase();
const text = value => String(value ?? '').trim() || null;
const specs = {
  overrides: { table: 'book_metadata_overrides', isbn: 'normalized_isbn', fields: ['title','series_title','author'], label: '補正済み', order: 'updated_at' },
  review: { table: 'book_content_review_jobs', isbn: 'isbn13', fields: ['title','candidate->>series_title'], label: '確認用データ', order: 'updated_at' },
  books: { table: 'books', isbn: 'isbn', fields: ['title','series_title','author'], label: '本棚', order: 'created_at' },
  cache: { table: 'book_metadata_cache', isbn: 'normalized_isbn', fields: ['title','series_title','author'], label: '取得済みデータ', order: 'fetched_at' },
};
export function searchFilter(spec, value) {
  const query = String(value ?? '').normalize('NFKC').trim().slice(0,200);
  const isbn = normalizeIsbn(query);
  if (/^(?:ISBN[:： ]*)?[\dXx\s\-‐−–]+$/i.test(query) && isbn) return `${spec.isbn}.eq.${isbn}`;
  const literal = `"%${query.replace(/[\\%_]/g,'\\$&').replaceAll('"','\\"')}%"`;
  return [...spec.fields, spec.isbn].map(field => `${field}.ilike.${literal}`).join(',');
}
function candidate(source, row) {
  const spec = specs[source];
  const info = source === 'review' ? row.candidate ?? {} : row;
  return { ...info, isbn: row[spec.isbn], id: row.id, source, label: spec.label,
    title: info.title ?? row.title, thumbnail_url: info.thumbnail_url ?? info.cover_url,
    preview_url: source === 'review' ? (info.cover_hash ? `/reviews/${row.isbn13}/cover` : null) : info.thumbnail_url,
    archived: source === 'review' && !row.candidate };
}
export async function searchCandidates(db, query = '') {
  if (!db) return [];
  const results = await Promise.all(Object.entries(specs).map(async ([source,spec]) => {
    let request = db.from(spec.table).select('*').order(spec.order,{ascending:false}).limit(40);
    if (query.trim()) request = request.or(searchFilter(spec,query));
    else if (source === 'review') request = request.not('candidate','is',null);
    const { data,error } = await request;
    if (error) throw error;
    return (data ?? []).map(row => candidate(source,row));
  }));
  const seen = new Set();
  return results.flat().filter(row => { const key=normalizeIsbn(row.isbn) || row.id; if(seen.has(key))return false;seen.add(key);return true; }).slice(0,80);
}
async function selectedCandidate(db, source, key) {
  const spec = specs[source];
  if (!spec || !key) return null;
  const {data,error} = await db.from(spec.table).select('*').eq(source==='books'?'id':spec.isbn,source==='books'?key:normalizeIsbn(key)).limit(1).maybeSingle();
  if(error)throw error;
  return data ? candidate(source,data) : null;
}
export async function readMetadataCacheFallback(db,{normalizedIsbn,seriesKey,volumeNumber}) {
  if (!db) return {};
  let query=db.from('book_metadata_cache').select('*');
  if(normalizedIsbn)query=query.eq('normalized_isbn',normalizeIsbn(normalizedIsbn));
  else if(seriesKey && volumeNumber)query=query.eq('series_key',seriesKey).eq('volume_number',volumeNumber);
  else return {};
  const {data,error}=await query.order('fetched_at',{ascending:false}).limit(1).maybeSingle();
  if(error)throw error;
  return data ?? {};
}
function previewUrl(value) {
  if (typeof value === 'string' && /^\/reviews\/\d{13}\/cover$/.test(value)) return value;
  try { return url(value,'表紙URL'); } catch { return null; }
}
function url(value,label) {
  const result=text(value);if(!result)return null;
  try {const parsed=new URL(result);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error();return result;}catch{throw new Error(`${label}は http:// または https:// で始まるURLを入力してください。`);}
}
function number(value,label) {if(!text(value))return null;const n=Number(value);if(!Number.isInteger(n)||n<0)throw new Error(`${label}は0以上の整数を入力してください。`);return n;}
export function overrideValues(body) {
  const isbn=normalizeIsbn(body.isbn);
  if(!/^(?:\d{13}|\d{9}[\dX])$/.test(isbn))throw new Error('ISBNは10桁または13桁で入力してください。');
  const series=text(body.series_title);const price=number(body.list_price,'価格');
  return {isbn,normalized_isbn:isbn,title:text(body.title),series_title:series,
    series_key:text(body.series_key) ?? series?.normalize('NFKC').replace(/[\s・･:：\-–—_'"()[\]{}「」『』【】〈〉《》!?！？。.．]/g,'') ?? null,
    volume_number:number(body.volume_number,'巻数'),author:text(body.author),publisher:text(body.publisher),
    thumbnail_url:url(body.thumbnail_url,'表紙URL'),source_url:url(body.source_url,'巻情報URL'),description:text(body.description),
    list_price:price,price_source:price===null?null:'manual',price_fetched_at:price===null?null:new Date().toISOString(),updated_at:new Date().toISOString()};
}

export function registerOverrideAdmin(app,db,page,e) {
  const csrf=randomBytes(32).toString('hex');const token=`<input type="hidden" name="csrf" value="${csrf}">`;
  const styles=`<style>
    .override-layout{display:grid;grid-template-columns:minmax(280px,360px) minmax(0,1fr);gap:24px;align-items:start}.override-layout .panel{margin:0}
    .override-heading{margin-bottom:24px}.override-heading h2{font-size:28px;margin-bottom:8px}.override-search{display:flex;gap:8px;margin:16px 0}.override-search input{min-width:0}.override-search button{flex-shrink:0;white-space:nowrap}
    .override-candidates{max-height:650px;overflow:auto}.override-book{display:flex;gap:14px;align-items:center;padding:14px 0;border-bottom:1px solid var(--line);text-decoration:none;color:inherit}.override-book img{width:58px;height:80px;object-fit:contain;background:#f5f5f5}.override-book span{min-width:0}.override-book strong{display:block;font-size:15px}.override-book small{display:block;color:var(--muted);margin-top:5px;overflow-wrap:anywhere}.override-book:hover{background:#f6f8fb}
    .override-selected{background:#f6f8fb;border-radius:12px;padding:16px;margin:16px 0}.override-fields{display:grid;grid-template-columns:1fr 1fr;gap:18px}.override-fields label{display:block;margin:0}.override-fields label input,.override-fields textarea{margin-top:7px}.override-full{grid-column:1/-1}.override-fields small{display:block;color:var(--muted);margin-top:7px}.override-fields details{padding:16px;border:1px solid var(--line);border-radius:10px}.override-fields summary{cursor:pointer;margin-bottom:12px}.override-save{display:flex;gap:14px;align-items:center;justify-content:flex-end;margin-top:24px;border-top:1px solid var(--line);padding-top:20px}.override-history{margin-top:24px}.override-history .override-book{flex-wrap:wrap}.override-history .override-book>span{flex:1}.override-history .actions{margin-left:auto}.override-error{background:#fff0ed;color:#932916;padding:14px;border-radius:8px;margin-bottom:16px}
    @media(max-width:850px){.override-layout{grid-template-columns:1fr}.override-candidates{max-height:300px}.override-fields{grid-template-columns:1fr}.override-full{grid-column:auto}}
    </style>`;
  const field=(label,name,value,extra='')=>`<label ${extra}>${label}<input name="${name}" value="${e(value??'')}" ${name.includes('url')?'type="url" placeholder="https://…"':name==='isbn'?'required inputmode="numeric" placeholder="978…"':''}></label>`;
  const book=(row,href)=>`<a class="override-book" href="${e(href)}">${previewUrl(row.preview_url)?`<img loading="lazy" src="${e(previewUrl(row.preview_url))}" alt="表紙">`:'<span class="emptyCover cover"></span>'}<span><strong>${e(row.title??'タイトル未取得')}</strong><small>${e(row.publisher??'')} ${row.volume_number?e(row.volume_number)+'巻':''}</small><small>${e(row.isbn??'')} ／ ${e(row.label??'')}</small></span></a>`;
  const editor=(draft={},action='/overrides',error='')=>`<section class="panel"><h2>補正URLを編集</h2><p class="muted">本を選ぶと入力欄に情報が入ります。間違っている項目を変更して保存してください。</p>${error?`<p class="override-error" role="alert">${e(error)}</p>`:''}${draft.title?`<div class="override-selected">${book(draft,draft.source==='review'?'/reviews/'+draft.isbn:'#')} ${draft.archived?'<p>このデータは確認対象から除外されています。ISBNと書誌情報を確認してください。</p>':''}</div>`:''}
    <form method="post" action="${e(action)}">${token}<div class="override-fields">
    ${field('ISBN','isbn',draft.isbn??draft.normalized_isbn)}${field('タイトル','title',draft.title)}
    ${field('巻情報URL','source_url',draft.source_url,'class="override-full"')}<small class="override-full">出版社などの、その巻の情報が掲載されているページのURL</small>
    ${field('表紙URL','thumbnail_url',draft.thumbnail_url,'class="override-full"')}<small class="override-full">画像そのもののURLを入力します。表紙の表示確認は「表紙・タイトルの確認」で行います。</small>
    <details class="override-full" ${error?'open':''}><summary>シリーズ・作者・価格などを編集</summary><div class="override-fields">
    ${field('シリーズ名','series_title',draft.series_title)}${field('巻数','volume_number',draft.volume_number)}${field('作者','author',draft.author)}${field('出版社','publisher',draft.publisher)}${field('新品参考価格（円）','list_price',draft.list_price)}${field('シリーズキー（空欄なら自動）','series_key',draft.series_key)}
    <label class="override-full">説明文の直接補正<textarea name="description" rows="5">${e(draft.description??'')}</textarea><small>URLから取得できない場合に入力してください。</small></label></div></details></div>
    <div class="override-save"><a href="/">入力をリセット</a><button type="submit">補正を保存</button></div></form></section>`;
  const guarded=handler=>async(req,res)=>{if(!db)return res.sendStatus(503);if(req.method==='POST'&&req.body.csrf!==csrf)return res.status(403).send('ページを開き直してください。');try{await handler(req,res);}catch(error){res.status(400).send(page('補正URL',styles+editor(req.body,req.path,error.message)));}};
  app.get('/',guarded(async(req,res)=>{
    const query=String(req.query.bookq??'').trim().slice(0,200);const historyQuery=String(req.query.q??'').trim().slice(0,200);
    const source=req.query.source??(req.query.bookId?'books':'');const key=req.query.key??req.query.bookId;
    let history=db.from('book_metadata_overrides').select('*').order('updated_at',{ascending:false}).limit(100);
    if(historyQuery)history=history.or(searchFilter(specs.overrides,historyQuery));
    const [candidates,selected,{data:rows,error}]=await Promise.all([searchCandidates(db,query),selectedCandidate(db,source,key),history]);if(error)throw error;
    const draft=selected ?? (/^[\d\s\-]+$/.test(query.normalize('NFKC'))?{isbn:normalizeIsbn(query)}:{});
    res.send(page('補正URL',styles+`<div class="override-heading"><h2>本の情報を整える</h2><p class="muted">確認用に追加した本も、ISBN・タイトルで検索できます。</p>${req.query.saved?'<p role="status">補正を保存しました。</p>':''}</div><div class="override-layout"><section class="panel"><h2>本を選ぶ</h2><form class="override-search"><input aria-label="本の検索" name="bookq" value="${e(query)}" placeholder="ISBN・タイトル・作者"><button>検索</button></form><div class="override-candidates">${candidates.map(row=>book(row,'/?'+new URLSearchParams({source:row.source,key:row.source==='books'?row.id:row.isbn,bookq:query}))).join('')||'<p>該当する本がありません。ISBNを右の欄に入力して補正を追加できます。</p>'}</div><p class="muted">最大80件を表示します。ISBNで検索すると目的の巻を選びやすくなります。</p></section>${editor(draft)}</div>
      <section class="panel override-history"><h2>保存済みの補正</h2><form class="override-search"><input name="q" aria-label="保存済み補正の検索" value="${e(historyQuery)}" placeholder="ISBN・タイトル"><button>検索</button></form>${(rows??[]).map(row=>`<div class="override-book"><span><strong>${e(row.title??'')}</strong><small>${e(row.normalized_isbn??row.isbn)} ／ ${row.enabled?'有効':'無効'}</small><small>${e(row.source_url??'巻情報URLなし')}</small></span><div class="actions"><a class="button" href="/overrides/${e(row.id)}/edit">編集</a><form method="post" action="/overrides/${e(row.id)}/toggle">${token}<button class="secondary">${row.enabled?'無効化':'有効化'}</button></form></div></div>`).join('')||'<p class="muted">該当する補正はありません。</p>'}</section>`));
  }));
  app.get('/overrides/:id/edit',guarded(async(req,res)=>{const {data,error}=await db.from('book_metadata_overrides').select('*').eq('id',req.params.id).single();if(error)throw error;res.send(page('補正編集',styles+editor({...data,preview_url:data.thumbnail_url,label:'補正済み'},req.path)));}));
  const save=edit=>guarded(async(req,res)=>{
    let row;try{row=overrideValues(req.body);}catch(error){return res.status(400).send(page('入力を確認してください',styles+editor(req.body,req.path,error.message)));}
    let result;
    if(edit)result=await db.from('book_metadata_overrides').update(row).eq('id',req.params.id);
    else{const {data:existing,error}=await db.from('book_metadata_overrides').select('id').eq('normalized_isbn',row.normalized_isbn).maybeSingle();if(error)throw error;result=existing?await db.from('book_metadata_overrides').update(row).eq('id',existing.id):await db.from('book_metadata_overrides').insert({...row,source:'developer',enabled:true});}
    if(result.error)throw result.error;res.redirect(303,'/?saved=1');
  });
  app.post('/overrides',save(false));app.post('/overrides/:id/edit',save(true));
  app.post('/overrides/:id/toggle',guarded(async(req,res)=>{const {data,error}=await db.from('book_metadata_overrides').select('enabled').eq('id',req.params.id).single();if(error)throw error;const result=await db.from('book_metadata_overrides').update({enabled:!data.enabled,updated_at:new Date().toISOString()}).eq('id',req.params.id);if(result.error)throw result.error;res.redirect(303,'/');}));
}

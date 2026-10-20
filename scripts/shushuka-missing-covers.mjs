import {createHash,randomBytes} from 'node:crypto';
import {fetchBookWithCover,fetchCover,searchBookPages,validIsbn} from './shushuka-content-review.mjs';

const key=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
// Missing ISBNs can be filled only by an unambiguous, exact series + volume match.
// Companion books and special editions require an explicit ISBN or administrator editing.
export function selectMissingCoverIdentity(book,items){
  if(!book.volume_number||book.volume_kind==='extra'||book.book_format==='novel')return null;
  const matches=new Map();
  for(const raw of items??[]){
    const item=raw.Item??raw;
    if(!validIsbn(item.isbn)||/文庫|特装|限定|新装|完全版|愛蔵|合本|小説|ノベライズ/.test(`${item.title??''} ${item.subTitle??''}`))continue;
    const title=String(item.title??'').normalize('NFKC').trim();
    const trailing=title.match(/^(.*?)[\s(（第]*([0-9]+)[\s)）巻]*$/);
    const middle=title.match(/^(.*?)\s+(\d+)\s+[〜~～](.+)[〜~～]$/);
    const match=trailing??(middle?[middle[0],middle[1]+middle[3],middle[2]]:null);
    if(!match||Number(match[2])!==book.volume_number)continue;
    if(![book.series_title,book.title.replace(/[\s(（第]*[0-9]+[\s)）巻]*$/,'')].some(name=>key(name)===key(match[1])))continue;
    if(book.publisher&&item.publisherName&&key(book.publisher)!==key(item.publisherName))continue;
    matches.set(item.isbn,item);
  }
  return matches.size===1?[...matches.values()][0]:null;
}
export async function retrieveMissingBookCover(db,id,{read=fetchBookWithCover,search=searchBookPages}={}){
  const {data:book,error}=await db.from('books').select('id,user_id,isbn,title,series_title,volume_number,volume_kind,book_format,publisher,thumbnail_url').eq('id',id).maybeSingle();
  if(error)throw Object.assign(error,{stage:'read-book'});
  if(!book||book.thumbnail_url)return 'skipped';
  let isbn=book.isbn;
  let selected=null;
  if(!isbn){
    const result=await db.functions.invoke('rakuten-books',{signal:AbortSignal.timeout(8000),body:{path:'BooksBook/Search/20170404',params:{title:book.series_title,hits:'30',format:'json'}}}).catch(()=>({error:true}));
    selected=result.error?null:selectMissingCoverIdentity(book,result.data?.body?.Items);
    if(!selected)selected=selectMissingCoverIdentity(book,await search(`${book.series_title} ${book.volume_number??''}`));
    isbn=selected?.isbn;
  }
  if(!validIsbn(isbn))return 'needs-identity';
  let found;
  const selectedCover=selected?.cover_url??selected?.largeImageUrl??selected?.mediumImageUrl;
  if(selectedCover&&read===fetchBookWithCover){
    try{found={book:{title:selected.title,publisher:selected.publisherName||book.publisher||'',imprint:'',description:'',provider:'rakuten',cover_url:selectedCover,source_url:selected.source_url||`https://books.rakuten.co.jp/search?sitem=${isbn}`},image:await fetchCover(selectedCover)};}catch{/* Retry exact ISBN using the remaining providers. */}
  }
  let retrieved;
  try{retrieved=found??await read(db,isbn);}catch(error){throw Object.assign(error,{stage:'fetch-cover'});}
  const {book:metadata,image}=retrieved;
  if(!image||!metadata?.cover_url)return 'missing';
  // A concurrent edit, another retrieval or account transfer must never be overwritten.
  let update=db.from('books').update({isbn,thumbnail_url:metadata.cover_url,...(!book.publisher&&metadata.publisher?{publisher:metadata.publisher}:{})})
    .eq('id',book.id).eq('user_id',book.user_id).eq('title',book.title)
    .or('thumbnail_url.is.null,thumbnail_url.eq.');
  update=book.isbn?update.eq('isbn',book.isbn):update.is('isbn',null);
  const saved=await update.select('id');if(saved.error)throw Object.assign(saved.error,{stage:'save-cover'});
  if(!saved.data?.length)return 'changed';
  if(typeof db.rpc==='function'){
    // This RPC refuses manual/public decisions and classified records.
    // An unclassified book becomes editable without granting any approval.
    const candidate={...metadata,cover_hash:image.hash,review_origin:'registration'};
    try{await db.rpc('prepare_book_content_review',{p_isbn:isbn,p_hash:createHash('sha256').update(JSON.stringify(candidate)).digest('hex'),p_candidate:candidate});}catch{/* A library repair survives a temporary review-queue failure. */}
  }
  return 'repaired';
}
export function registerMissingCoverAdmin(app,db,service,page,e){
  const csrf=randomBytes(32).toString('hex');
  const guarded=fn=>async(req,res)=>{
    if(!db)return res.sendStatus(503);
    if(req.method==='POST'&&req.body?.csrf!==csrf)return res.status(403).send('ページを開き直してください。');
    try{await fn(req,res);}catch{res.status(400).send(page('表紙の取得','<p>取得できませんでした。時間を置いてお試しください。</p><a href="/missing-covers">一覧へ戻る</a>'));}
  };
  app.get('/missing-covers',guarded(async(req,res)=>{
    const size=[10,30,50,100].includes(Number(req.query.size))?Number(req.query.size):30;
    let current=Math.max(1,Math.floor(Number(req.query.page)||1));
    const kind=['all','isbn','no-isbn'].includes(req.query.kind)?req.query.kind:'all';
    const build=()=>{let q=db.from('books').select('id,title,series_title,volume_number,isbn',{count:'exact'}).or('thumbnail_url.is.null,thumbnail_url.eq.');if(kind==='isbn')q=q.not('isbn','is',null);if(kind==='no-isbn')q=q.is('isbn',null);return q.order('series_title').order('volume_number').order('id');};
    let result=await build().range((current-1)*size,current*size-1);if(result.error)throw result.error;
    const pages=Math.max(1,Math.ceil((result.count??0)/size));if(current>pages){current=pages;result=await build().range((current-1)*size,current*size-1);if(result.error)throw result.error;}
    const url=n=>'/missing-covers?'+new URLSearchParams({kind,size:String(size),page:String(n)});
    res.send(page('本棚の表紙未取得',`<section class="panel"><h2>本棚の表紙未取得</h2><p>画像未取得の本を、ISBN未設定の本も含めて表示します。公開許可の状態とは別の一覧です。取得は書誌サービスを利用し、AIの料金は発生しません。</p><a href="/reviews">表紙・タイトルの確認へ戻る</a>
      ${req.query.done?`<p role="status">${Math.min(5,Number(req.query.done)||0)}件の表紙を取得しました。残った本はISBN・巻数・版の確認、または画像URLの指定が必要です。</p>`:''}
      <form><label>ISBN<select name="kind">${[['all','すべて'],['isbn','設定済み'],['no-isbn','未設定']].map(([v,t])=>`<option value="${v}" ${kind===v?'selected':''}>${t}</option>`).join('')}</select></label><label>表示件数<select name="size">${[10,30,50,100].map(n=>`<option ${n===size?'selected':''}>${n}</option>`).join('')}</select></label><button>絞り込む</button></form>
      <p>全${result.count??0}件 ／ ${current} / ${pages}ページ</p><form method="post" action="/missing-covers/retrieve"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="return_to" value="${e(url(current))}">
      <button name="row" value="batch" ${(result.data??[]).length?'':'disabled'}>このページの先頭5件を再取得</button>
      ${(result.data??[]).map((book,i)=>`<article style="display:flex;gap:16px;align-items:center;padding:16px 0;border-bottom:1px solid #ddd"><input type="hidden" name="book_${i}" value="${e(book.id)}"><div style="flex:1"><strong>${e(book.title)}</strong><p>${e(book.isbn||'ISBN未設定')} ／ ${book.volume_number?`${Number(book.volume_number)}巻`:'巻数未設定'}</p></div><a href="/?${e(new URLSearchParams({source:'books',key:book.id,bookq:book.title}).toString())}">書誌・表紙URLを編集</a><button name="row" value="${i}">再取得</button></article>`).join('')||'<p>未取得の表紙はありません。</p>'}</form>
      <nav>${current>1?`<a href="${e(url(current-1))}">前へ</a>`:''} ${current<pages?`<a href="${e(url(current+1))}">次へ</a>`:''}</nav></section>`));
  }));
  app.post('/missing-covers/retrieve',guarded(async(req,res)=>{
    const row=String(req.body.row??'');if(row!=='batch'&&!/^\d{1,3}$/.test(row))throw new Error('Invalid row');
    const ids=[...new Set(Object.entries(req.body).filter(([k])=>/^book_\d+$/.test(k)&&(row==='batch'||k===`book_${row}`)).map(([,v])=>String(v)))].slice(0,5);
    let done=0;const started=Date.now();
    for(const id of ids){if(Date.now()-started>20000)break;if(!/^[0-9a-f-]{36}$/i.test(id))continue;try{if(await retrieveMissingBookCover(db,id)==='repaired')done++;}catch{/* Remaining rows stay visible for retry or manual correction. */}}
    const target=String(req.body.return_to??'');const safe=/^\/missing-covers\?(?:[a-z0-9=&%-]+)$/i.test(target)?target:'/missing-covers';
    const dest=new URL(safe,'https://admin.invalid');dest.searchParams.set('done',String(done));res.redirect(303,dest.pathname+dest.search);
  }));
}

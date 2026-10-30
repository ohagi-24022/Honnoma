import {randomBytes} from 'node:crypto';
import {fetchBook,validIsbn} from './shushuka-content-review.mjs';

export async function retrieveSynopsis(db,isbn,{read=fetchBook}={}){
  if(!validIsbn(isbn))throw new Error('Invalid ISBN');
  let book,status='missing',reason='no_synopsis';
  try{
    // Unlike cover preparation, continue through exact-ISBN providers until text is found.
    book=await read(db,isbn,fetch,new Set(),{requireDescription:true});
    if(book?.description?.trim()){
      const entities={amp:'&',lt:'<',gt:'>',quot:'\"',apos:"'",nbsp:' '};
      const text=book.description.replace(/<br\s*\/?\s*>|<\/p>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&([a-z]+);/gi,(all,name)=>entities[name]??all).trim();
      if(text){book={...book,description:text};status='acquired';reason=null;}
    }
    else if(book?.acquisition_incomplete){status='failed';reason='provider_unavailable';}
  }catch(error){if(error.code!=='NO_EXACT_ISBN'){status='failed';reason='provider_unavailable';}}
  const {error}=await db.rpc('record_book_synopsis_fetch',{
    p_isbn:isbn,p_status:status,p_title:book?.title||'',
    p_description:status==='acquired'?book.description.trim().slice(0,20000):null,
    p_source_url:book?.description_source_url||book?.source_url||null,
    p_provider:book?.description_provider||book?.provider||null,p_reason:reason,
  });
  if(error)throw new Error('Synopsis save failed');
  return status;
}
export function registerSynopsisAdmin(app,db,page,e){
  const csrf=randomBytes(32).toString('hex');
  const labels={acquired:'取得済み',missing:'紹介文なし',failed:'取得失敗',unfetched:'未取得'};
  const dates=value=>value?new Date(value).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}):'未実施';
  const guard=fn=>async(req,res)=>{
    if(!db)return res.sendStatus(503);
    if(req.method==='POST'&&req.body?.csrf!==csrf)return res.status(403).send('ページを開き直してください。');
    try{await fn(req,res);}catch{res.status(503).send(page('巻の紹介文','<p>状況の読み込み・保存ができませんでした。時間を置いてもう一度お試しください。</p><a href="/synopses">一覧へ戻る</a>'));}
  };
  app.get('/synopses',guard(async(req,res)=>{
    const q=String(req.query.q??'').slice(0,100);
    const state=['acquired','missing','failed','unfetched'].includes(req.query.state)?req.query.state:'all';
    const size=[10,30,50,100].includes(Number(req.query.size))?Number(req.query.size):30;
    const requested=Math.max(1,Math.min(100000,Math.floor(Number(req.query.page)||1)));
    const {data,error}=await db.rpc('admin_book_synopsis_inventory',{p_query:q,p_state:state,p_size:size,p_page:requested});
    if(error)throw error;
    const current=data.page, pages=Math.max(1,Math.ceil(data.count/size));
    const url=n=>'/synopses?'+new URLSearchParams({q,state,size:String(size),page:String(n)});
    res.send(page('巻の紹介文',`<section class="panel"><h2>巻の紹介文の取得状況</h2>
      <p>URLの登録状態ではなく、紹介文の本文が保存されているかを表示します。再取得はISBNを照合し、書誌サービスを利用します。AIの料金は発生しません。</p>
      <p>取得済みの本文は再取得に失敗しても残ります。ランキング・公開許可と、本棚の名前や読書記録は変更しません。</p>
      ${req.query.result&&labels[req.query.result]?`<p role="status">再取得の結果：${e(labels[req.query.result])}</p>`:''}
      <form><input name="q" value="${e(q)}" placeholder="作品名・ISBN"><select name="state">${[['all','すべて'],...Object.entries(labels)].map(([v,t])=>`<option value="${v}" ${state===v?'selected':''}>${t}</option>`).join('')}</select>
      <select name="size">${[10,30,50,100].map(n=>`<option ${n===size?'selected':''}>${n}</option>`).join('')}</select><button>絞り込む</button></form>
      <p>全${data.count}件 ／ ${current} / ${pages}ページ</p>
      ${data.rows.map(row=>`<article style="padding:20px 0;border-bottom:1px solid #ddd"><h3>${e(row.title)} <small>${e(row.isbn)}</small></h3>
        <p><strong>${e(row.description?'取得済み':labels[row.status]||'未取得')}</strong> ／ 本文${Number(row.description?.length||0)}文字 ／ 最終取得試行：${e(dates(row.attempted_at))}</p>
        ${row.reason?`<p>${row.reason==='no_synopsis'?'取得先の書誌情報に紹介文が見つかりませんでした。':'取得先との通信に失敗しました。時間を置いて再取得してください。'}${row.description?' 保存済みの本文は保持しています。':''}</p>`:''}
        ${row.source_url?.startsWith('https://')?`<p>取得元：<a href="${e(row.source_url)}" target="_blank" rel="noreferrer">${e(row.provider||row.source_url)}</a></p>`:''}
        ${row.description?`<details><summary>保存されている紹介文を確認</summary><p style="white-space:pre-wrap">${e(row.description)}</p></details>`:''}
        <form method="post" action="/synopses/retrieve"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="isbn" value="${e(row.isbn)}"><input type="hidden" name="return_to" value="${e(url(current))}"><button>紹介文を再取得</button></form></article>`).join('')||'<p>対象の本はありません。</p>'}
      <nav>${current>1?`<a href="${e(url(current-1))}">前へ</a>`:''} ${current<pages?`<a href="${e(url(current+1))}">次へ</a>`:''}</nav></section>`));
  }));
  const running=new Set();
  app.post('/synopses/retrieve',guard(async(req,res)=>{
    const isbn=String(req.body.isbn??'');if(!validIsbn(isbn))return res.status(400).send('ISBNを確認してください。');
    if(running.has(isbn))return res.status(409).send('この本の紹介文を取得中です。しばらくお待ちください。');
    running.add(isbn);
    try{
      const status=await retrieveSynopsis(db,isbn);
      const target=String(req.body.return_to??'');
      const dest=new URL(/^\/synopses\?[a-z0-9=&%+_.!-]*$/i.test(target)?target:'/synopses','https://admin.invalid');
      dest.searchParams.set('result',status);res.redirect(303,dest.pathname+dest.search);
    }finally{running.delete(isbn);}
  }));
}

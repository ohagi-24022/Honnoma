import {randomBytes} from 'node:crypto';
import {validIsbn} from './shushuka-content-review.mjs';

export async function processCatalogPrices(db,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now}={}){
  const rpc=async(name,args)=>{const r=await db.rpc(name,args);if(r.error)throw Error('Catalog price storage unavailable');return r.data;};
  const jobs=await rpc('claim_catalog_price_jobs')??[];
  const outcomes=[];const started=now();let stop=false;
  for(const job of jobs){
    let result='deferred',book=null;
    if(!stop&&now()-started<110000){
      const control=await db.from('catalog_price_control').select('enabled').eq('id',true).single();
      if(control.error||!control.data?.enabled)stop=true;
    }
    if(!stop&&now()-started<110000){
      if(!validIsbn(job.isbn13)){result='missing';}
      else{
        const cached=await db.from('book_metadata_cache').select('list_price').eq('normalized_isbn',job.isbn13).maybeSingle();
        if(cached.error)throw Error('Catalog price cache unavailable');
        if(cached.data?.list_price!=null)result='existing';
        else{
          try{
            const response=await db.functions.invoke('rakuten-books',{signal:AbortSignal.timeout(8000),body:{path:'BooksBook/Search/20170404',params:{isbn:job.isbn13,hits:'1',format:'json',outOfStockFlag:'1'}}});
            if(response.data?.status===429){result='rate_limit';stop=true;}
            else if(response.error||response.data?.ok===false)result='retry';
            else{
              const item=response.data?.body?.Items?.map(x=>x.Item??x).find(x=>x.isbn===job.isbn13);
              if(item?.title&&Number.isInteger(item.itemPrice)&&item.itemPrice>0&&item.itemPrice<=1000000){
                result='acquired';book={isbn:job.isbn13,title:String(item.title).slice(0,1000),price:item.itemPrice,author:item.author||null,publisher:item.publisherName||null};
              }else result='missing';
            }
          }catch{result='retry';}
          // One provider request at a time; leave headroom for normal app searches.
          await sleep(1000);
        }
      }
    }
    const saved=await rpc('finish_catalog_price_job',{p_isbn:job.isbn13,p_lease:job.lease_token,p_result:result,p_book:book});
    outcomes.push({isbn:job.isbn13,result:saved?result:'changed'});
  }
  return {outcomes};
}

export function registerCatalogPriceAdmin(app,db,page,e){
  const csrf=randomBytes(32).toString('hex');
  const labels={queued:'未取得',processing:'取得中',acquired:'価格取得済み',missing:'取得先に価格なし',retry:'再試行待ち',failed:'取得失敗'};
  const guard=fn=>async(req,res)=>{
    if(!db)return res.sendStatus(503);
    if(req.method==='POST'&&req.body?.csrf!==csrf)return res.status(403).send('ページを開き直してください。');
    try{await fn(req,res);}catch{res.status(503).send(page('新品価格の取得','<p>取得状況を読み込めませんでした。時間を置いてもう一度お試しください。</p>'));}
  };
  app.get('/catalog-prices',guard(async(req,res)=>{
    const config=await db.from('catalog_price_control').select('enabled,paused_until,completed_at').eq('id',true).single();if(config.error)throw config.error;
    const counts={};
    for(const status of Object.keys(labels)){
      const r=await db.from('catalog_price_jobs').select('isbn13',{count:'exact',head:true}).eq('status',status);if(r.error)throw r.error;counts[status]=r.count??0;
    }
    const state=Object.hasOwn(labels,req.query.state)?req.query.state:'all';
    const q=String(req.query.q??'').trim().slice(0,100);
    const size=[10,30,50,100].includes(Number(req.query.size))?Number(req.query.size):30;
    let current=Math.max(1,Math.floor(Number(req.query.page)||1));
    const build=()=>{let r=db.from('catalog_price_jobs').select('isbn13,title,status,attempts,reason,checked_at',{count:'exact'});if(state!=='all')r=r.eq('status',state);if(q)r=r.ilike(/^\d+$/.test(q)?'isbn13':'title',`%${q.replace(/[\\%_]/g,'\\$&')}%`);return r.order('isbn13');};
    let r=await build().range((current-1)*size,current*size-1);if(r.error)throw r.error;
    const pages=Math.max(1,Math.ceil((r.count??0)/size));if(current>pages){current=pages;r=await build().range((current-1)*size,current*size-1);if(r.error)throw r.error;}
    const url=n=>'/catalog-prices?'+new URLSearchParams({state,q,size:String(size),page:String(n)});
    const paused=config.data.paused_until&&Date.parse(config.data.paused_until)>Date.now();
    const total=Object.values(counts).reduce((a,b)=>a+b,0);
    res.send(page('管理対象全体の新品価格',`<section class="panel"><h2>管理対象全体の新品価格</h2>
      <p><strong>${config.data.completed_at?'取得処理完了':!config.data.enabled?'停止中':paused?'取得先の利用制限により待機中':'取得を進めています'}</strong> ／ 対象${total}冊</p>
      <p>${Object.entries(labels).map(([status,label])=>`${label} ${counts[status]}件`).join(' ／ ')}</p>
      <p>画面を閉じても続行します。取得済みの価格・本棚の購入価格・公開許可は変更しません。AIは使用しません。</p>
      <form method="post" action="/catalog-prices/control"><input type="hidden" name="csrf" value="${csrf}"><button name="action" value="${config.data.enabled?'pause':'resume'}">${config.data.enabled?'一時停止':'再開・新しい対象を追加'}</button></form>
      <p><a href="/cache">取得したキャッシュ一覧を見る</a> ／ <a href="/catalog-prices">進捗を更新</a></p>
      <form><input name="q" value="${e(q)}" placeholder="作品名・ISBN"><select name="state"><option value="all">すべて</option>${Object.entries(labels).map(([v,t])=>`<option value="${v}" ${state===v?'selected':''}>${t}</option>`).join('')}</select><select name="size">${[10,30,50,100].map(n=>`<option ${n===size?'selected':''}>${n}</option>`).join('')}</select><button>絞り込む</button></form>
      <p>全${r.count??0}件 ／ ${current} / ${pages}ページ</p>
      ${(r.data??[]).map(row=>`<article style="padding:14px 0;border-bottom:1px solid #ddd"><strong>${e(row.title)}</strong><p>${e(row.isbn13)} ／ ${e(labels[row.status])}${row.reason?` ／ ${e(row.reason)}`:''}</p></article>`).join('')||'<p>対象はありません。</p>'}
      <nav>${current>1?`<a href="${e(url(current-1))}">前へ</a>`:''} ${current<pages?`<a href="${e(url(current+1))}">次へ</a>`:''}</nav></section>`));
  }));
  app.post('/catalog-prices/control',guard(async(req,res)=>{
    let result;
    if(req.body.action==='pause')result=await db.from('catalog_price_control').update({enabled:false}).eq('id',true);
    else if(req.body.action==='resume')result=await db.rpc('start_catalog_price_acquisition');
    else return res.status(400).send('操作を確認してください。');
    if(result.error)throw result.error;
    res.redirect(303,'/catalog-prices');
  }));
}

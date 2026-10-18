import { randomBytes, createHash } from 'node:crypto';
import { automaticReviewPanel, saveAutomaticReviewSettings } from './shushuka-automatic-review-settings.mjs';
import { fetchBook, fetchCover, snapshotCover, validIsbn } from './shushuka-content-review.mjs';

export const bulkGeneralSelectionScript = `
(() => {
  const form = document.querySelector('[data-review-classify]');
  if (!form) return;
  const select = form.querySelector('[data-select-general]');
  const undo = form.querySelector('[data-undo-general]');
  const status = form.querySelector('[data-selection-status]');
  const radios = [...form.querySelectorAll('input[type="radio"][name^="adult_"]')];
  let previous = null;
  select.addEventListener('click', () => {
    previous = radios.map(radio => radio.checked);
    radios.forEach(radio => { radio.checked = radio.value === 'false'; });
    undo.disabled = false;
    status.textContent = '表示中の' + radios.filter(radio => radio.value === 'false').length + '件を一般向けに選択しました。保存すると反映されます。';
  });
  undo.addEventListener('click', () => {
    if (!previous) return;
    radios.forEach(radio => { radio.checked = false; });
    radios.forEach((radio, index) => { if (previous[index]) radio.checked = true; });
    previous = null;
    undo.disabled = true;
    status.textContent = '一括選択する前の状態に戻しました。';
  });
})();`;

export const bulkCoverSelectionScript = `
(() => {
  const form = document.querySelector('[data-review-classify]');
  if (!form) return;
  const select = form.querySelector('[data-select-cover]');
  const undo = form.querySelector('[data-undo-cover]');
  const status = form.querySelector('[data-cover-selection-status]');
  const radios = [...form.querySelectorAll('input[type="radio"][name^="cover_"]')];
  const eligible = [...form.querySelectorAll('[data-cover-eligible="true"] input[type="radio"][name^="cover_"]')];
  let previous = null;
  select.addEventListener('click', () => {
    previous = radios.map(radio => radio.checked);
    eligible.forEach(radio => { radio.checked = radio.value === 'show'; });
    undo.disabled = false;
    status.textContent = eligible.filter(radio => radio.value === 'show').length + '件の表紙を表示可に選択しました。「選択した表紙設定をまとめて保存」で反映されます。';
  });
  undo.addEventListener('click', () => {
    if (!previous) return;
    radios.forEach(radio => { radio.checked = false; });
    radios.forEach((radio, index) => { if (previous[index]) radio.checked = true; });
    previous = null; undo.disabled = true;
    status.textContent = '表紙の一括選択をする前の状態に戻しました。';
  });
})();`;

export function reviewReturnTo(req) {
  const target=String(req.body?.return_to??req.query?.return_to??'');
  return target.startsWith('/reviews?')?target:'/reviews';
}

export function reviewPageSize(querySize,cookie='') {
  const sizes=[10,30,50,100];
  if(sizes.includes(Number(querySize)))return Number(querySize);
  const saved=String(cookie).match(/(?:^|;\s*)honnoma_review_size=(10|30|50|100)(?:;|$)/)?.[1];
  return saved?Number(saved):30;
}

export function registerReviewAdmin(app, db, service, page, escapeHtml, coverOps = { fetchCover, snapshotCover }) {
  const csrf = randomBytes(32).toString('hex'); const e = escapeHtml;
  const returnLink=req=>`<a href="${e(reviewReturnTo(req))}">一覧へ戻る</a>`;
  const token = `<input type="hidden" name="csrf" value="${csrf}">`;
  const guarded = handler => async (req,res) => {
    if (!db) return res.sendStatus(503);
    if (req.method === 'POST' && req.body?.csrf !== csrf) return res.status(403).send('ページを開き直してください。');
    try { await handler(req,res); } catch { res.status(400).send(page('確認できませんでした','<p>情報が更新されたか、取得に失敗しました。ページを開き直してください。</p>'+returnLink(req))); }
  };
  app.get('/reviews', guarded(async (req,res) => {
    const view = ['unclassified','general','adult','all'].includes(req.query.view) ? req.query.view : 'unclassified';
    const coverView=['all','show','hide','unreviewed'].includes(req.query.cover)?req.query.cover:'all';
    const sizes=[10,30,50,100];
    const size=reviewPageSize(req.query.size,req.headers?.cookie);
    if(sizes.includes(Number(req.query.size)))res.setHeader?.('Set-Cookie',`honnoma_review_size=${size}; Path=/reviews; Max-Age=31536000; HttpOnly; SameSite=Lax${req.secure?'; Secure':''}`);
    let currentPage=Math.max(1,Math.min(100000,Math.floor(Number(req.query.page)||1)));
    const publisher=String(req.query.publisher??'').slice(0,200); const search=String(req.query.q??'').trim().slice(0,200);
    const buildQuery=()=>{
      let query=db.from('book_content_review_jobs').select('isbn13,title,status,reason,cover_status,description_status,updated_at,candidate,content_hash,adult_only',{count:'exact'});
      if(view==='unclassified')query=query.is('adult_only',null);
      if(view==='general'||view==='adult')query=query.eq('adult_only',view==='adult');
      if(publisher)query=query.eq('candidate->>publisher',publisher);
      if(search)query=query.ilike(/^\d+$/.test(search)?'isbn13':'title',`%${search.replace(/[\\%_]/g,'\\$&')}%`);
      return query.order('updated_at',{ascending:view==='unclassified'}).order('isbn13',{ascending:true});
    };
    const loadPublishers=async()=>{
      const names=new Set();
      for(let start=0;;start+=1000){
        const {data,error}=await db.from('book_content_review_jobs').select('candidate->>publisher').not('candidate->>title','is',null).order('isbn13').range(start,start+999);
        if(error)throw error;
        for(const item of data??[])if(item.publisher)names.add(item.publisher);
        if((data??[]).length<1000)break;
      }
      return [...names].sort();
    };
    const loadCoverFiltered=async()=>{
      if(coverView==='all')return buildQuery().range((currentPage-1)*size,currentPage*size-1);
      const visible=new Set();
      for(let start=0;;start+=1000){
        const rows=await db.from('reviewed_book_content').select('isbn13,cover_url,enabled').eq('enabled',true).not('cover_url','is',null).order('isbn13').range(start,start+999);
        if(rows.error)throw rows.error;
        for(const row of rows.data??[])if(row.enabled&&row.cover_url)visible.add(row.isbn13);
        if((rows.data??[]).length<1000)break;
      }
      const matches=[];
      for(let start=0;;start+=1000){
        const rows=await buildQuery().range(start,start+999);if(rows.error)throw rows.error;
        for(const job of rows.data??[]){const state=visible.has(job.isbn13)?'show':job.cover_status==='held'?'hide':'unreviewed';if(state===coverView)matches.push(job);}
        if((rows.data??[]).length<1000)break;
      }
      currentPage=Math.min(currentPage,Math.max(1,Math.ceil(matches.length/size)));
      return {data:matches.slice((currentPage-1)*size,currentPage*size),count:matches.length};
    };
    const [{data: config,error: configError},result,{count: failed,error: mailError},{count: unprepared,error: prepareError},publishers] = await Promise.all([
      db.from('book_content_review_config').select('enabled,daily_limit,attempts_today,budget_day').eq('id',true).single(),
      loadCoverFiltered(),
      db.from('book_content_review_mail').select('id',{count:'exact',head:true}).eq('status','failed'),
      db.from('book_content_review_jobs').select('isbn13',{count:'exact',head:true}).is('candidate->>title',null).in('status',['queued','retry']),
      loadPublishers(),
    ]);
    if (configError || result.error || mailError || prepareError) throw new Error('Unavailable');
    const total=result.count??0;const pages=Math.max(1,Math.ceil(total/size));
    let filtered=result.data??[];
    if(currentPage>pages){currentPage=pages;const retry=await buildQuery().range((currentPage-1)*size,currentPage*size-1);if(retry.error)throw retry.error;filtered=retry.data??[];}
    const displayRows=filtered.length?await db.from('reviewed_book_content').select('isbn13,cover_url,enabled').in('isbn13',filtered.map(job=>job.isbn13)):{data:[]};
    if(displayRows.error)throw displayRows.error;
    const visibleCovers=new Set((displayRows.data??[]).filter(row=>row.enabled&&row.cover_url).map(row=>row.isbn13));
    const pageUrl=number=>`/reviews?${new URLSearchParams({view,cover:coverView,publisher,q:search,size:String(size),page:String(number)})}`;
    const returnTo=pageUrl(currentPage);
    const pager=`<nav class="review-pagination" aria-label="確認一覧のページ"><span>全${total}件 ／ ${currentPage} / ${pages}ページ</span>${currentPage>1?`<a href="${e(pageUrl(1))}">最初</a><a href="${e(pageUrl(currentPage-1))}">前へ</a>`:''}${currentPage<pages?`<a href="${e(pageUrl(currentPage+1))}">次へ</a><a href="${e(pageUrl(pages))}">最後</a>`:''}</nav>`;
    const controls=(job,index)=>!job.candidate?.title||!job.content_hash
      ? `<p class="review-waiting">${job.status==='processing'?'確認処理中です。':'書誌情報が未取得のため、分類・表紙設定はまだ保存できません。'}</p>${['queued','retry'].includes(job.status)?`<button type="submit" formaction="/reviews/prepare" name="prepare_isbn" value="${e(job.isbn13)}">書誌情報を取得</button>`:''}`
      : `<input type="hidden" name="isbn_${index}" value="${e(job.isbn13)}"><input type="hidden" name="hash_${index}" value="${e(job.content_hash)}"><div class="review-classification">
      <fieldset class="choices"><legend class="sr-only">${e(job.title)}の分類</legend><label><input type="radio" name="adult_${index}" value="false" ${job.adult_only===false?'checked':''}>一般向け</label><label><input type="radio" name="adult_${index}" value="true" ${job.adult_only===true?'checked':''}>成人向け</label></fieldset>
      <button type="submit" name="row" value="${index}">分類を保存</button><a href="/reviews/${e(job.isbn13)}">詳細</a></div>
      <div class="review-cover-actions"><fieldset class="choices"><legend class="sr-only">${e(job.title)}の表紙表示</legend><label><input type="radio" name="cover_${index}" value="show" ${visibleCovers.has(job.isbn13)?'checked':''}>表紙を表示可</label><label><input type="radio" name="cover_${index}" value="hide" ${!visibleCovers.has(job.isbn13)&&job.cover_status==='held'?'checked':''}>表紙を非表示</label></fieldset><button class="secondary" type="submit" formaction="/reviews/cover" name="cover_row" value="${index}">表紙設定を保存</button></div>`;
    const cards=filtered.map((job,index)=>`<article class="review-row" data-isbn="${e(job.isbn13)}" data-cover-eligible="${job.adult_only===false&&!!job.candidate?.cover_hash}">
      <div class="review-image">${job.candidate?.cover_hash?`<a href="/reviews/${e(job.isbn13)}/cover" target="_blank" rel="noopener"><img loading="lazy" src="/reviews/${e(job.isbn13)}/cover" alt="${e(job.title)}の表紙"></a>`:'<span>表紙未取得</span>'}</div>
      <div class="review-title"><strong>${e(job.title||`ISBN ${job.isbn13}`)}</strong>${!job.candidate?.title?'<small>書誌情報の取得待ち（AI判別前）</small>':''}<small>${e(job.candidate?.publisher||'出版社未取得')}${job.candidate?.imprint?` ／ ${e(job.candidate.imprint)}`:''}</small><small>${e(job.isbn13)} ／ ${job.adult_only===null?'未分類':job.adult_only?'成人向け':'一般向け'} ／ 表紙：${visibleCovers.has(job.isbn13)?'表示可':job.cover_status==='held'?'非表示':'未確認'}</small></div>
      <div class="review-actions">${controls(job,index)}</div></article>`).join('');
    const prepareCount=Math.max(0,Math.min(5,Number(req.query.prepared)||0));
    const prepareFailed=Math.max(0,Math.min(5,Number(req.query.prepare_failed)||0));
    const preparationNotice=req.query.prepared!==undefined?`<p role="status">書誌情報を${prepareCount}件取得しました。${prepareFailed?`${prepareFailed}件は取得できませんでした。時間を置いて再試行してください。`:''}</p>`:'';
    res.send(page('表紙・タイトルの確認',`${preparationNotice}<style>
      .review-row{display:grid;grid-template-columns:76px minmax(180px,1fr) auto;gap:20px;align-items:center;padding:16px 0;border-bottom:1px solid var(--line)}
      .review-image{width:76px;height:106px;background:#f4f4f2;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--muted)}
      .review-image img{width:76px;height:106px;object-fit:contain}.review-title strong{font-size:17px}.review-title small{display:block;margin-top:7px;color:var(--muted)}
      .review-actions{display:flex;flex-direction:column;gap:12px;align-items:flex-end}.review-classification,.review-cover-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.choices{display:flex;gap:10px;border:0;padding:0;margin:0}.choices label{display:flex;gap:6px;align-items:center;margin:0;padding:10px;border:1px solid var(--line);border-radius:8px;color:var(--text);font-size:14px;cursor:pointer}.choices input{width:auto;margin:0;accent-color:var(--accent)}
      .choices label:has(input:checked){border-color:var(--accent);background:#eff6ff}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.review-filter{display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin-bottom:12px}.review-filter label{margin:0}.review-filter input{max-width:260px}.review-filter select{width:auto}.review-footer{position:sticky;bottom:0;background:#fff;padding:15px 0;display:flex;gap:14px;flex-wrap:wrap;align-items:center;border-top:1px solid var(--line)}
      .review-pagination{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:14px 0}.review-pagination a{padding:8px 12px;border:1px solid var(--line);border-radius:6px}
      .review-footer label{margin:0;display:flex;align-items:center;gap:8px}.review-footer input{width:auto}
      .review-bulk{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:14px 0}.review-bulk p{margin:0;color:var(--muted)}.review-bulk button:disabled{opacity:.45;cursor:default}
      @media(max-width:850px){.review-row{grid-template-columns:64px minmax(0,1fr);gap:12px}.review-actions{grid-column:2;flex-wrap:wrap}.review-image,.review-image img{width:64px;height:90px}.review-title strong{font-size:15px}}
    </style>${automaticReviewPanel({config,service,token,escapeHtml:e,failed:failed??0})}<section class="panel"><h2>表紙・タイトルの確認</h2><p>表紙とタイトルを見て「一般向け／成人向け」を選び、保存してください。出版社ごとに絞り込めます。未選択の本は変更されません。</p>
      <form class="review-filter" method="get"><label>分類<select name="view">${[['unclassified','未分類'],['general','一般向け'],['adult','成人向け'],['all','すべて']].map(([v,t])=>`<option value="${v}" ${view===v?'selected':''}>${t}</option>`).join('')}</select></label>
      <label>表紙<select name="cover">${[['all','すべて'],['show','表示可'],['hide','非表示'],['unreviewed','未確認']].map(([v,t])=>`<option value="${v}" ${coverView===v?'selected':''}>${t}</option>`).join('')}</select></label><label>出版社<select name="publisher"><option value="">すべての出版社</option>${publishers.map(x=>`<option ${x===publisher?'selected':''}>${e(x)}</option>`).join('')}</select></label><label>タイトル・ISBN<input name="q" value="${e(search)}"></label><label>表示件数<select name="size">${sizes.map(n=>`<option value="${n}" ${size===n?'selected':''}>${n}件</option>`).join('')}</select></label><button>絞り込む</button></form>${pager}
      <form method="post" action="/reviews/classify" data-review-classify>${token}<input type="hidden" name="return_to" value="${e(returnTo)}">
      <div class="review-bulk"><button type="button" data-select-general ${filtered.length?'':'disabled'}>表示中をすべて一般向けに選択</button><button type="button" class="ghost" data-undo-general disabled>一括選択を戻す</button><p data-selection-status role="status" aria-live="polite">対象はこのページの本です。選択後に確認し、下の「選択した分類をまとめて保存」で保存してください。</p></div>
      <div class="review-bulk"><button type="button" data-select-cover ${filtered.some(job=>job.adult_only===false&&job.candidate.cover_hash)?'':'disabled'}>表示中の表紙をすべて表示可に選択</button><button type="button" class="ghost" data-undo-cover disabled>表紙の一括選択を戻す</button><p data-cover-selection-status role="status" aria-live="polite">一般向けとして保存済みで、表紙を取得できた本が対象です。選択後に表紙設定を保存してください。</p></div>
      <p>${total?((currentPage-1)*size+1):0}〜${Math.min(currentPage*size,total)}件目を表示（全${total}件）。分類だけの保存では表紙・紹介文の表示可否を変えません。</p>${cards||'<p>この条件の本はありません。</p>'}${pager}
      <div class="review-footer"><label><input type="checkbox" name="approve_cover">一般向けとして選んだ本の表紙も、表示可と確認して保存する</label><button name="row" value="all">選択した分類をまとめて保存</button><button class="secondary" formaction="/reviews/cover" name="cover_row" value="all">選択した表紙設定をまとめて保存</button></div></form>
      <p class="muted">表紙は各本の「表紙設定を保存」で個別に変更できます。表示可にするには、先に一般向けの分類を保存してください。表紙だけの変更では紹介文の設定は変わりません。紹介文は詳細で確認できます。</p></section>
      <script>${bulkGeneralSelectionScript}${bulkCoverSelectionScript}</script><details class="panel"><summary>書誌データの準備</summary><p>書誌未取得（取得待ち）：${unprepared??0}件。準備はAIを呼び出しません。ISBNが未設定の本は確認対象に追加されないため、先にISBNの取得・設定が必要です。</p><form method="post" action="/reviews/prepare">${token}<button>未取得の本を5件準備</button></form></details>`));
  }));
  app.post('/reviews/cover',guarded(async(req,res)=>{
    const row=String(req.body.cover_row??'');if(row!=='all'&&!/^\d{1,3}$/.test(row))throw new Error('Invalid row');
    const indexes=Object.keys(req.body).filter(key=>/^isbn_\d+$/.test(key)).map(key=>key.slice(5)).filter(index=>row==='all'||index===row);
    if(indexes.length>100)throw new Error('Too many rows');
    let saved=0;const failures=[];const deadline=Date.now()+55000;
    for(const index of indexes){
      const isbn=req.body[`isbn_${index}`],decision=req.body[`cover_${index}`];
      if(row==='all'&&decision===undefined)continue;
      if(!validIsbn(isbn)||!['show','hide'].includes(decision)){
        if(row==='all'){failures.push(isbn);continue;}
        return res.status(400).send(page('表紙の設定を選択してください','<p>「表紙を表示可／表紙を非表示」を選んで保存してください。</p>'+returnLink(req)));
      }
      try{
        if(Date.now()>deadline)throw new Error('Time limit');
        const {data:job,error}=await db.from('book_content_review_jobs').select('candidate,content_hash,adult_only').eq('isbn13',isbn).single();
        if(error||!job.candidate||job.content_hash!==req.body[`hash_${index}`])throw new Error('Updated');
        let cover=null;
        if(decision==='show'){
          if(job.adult_only!==false){
            if(row==='all'){failures.push(isbn);continue;}
            return res.status(400).send(page('先に分類を保存してください','<p>表紙を表示可にするには、一般向けとして分類を保存してから表紙設定を保存してください。</p>'+returnLink(req)));
          }
          const image=await coverOps.fetchCover(job.candidate.cover_url);
          if(image.hash!==job.candidate.cover_hash)throw new Error('Changed image');
          cover=await coverOps.snapshotCover(db,image);
        }
        const result=await db.rpc('set_book_cover_review',{p_isbn:isbn,p_hash:job.content_hash,p_show:decision==='show',p_cover:cover});
        if(result.error||!result.data)throw new Error('Updated');saved++;
      }catch{failures.push(isbn);}
    }
    if(failures.length)return res.status(row==='all'?409:400).send(page('表紙設定を確認してください',`<p>${saved}件保存しました。${failures.length}件は分類や画像が変わったか、取得できませんでした。</p><p>${failures.map(e).join('、')}</p>${returnLink(req)}`));
    res.redirect(303,reviewReturnTo(req));
  }));
  app.post('/reviews/prepare',guarded(async(req,res)=>{
    const requested=String(req.body?.prepare_isbn??'');
    if(requested&&!validIsbn(requested))throw new Error('Invalid ISBN');
    let query=db.from('book_content_review_jobs').select('isbn13,candidate,adult_only,status').in('status',['queued','retry']).is('adult_only',null).is('candidate->>title',null);
    if(requested)query=query.eq('isbn13',requested);
    const {data:jobs,error}=await query.order('created_at',{ascending:true}).limit(requested?1:5);
    if(error)throw error;
    let prepared=0,failed=0;
    const startedAt=Date.now();
    for(const job of jobs){
      if(Date.now()-startedAt>20000)break;
      if(!validIsbn(job.isbn13))continue;
      try{
        const book=await (coverOps.fetchBook??fetchBook)(db,job.isbn13);let image=null;
        if(book.cover_url){try{image=await fetchCover(book.cover_url);}catch{}}
        const candidate={...book,cover_hash:image?.hash??null,review_origin:'registration'};
        const hash=createHash('sha256').update(JSON.stringify(candidate)).digest('hex');
        const {data:saved,error:saveError}=await db.rpc('prepare_book_content_review',{p_isbn:job.isbn13,p_hash:hash,p_candidate:candidate});
        if(saveError||saved!==true)throw saveError??new Error('State changed');
        prepared++;
      }catch{failed++;}
    }
    const target=new URL(reviewReturnTo(req),'https://admin.invalid');
    target.searchParams.set('prepared',String(prepared));target.searchParams.set('prepare_failed',String(failed));
    res.redirect(303,`${target.pathname}${target.search}`);
  }));
  app.post('/reviews/classify',guarded(async(req,res)=>{
    const indexes=Object.keys(req.body).filter(x=>/^isbn_\d+$/.test(x)).map(x=>x.slice(5)).filter(x=>req.body.row==='all'||x===req.body.row);
    if(indexes.length>200)throw new Error('Too many rows');
    const failures=[];let saved=0;const deadline=Date.now()+55000;
    for(const index of indexes){
      const value=req.body[`adult_${index}`];if(value!=='true'&&value!=='false')continue;
      const isbn=req.body[`isbn_${index}`];if(Date.now()>deadline){failures.push(isbn);continue;}if(!validIsbn(isbn)){failures.push(isbn);continue;}
      const {data:job,error}=await db.from('book_content_review_jobs').select('content_hash,candidate').eq('isbn13',isbn).single();
      if(error||job.content_hash!==req.body[`hash_${index}`]){failures.push(isbn);continue;}
      try{
        let cover=null;
        if(value==='false'&&req.body.approve_cover==='on'){
          const image=await fetchCover(job.candidate?.cover_url);
          if(image.hash!==job.candidate?.cover_hash)throw new Error('Changed image');
          cover=await snapshotCover(db,image);
        }
        const {data,error:saveError}=await db.rpc('classify_book_content_review',{p_isbn:isbn,p_hash:job.content_hash,p_adult:value==='true',p_cover:cover});
        if(saveError||!data)throw new Error('Updated');saved++;
      }catch{failures.push(isbn);}
    }
    if(failures.length)return res.status(409).send(page('一部を保存しました',`<p>${saved}件保存しました。${failures.length}件は情報や画像が変わったか、取得できませんでした。</p><p>${failures.map(e).join('、')}</p>${returnLink(req)}`));
    res.redirect(303,reviewReturnTo(req));
  }));
  app.post('/reviews/settings',guarded(async (req,res)=>{
    const result=await saveAutomaticReviewSettings(db,service,req.body);
    if(result.code!==303)return res.status(result.code).send(page('自動判別の設定',`<p>${e(result.message)}</p><a href="/reviews">一覧へ戻る</a>`));
    res.redirect(303,'/reviews');
  }));
  app.get('/reviews/:isbn',guarded(async(req,res)=>{
    const {data: job,error}=await db.from('book_content_review_jobs').select('*').eq('isbn13',req.params.isbn).single();
    if(error||!job.candidate)throw new Error('Updated');
    const book=job.candidate??{};
    res.send(page('内容を確認',`<section class="panel"><h2>${e(job.title||job.isbn13)}</h2><p>${e(job.reason)}</p><p>ISBN：${e(job.isbn13)}</p>
      ${book.cover_url?`<p><a href="${e(book.source_url)}" target="_blank" rel="noopener">確認元のページ</a></p><p>表紙候補：<img class="cover" src="/reviews/${e(job.isbn13)}/cover" alt="表紙候補"></p>`:''}
      <h3>紹介文候補</h3><pre style="white-space:pre-wrap">${e(book.description||'取得できていません')}</pre>
      <form method="post">${token}<input type="hidden" name="hash" value="${e(job.content_hash)}">
      <label><input type="checkbox" name="cover" ${job.cover_status==='approved'?'checked':''} ${!book.cover_hash?'disabled':''}>この表紙を表示してよい</label>
      <label><input type="checkbox" name="description" ${job.description_status==='approved'?'checked':''} ${!book.description?'disabled':''}>この紹介文を表示してよい</label>
      <p>表示するものだけにチェックしてください。掲載できない内容は承認しないでください。</p>
      <button ${job.status!=='pending_review'?'disabled':''} name="decision" value="approve">選択した内容を承認</button><button ${job.status!=='pending_review'?'disabled':''} name="decision" value="reject">すべて非表示にする</button></form>
      <p><a href="/content?isbn=${e(job.isbn13)}">保存済みの表紙・紹介文を編集</a></p>${!book.source_url?`<p>データを取得できていません。<a href="/content?isbn=${e(job.isbn13)}">手動で確認内容を登録</a>できます。</p>`:''}</section>`));
  }));
  app.get('/reviews/:isbn/cover',guarded(async(req,res)=>{
    const {data:job,error}=await db.from('book_content_review_jobs').select('candidate,status').eq('isbn13',req.params.isbn).single();
    if(error||!job.candidate?.cover_hash)return res.sendStatus(404);
    const image=await fetchCover(job.candidate?.cover_url);
    if(image.hash!==job.candidate?.cover_hash)return res.status(409).send('画像が更新されました。再確認が必要です。');
    res.set('Cache-Control','no-store').type(image.mime).send(image.bytes);
  }));
  app.post('/reviews/:isbn',guarded(async(req,res)=>{
    const {data:job,error}=await db.from('book_content_review_jobs').select('*').eq('isbn13',req.params.isbn).single();
    if(error||job.status!=='pending_review'||job.content_hash!==req.body.hash)throw new Error('Updated');
    const book=job.candidate??{}; const approved=req.body.decision==='approve';
    let cover=null; let description=null;
    if(approved&&req.body.cover==='on'){
      const image=await fetchCover(book.cover_url);
      if(image.hash!==book.cover_hash)throw new Error('Changed image');
      cover=await snapshotCover(db,image);
    }
    if(approved&&req.body.description==='on')description=book.description||null;
    if(approved&&!cover&&!description)throw new Error('Select content');
    const {data,error:saveError}=await db.rpc('resolve_book_content_review',{p_isbn:job.isbn13,p_hash:job.content_hash,p_approved:approved,
      p_display:{cover_url:cover,description,source_url:book.source_url||`https://books.rakuten.co.jp/search?sitem=${job.isbn13}`}});
    if(saveError||!data)throw new Error('Updated');
    res.redirect(303,'/reviews');
  }));
}

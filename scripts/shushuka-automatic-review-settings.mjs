export function automaticReviewPanel({config,service,token,escapeHtml:e,failed=0}) {
  const ready=service.ready(),mailReady=service.mailReady();
  const today=new Date().toISOString().slice(0,10);
  const used=config.budget_day===today?Number(config.attempts_today)||0:0;
  return `<style>
    button.auto-review-toggle{display:inline-flex;align-items:center;gap:12px;min-height:48px;padding:4px;background:transparent;color:var(--text,#171717);border:0;font-size:18px;font-weight:700;cursor:pointer}
    .auto-review-track{display:inline-block;position:relative;width:68px;height:38px;border-radius:24px;background:#737b88;transition:background .15s}
    .auto-review-thumb{position:absolute;top:4px;left:4px;width:30px;height:30px;border-radius:50%;background:#fff;box-shadow:0 1px 4px #0003;transition:transform .15s}
    .auto-review-toggle[aria-checked="true"] .auto-review-track{background:#15803d}
    .auto-review-toggle[aria-checked="true"] .auto-review-thumb{transform:translateX(30px)}
    .auto-review-toggle:focus-visible{outline:3px solid #2563eb;outline-offset:4px;border-radius:8px}
    .auto-review-toggle:disabled{opacity:.5;cursor:not-allowed}
    @media(prefers-reduced-motion:reduce){.auto-review-track,.auto-review-thumb{transition:none}}
  </style><section class="panel" aria-labelledby="automatic-review-title"><h2 id="automatic-review-title">AIによる自動判別</h2><p role="status"><strong>${config.enabled?'ON：自動判別は有効です':'OFF：自動判別は停止しています'}</strong></p><p>API接続設定：${ready?'設定済み':'未設定'} ／ 確認待ちメール：${mailReady?'設定済み':'未設定'}</p><p>本日の処理：${used} / ${Number(config.daily_limit)}件（上限は毎日9:00・日本時間にリセット）</p><p>新しく登録された本を順に判別します。手動で確認済みの本は上書きせず、判断が難しいものは確認待ちに残します。OFFにすると次の本から処理を停止します。開始済みの処理は完了する場合があります。</p><p>「一般向け／成人向け」の分類と、表紙・タイトル・紹介文の表示可否を自動判別します。ランキングの掲載設定は管理者が行います。</p>${!ready||!mailReady?'<p>開始にはOpenAI APIキーとメール送信設定が必要です。<a href="https://dashboard.render.com/web/srv-da8ivd3bc2fs73adi4f0/env" target="_blank" rel="noopener noreferrer">Renderの設定を開く</a>（秘密のキーはこの画面やチャットには入力しません）</p>':''}<div style="display:flex;gap:12px;flex-wrap:wrap"><form method="post" action="/reviews/settings">${token}<button type="submit" class="auto-review-toggle" role="switch" aria-label="AIによる自動判別" aria-checked="${config.enabled?'true':'false'}" name="action" value="${config.enabled?'stop':'start'}" ${!config.enabled&&(!ready||!mailReady)?'disabled':''}><span class="auto-review-track" aria-hidden="true"><span class="auto-review-thumb"></span></span><span aria-hidden="true">${config.enabled?'ON':'OFF'}</span></button></form><form method="post" action="/reviews/settings" style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">${token}<label>1日の処理上限（再試行を含む）<input type="number" min="1" max="500" name="daily_limit" value="${Number(config.daily_limit)}" required></label><button class="secondary" name="action" value="limit">上限を保存</button></form></div>${failed?`<p>確認待ちメールの送信失敗：${e(failed)}件</p>`:''}<p class="muted">処理上限はAPI利用料金の上限とは異なります。ON／OFFの切り替えで、保存済みの判定結果は削除されません。</p></section>`;
}
export async function saveAutomaticReviewSettings(db,service,body) {
  const action=body.action;
  if(!['start','stop','limit',undefined].includes(action))return {code:400,message:'操作を確認してください。'};
  const {data:current,error:readError}=await db.from('book_content_review_config').select('enabled,daily_limit').eq('id',true).single();
  if(readError||!current)throw Error('Settings unavailable');
  const enabled=action==='start'?true:action==='stop'?false:action==='limit'?current.enabled:body.enabled==='on';
  const limit=action==='start'||action==='stop'?current.daily_limit:Number(body.daily_limit);
  if(!Number.isInteger(limit)||limit<1||limit>500)return {code:400,message:'1日の上限は1〜500件で指定してください。'};
  if(enabled&&action!=='limit'&&(!service.ready()||!service.mailReady()))return {code:400,message:'開始にはOpenAI APIキーとメール送信設定が必要です。Renderで設定後に、もう一度お試しください。'};
  const changes=action==='limit'?{daily_limit:limit}:action==='start'||action==='stop'?{enabled}:{enabled,daily_limit:limit};
  const {error}=await db.from('book_content_review_config').update(changes).eq('id',true);
  if(error)throw Error('Settings update failed');
  if(enabled){try{await db.rpc('wake_book_content_review');}catch{/* Regular scheduler retries within two minutes. */}}
  return {code:303};
}

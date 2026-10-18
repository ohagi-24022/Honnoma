const pageSizes = [10, 30, 50, 100];
export function notificationPageSize(value, cookie = '') {
  const saved = cookie.match(/(?:^|;\s*)honnoma_notification_size=(10|30|50|100)(?:;|$)/)?.[1];
  return pageSizes.includes(Number(value)) ? Number(value) : pageSizes.includes(Number(saved)) ? Number(saved) : 30;
}
const stageLabels = { retry_wait:'回数制限のため再試行を待機', authorization:'実行権限の確認', maintenance:'古い履歴の整理', subscriptions:'通知対象作品の読み込み', cache:'保存済みの刊行情報の確認', provider:'書籍情報サービスからの取得', publication_save:'刊行情報の保存', queue:'通知対象への追加', subscription_update:'確認済み巻数の更新', delivery:'通知の送信', receipts:'通知の到達確認' };
const reasonLabels = { deferred:'今回の処理時間の上限に近づいたため、次回の確認に持ち越しました。', rate_limit:'書籍・通知サービスの利用回数制限に達しました。時間をおいて再確認が必要です。', timeout:'接続が時間切れになりました。', network:'サービスに接続できませんでした。', service_unavailable:'サービス側で一時的な問題が発生しています。', request_rejected:'サービス側にリクエストを受け付けてもらえませんでした。', invalid_response:'書籍情報を読み取れませんでした。', unknown:'詳しい原因は記録されていません。' };
export function notificationDeliveryReason(value) {
  const text = String(value ?? '');
  if (/DeviceNotRegistered|No enabled push token/i.test(text)) return '通知先の端末登録を確認してください。';
  if (/429|rate.?limit|too many/i.test(text)) return '通知サービスの利用回数制限に達しました。';
  if (/timeout|timed out|aborted/i.test(text)) return '通知サービスとの接続が時間切れになりました。';
  if (/fetch failed|network|hostname|connection/i.test(text)) return '通知サービスに接続できませんでした。';
  return '通知サービスの受付・到達確認で問題がありました。';
}
export function notificationActivity(operations, notifications, now = Date.now()) {
  const events = [];
  const completed = new Set(operations.filter(x => x.metadata?.phase === 'completed').map(x => x.metadata?.runId).filter(Boolean));
  const latest = new Map();
  for (const row of operations) if(row.metadata?.runId && (!latest.has(row.metadata.runId) || latest.get(row.metadata.runId).created_at < row.created_at)) latest.set(row.metadata.runId,row);
  for (const row of operations) {
    const m = row.metadata ?? {};
    if (m.reason === 'unauthorized' || m.mode === 'health') continue;
    if (m.phase === 'progress' && m.runId && (completed.has(m.runId) || latest.get(m.runId) !== row)) continue;
    const checking = m.mode === 'check' || m.mode === 'all';
    const time = new Date(row.created_at);
    const at1130 = !Number.isNaN(time.valueOf()) && new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(time) === '11:30';
    const label = checking ? (at1130 ? '11:30の新刊確認' : '新刊確認') : m.mode === 'receipts' ? '通知の到達確認' : m.mode === 'retry' ? '通知の再送' : m.mode === 'deliver' ? '新刊通知の送信' : '新刊通知の処理';
    const started = m.phase === 'started';
    const progress = m.phase === 'progress';
    const stalled = m.runId && !completed.has(m.runId) && latest.get(m.runId) === row && now - time.valueOf() > 10 * 60000;
    const error = row.status === 'error';
    const details = [];
    if (m.stage && stageLabels[m.stage]) details.push(`処理段階：${stageLabels[m.stage]}`);
    if (stalled) details.push('10分以上、続きの記録がありません。処理が中断した可能性があります。');
    if (error && m.reason) details.push(reasonLabels[m.reason] ?? reasonLabels.unknown);
    if (error && !m.reason && !m.checkResults) details.push('この履歴には失敗箇所の詳細がありません。詳しい段階は更新後の実行から記録されます。');
    if (!started && !progress && checking && Number.isFinite(m.checkedCount)) details.push(`確認対象：${m.checkedCount}作品`);
    if (!started && !progress && checking && Number.isFinite(m.newReleaseCount)) details.push(m.newReleaseCount ? `${m.newReleaseCount}作品の新刊が通知対象に追加されました。` : error ? '新刊の有無を確認できなかった作品があります。' : '通知対象に追加された新刊はありませんでした。');
    if (!started && !progress && !checking && Number.isFinite(m.deliveredUserCount) && m.mode !== 'receipts') details.push(`${m.deliveredUserCount}人分の送信処理を行いました。`);
    if (!started && !progress && Number.isFinite(m.deliveryFailureCount) && m.deliveryFailureCount > 0) details.push(`停止・再試行が必要な箇所：通知の送信（${m.deliveryFailureCount}人分）`);
    if (!started && !progress && Number.isFinite(m.receiptFailureCount) && m.receiptFailureCount > 0) details.push(`確認が必要な箇所：通知の到達確認（${m.receiptFailureCount}件）`);
    for (const item of (Array.isArray(m.checkResults) ? m.checkResults : []).filter(x => x.failed)) details.push(`『${String(item.seriesTitle ?? '作品名不明')}』を確認できませんでした。${item.stage && stageLabels[item.stage] ? `停止箇所：${stageLabels[item.stage]}。` : ''}${item.reason ? reasonLabels[item.reason] ?? reasonLabels.unknown : ''}`);
    events.push({ id: `operation:${row.id}`, at: row.created_at, kind: checking ? 'check' : 'delivery', state: stalled ? '中断の可能性' : started ? '開始' : progress ? '進行記録' : error ? '要確認' : '完了', message: progress ? `${m.seriesTitle ? `『${m.seriesTitle}』：` : ''}${stageLabels[m.stage] ?? '新刊確認'}に進みました。` : started ? `${label}を開始しました。` : error ? `${label}で${checking ? '一部またはすべての作品を確認できませんでした' : '確認が必要な問題がありました'}。` : `${label}が完了しました。`, details });
  }
  const groups = new Map();
  for (const row of notifications) {
    const key = JSON.stringify([row.series_key, row.volume_number]);
    const group = groups.get(key) ?? { first: row, rows: [] };
    if (row.created_at < group.first.created_at) group.first = row;
    group.rows.push(row); groups.set(key, group);
  }
  for (const [key, { first, rows }] of groups) {
    const confirmed = rows.filter(x => x.delivered_at).length;
    const sent = rows.filter(x => x.status === 'sent' && !x.delivered_at).length;
    const pending = rows.filter(x => x.status === 'pending').length;
    const failed = rows.filter(x => x.status === 'failed').length;
    const details = [`通知対象：${rows.length}件`];
    if (confirmed) details.push(`配信サービスで到達確認済み：${confirmed}件`);
    if (sent) details.push(`配信サービス受付済み・到達未確認：${sent}件`);
    if (pending) details.push(`送信待ち・再試行待ち：${pending}件`);
    if (failed) details.push(`送信失敗：${failed}件`);
    for (const reason of new Set(rows.filter(x => x.last_error).map(x => notificationDeliveryReason(x.last_error)))) details.push(`確認箇所：通知の送信・到達確認。${reason}`);
    events.push({ id: `release:${key}`, at: first.created_at, kind: 'release', state: failed ? '要確認' : '新刊追加', message: `『${String(first.series_title ?? '作品名不明')}』${first.volume_number ? `第${first.volume_number}巻` : ''}が通知対象に追加されました。`, details });
  }
  return events.sort((a,b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}
async function recentRows(db, table, fields, since, operation = false) {
  const rows = [];
  for (let offset = 0; offset < 5000; offset += 1000) {
    let query = db.from(table).select(fields).gte('created_at', since);
    if (operation) query = query.eq('operation', 'check-new-releases');
    const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return { rows, capped: false };
  }
  return { rows, capped: true };
}
export async function loadNotificationActivity(db, now = Date.now()) {
  const since = new Date(now - 30 * 86400000).toISOString();
  const [operations, notifications] = await Promise.all([
    recentRows(db, 'server_operation_logs', 'id,created_at,status,metadata', since, true),
    recentRows(db, 'notification_logs', 'id,created_at,series_key,series_title,volume_number,status,delivered_at,last_error', since),
  ]);
  return { events: notificationActivity(operations.rows, notifications.rows, now), capped: operations.capped || notifications.capped };
}
export function registerNotificationAdmin(app, db, page, escapeHtml) {
  const e = escapeHtml;
  app.get('/notifications', async (req, res) => {
    if (!db) return res.status(503).send(page('新刊通知の履歴', '<p>履歴を取得できません。時間をおいて再読み込みしてください。</p>'));
    try {
      const { events, capped } = await loadNotificationActivity(db);
      const size = notificationPageSize(req.query.size, req.headers?.cookie);
      res.setHeader('Set-Cookie', `honnoma_notification_size=${size}; Path=/notifications; Max-Age=31536000; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`);
      const q = String(req.query.q ?? '').trim().slice(0, 200);
      const kind = ['all','check','release','delivery'].includes(req.query.kind) ? req.query.kind : 'all';
      const filtered = events.filter(row => (kind === 'all' || row.kind === kind) && (!q || (row.message + row.details.join(' ')).normalize('NFKC').toLowerCase().includes(q.normalize('NFKC').toLowerCase())));
      const pages = Math.max(1, Math.ceil(filtered.length / size));
      const current = Math.min(pages, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
      const link = n => '/notifications?' + new URLSearchParams({ q, kind, size: String(size), page: String(n) });
      const date = value => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).format(new Date(value));
      res.send(page('新刊通知の履歴', `<style>.notice-filter{display:flex;gap:14px;flex-wrap:wrap;align-items:end}.notice-filter label{min-width:160px}.notice-event{padding:20px 0;border-top:1px solid var(--line)}.notice-event time{color:var(--muted);font-size:14px}.notice-event h3{margin:10px 0;font-size:18px}.notice-event p{margin:6px 0}.notice-state{margin-left:12px;font-weight:700}.notice-pager{display:flex;justify-content:space-between;align-items:center;margin-top:20px}</style><section class="panel"><h2>新刊通知の履歴</h2><p>毎日11:30に新刊を確認し、11:40・11:50にも再確認します。取得済みの情報は再利用し、12:00に通知を送信します。時刻は日本時間です。</p><p class="muted">過去30日間の確認・新刊追加・通知処理を表示します。新刊追加は通知対象への追加を意味し、本棚への登録ではありません。送信状態は現在の状態です。処理段階と失敗箇所も表示します。10分以上続きの記録がない場合は、中断の可能性を表示します（中断の確定ではありません）。確認対象がなく処理が実行されなかった日は記録されません。</p>${capped ? '<p role="status">件数が多いため、確認履歴・通知履歴それぞれ最新5,000件を表示しています。</p>' : ''}<form method="get" class="notice-filter"><label>作品・メッセージ<input name="q" value="${e(q)}"></label><label>種類<select name="kind">${[['all','すべて'],['check','新刊確認'],['release','新刊追加'],['delivery','通知の送信・到達確認']].map(([v,t])=>`<option value="${v}" ${kind===v?'selected':''}>${t}</option>`).join('')}</select></label><label>表示件数<select name="size">${pageSizes.map(n=>`<option ${size===n?'selected':''} value="${n}">${n}件</option>`).join('')}</select></label><button>表示する</button><a class="button secondary" href="${e(link(current))}">再読み込み</a></form></section><section class="panel"><p>${filtered.length}件 ／ ${current} / ${pages}ページ</p>${filtered.slice((current-1)*size,current*size).map(row=>`<article class="notice-event"><time>${e(date(row.at))}</time><span class="notice-state">${e(row.state)}</span><h3>${e(row.message)}</h3>${row.details.map(text=>`<p>${e(text)}</p>`).join('')}</article>`).join('') || '<p>該当する履歴はありません。</p>'}<div class="notice-pager">${current>1?`<a class="button secondary" href="${e(link(current-1))}">前へ</a>`:'<span></span>'}<span>${current} / ${pages}</span>${current<pages?`<a class="button secondary" href="${e(link(current+1))}">次へ</a>`:'<span></span>'}</div></section>`));
    } catch {
      res.status(503).send(page('新刊通知の履歴', '<p>履歴を取得できませんでした。時間をおいて再読み込みしてください。</p>'));
    }
  });
}

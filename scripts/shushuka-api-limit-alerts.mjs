import {sendAdminMail} from './shushuka-admin-mail.mjs';
const sources = { wishlist_search: '欲しい本のAI検索', content_review: '表紙・紹介文の自動判別' };
const reasons = {
  rate_limit: 'OpenAI APIの短時間の利用回数・トークン制限を検知しました。時間をおいてご確認ください。',
  quota: 'OpenAI APIのクレジット不足、利用枠または支出上限を検知しました。OpenAIの請求・上限設定をご確認ください。',
  daily_limit: 'アプリ側で設定したAI検索全体の1日100件の上限に達しました。日本時間の翌リセット時刻（9:00）以降に新しい検索を利用できます。',
};
export function apiLimitMailReady(env) {
  return !!(env.CONTENT_REVIEW_SMTP_HOST && env.CONTENT_REVIEW_SMTP_USER && env.CONTENT_REVIEW_SMTP_PASSWORD && env.CONTENT_REVIEW_MAIL_FROM && env.CONTENT_REVIEW_MAIL_TO);
}
// Inspect only structured error identifiers. Never persist or mail the raw provider reply.
export async function openAiLimitKind(response) {
  let error;
  try { error = (await response.json())?.error; } catch { /* Some gateways do not return JSON. */ }
  const quota = new Set(['insufficient_quota','credit_balance_exhausted','organization_spend_limit_exceeded','project_spend_limit_exceeded','organization_usage_limit_exceeded','usage_limit_exceeded','billing_hard_limit_reached']);
  if (quota.has(error?.code) || error?.type === 'insufficient_quota') return 'quota';
  if (response.status === 429 || ['rate_limit_exceeded','slow_down'].includes(error?.code)) return 'rate_limit';
  return null;
}
export function createApiLimitAlerts(db, env = process.env, deps = {}) {
  let flushing = false;
  const rpc = async (name, args) => {
    const result = await db.rpc(name, args);
    if (result.error) throw new Error('Alert storage unavailable');
    return result.data;
  };
  async function flush() {
    if (flushing || !db || !apiLimitMailReady(env)) return;
    flushing = true;
    try {
      // Bounded work, also drained by the existing worker even when AI review is OFF.
      for (let i=0;i<2;i++) {
        const [alert] = await rpc('claim_api_limit_mail') ?? [];
        if (!alert) break;
        let sent = false;
        try {
          const detected = new Date(alert.created_at).toLocaleString('ja-JP', { timeZone:'Asia/Tokyo', hour12:false });
          await sendAdminMail(env,{
            from: env.CONTENT_REVIEW_MAIL_FROM, to: env.CONTENT_REVIEW_MAIL_TO,
            subject: alert.is_test ? '【本の間】API制限通知のテストメール' : `【本の間】${sources[alert.source]}の利用制限を検知しました`,
            messageId: `<api-limit-${alert.id}@honnoma.review>`,
            text: alert.is_test ? 'これは、ご依頼に基づくAPI制限通知の送信テストです。\n実際のAPI制限やクレジット不足は発生していません。\n\nこのメールが届けば、管理アプリから設定済みの宛先への通知送信を確認できます。\n通常の制限通知・復旧後の再通知の記録には影響しません。\n\n管理画面：https://shushukaadmin.onrender.com/reviews' : `対象：${sources[alert.source]}\n検知日時：${detected}（日本時間）\n\n${reasons[alert.kind]}\n${alert.recovered_at ? 'この通知の送信前に正常な処理を確認し、復旧済みとして記録しています。\n' : ''}\n同じ制限が続く間は1日1通までに抑えます。復旧を確認後に再発した場合は、同じ日でも改めて通知します（1日の区切りは日本時間9:00）。\n検索語・個人の本棚・APIキーはこの通知に含めていません。\n\nOpenAIの設定：https://platform.openai.com/settings/organization/billing/overview\n管理画面：https://shushukaadmin.onrender.com/reviews`,
          },{transport:deps.transport,fetcher:deps.mailFetch});
          sent = true;
        } catch(error) { console.warn('API limit alert mail failed; queued for retry.', {code:error.code??'MAIL_FAILED'}); }
        await rpc('finish_api_limit_mail', { p_id:alert.id, p_lease:alert.lease_token, p_sent:sent });
      }
    } catch { console.warn('API limit alert queue unavailable.'); }
    finally { flushing = false; }
  }
  async function notify(source, kind) {
    if (!db || !sources[source] || !reasons[kind]) return;
    try { await rpc('enqueue_api_limit_mail', { p_source:source, p_kind:kind }); }
    catch { console.warn('API limit alert could not be queued.'); return; }
  }
  async function recover(source, kind, requestStartedAt) {
    if (!db || !sources[source] || !reasons[kind]) return;
    try { await rpc('recover_api_limit_mail', { p_source:source, p_kind:kind, p_request_started_at:requestStartedAt }); }
    catch { console.warn('API limit recovery could not be recorded.'); }
  }
  return { notify, flush, recover };
}

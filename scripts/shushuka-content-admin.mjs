// Install alongside ShushukaAdmin/server.js, after requireAdmin middleware.
import { randomBytes } from 'node:crypto';

export function registerContentAdmin(app, supabase, page, escapeHtml) {
  const csrf = randomBytes(32).toString('hex');
  const e = escapeHtml;
  const field = (name, label, value = '', textarea = false) => `<label>${label}</label>${textarea ? `<textarea name="${name}">${e(value ?? '')}</textarea>` : `<input name="${name}" value="${e(value ?? '')}">`}`;
  const token = `<input type="hidden" name="csrf" value="${csrf}">`;
  const https = (value, required = false) => {
    const text = String(value ?? '').trim();
    if (!text && !required) return null;
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('URLは認証情報を含まないhttps形式で入力してください。');
    return text;
  };
  const guarded = (handler) => async (req, res) => {
    if (!supabase) return res.status(503).send('Supabase is not configured.');
    if (req.method === 'POST' && req.body.csrf !== csrf) return res.status(403).send('ページを開き直して保存してください。');
    try { await handler(req, res); }
    catch (error) { res.status(400).send(page('保存・取得エラー', `<p>${e(error.message)}</p><a href="${req.path}">戻る</a>`)); }
  };
  app.get('/content', guarded(async (req, res) => {
    const isbn = String(req.query.isbn ?? '').replace(/[^0-9]/g, '');
    const { data, error } = await supabase.from('reviewed_book_content').select('*').order('reviewed_at', { ascending: false }).limit(200);
    if (error) throw error;
    let row = data.find((item) => item.isbn13 === isbn) ?? {};
    if (isbn && !row.isbn13) {
      const { data: found, error: lookupError } = await supabase.from('reviewed_book_content').select('*').eq('isbn13', isbn).maybeSingle();
      if (lookupError) throw lookupError;
      row = found ?? row;
    }
    res.send(page('表紙・紹介文の確認', `<section class="panel">
      <h2>ISBNごとの表紙・紹介文</h2><p>ここに保存した内容だけがアプリに表示されます。一般向け作品という分類だけで全巻を承認しないでください。画像URLと紹介文を個別に確認してください。</p>
      <form method="get"><label>ISBNで検索</label><input name="isbn" value="${e(isbn)}"><button>検索</button></form>
      <form method="post">${token}${field('isbn13', 'ISBN（13桁）', row.isbn13 ?? isbn)}${field('cover_url', '確認した表紙URL（空欄なら表紙なし）', row.cover_url)}
      ${row.cover_url ? `<p><img class="cover" src="${e(row.cover_url)}" alt="確認対象の表紙"><a href="${e(row.cover_url)}" target="_blank" rel="noopener">画像を確認</a></p>` : ''}
      ${field('description', '確認した紹介文（未確認の文章は入れない）', row.description, true)}${field('source_url', '確認元URL（必須）', row.source_url)}
      <label>表示可否</label><select name="enabled"><option value="false" ${!row.enabled ? 'selected' : ''}>非表示・確認待ち</option><option value="true" ${row.enabled ? 'selected' : ''}>確認済み・表示可</option></select>
      <p>露骨な性的表現等の掲載不可の内容は表示可にしないでください。内容が変わる場合は再確認し、必要なら非表示に戻してください。</p><button>確認内容を保存</button></form></section>
      <section class="panel"><h2>最新200件</h2><table><tr><th>ISBN</th><th>状態</th><th>確認日時</th></tr>${data.map((item) => `<tr><td><a href="/content?isbn=${e(item.isbn13)}">${e(item.isbn13)}</a></td><td>${item.enabled ? '表示可' : '非表示'}</td><td>${e(item.reviewed_at)}</td></tr>`).join('')}</table></section>`));
  }));
  app.post('/content', guarded(async (req, res) => {
    const isbn = String(req.body.isbn13 ?? '').replace(/[^0-9]/g, '');
    if (!/^\d{13}$/.test(isbn)) throw new Error('ISBNは13桁で入力してください。');
    const description = String(req.body.description ?? '').trim() || null;
    if (description && description.length > 20000) throw new Error('紹介文は20000文字以内で入力してください。');
    const { error } = await supabase.from('reviewed_book_content').upsert({
      isbn13: isbn, cover_url: https(req.body.cover_url), description,
      review_source: 'manual', source_url: https(req.body.source_url, true), enabled: req.body.enabled === 'true', reviewed_at: new Date().toISOString(),
    });
    if (error) throw error;
    res.redirect(303, `/content?isbn=${isbn}`);
  }));
  app.get('/rankings', guarded(async (req, res) => {
    const { data, error } = await supabase.from('public_ranking_catalog').select('*').order('reviewed_at', { ascending: false }).limit(200);
    if (error) throw error;
    const row = data.find((item) => item.ranking_key === req.query.key) ?? {};
    res.send(page('ランキング掲載管理', `<section class="panel"><h2>公開ランキング</h2><p>成人向け専用・未確認は公開されません。本棚の登録や表示設定には影響しません。シリーズキーは既存データのキーを使用してください。</p>
      <form method="post">${token}${field('ranking_key', 'シリーズキー', row.ranking_key)}${field('title', '公開作品名', row.title)}${field('isbn13', '代表巻のISBN', row.isbn)}${field('cover_url', '確認した表紙URL', row.cover_url)}${field('source_url', '確認元URL', row.source_url)}
      <label>成人向け専用の分類</label><select name="adult_only"><option value="" ${row.adult_only == null ? 'selected' : ''}>未確認</option><option value="false" ${row.adult_only === false ? 'selected' : ''}>一般向けとして確認済み</option><option value="true" ${row.adult_only === true ? 'selected' : ''}>成人向け専用</option></select>
      <label>掲載状態</label><select name="enabled"><option value="false" ${!row.enabled ? 'selected' : ''}>非掲載</option><option value="true" ${row.enabled ? 'selected' : ''}>掲載（一般向け確認済みのみ）</option></select><button>保存</button></form></section>
      <section class="panel"><table><tr><th>作品</th><th>状態</th></tr>${data.map((item) => `<tr><td><a href="/rankings?key=${encodeURIComponent(item.ranking_key)}">${e(item.title)}</a></td><td>${item.enabled && item.adult_only === false ? '掲載対象' : '非掲載'}</td></tr>`).join('')}</table></section>`));
  }));
  app.post('/rankings', guarded(async (req, res) => {
    const rankingKey = String(req.body.ranking_key ?? '').trim();
    const title = String(req.body.title ?? '').trim();
    const isbn = String(req.body.isbn13 ?? '').replace(/[^0-9]/g, '');
    if (!rankingKey || !title || !/^\d{13}$/.test(isbn)) throw new Error('キー・作品名・ISBNを入力してください。');
    const adultOnly = req.body.adult_only === 'false' ? false : req.body.adult_only === 'true' ? true : null;
    const { error } = await supabase.from('public_ranking_catalog').upsert({
      ranking_key: rankingKey, title, isbn: isbn, cover_url: https(req.body.cover_url), source_url: https(req.body.source_url, true),
      adult_only: adultOnly, enabled: req.body.enabled === 'true' && adultOnly === false, reviewed_at: new Date().toISOString(),
    });
    if (error) throw error;
    res.redirect(303, `/rankings?key=${encodeURIComponent(rankingKey)}`);
  }));
}

# 補正URL画面・ISBN検索の修正（2026-10-08）

## 本番反映済み

- ShushukaAdminの `server.js` の補正画面処理を `override-admin.mjs` へ移動。
- 本の選択欄と補正URL編集欄を分離。URLを横幅いっぱいに配置し、シリーズ・作者などは開閉欄へ整理。
- 本棚・取得済み書誌・確認用データ・保存済み補正を検索。ISBNのハイフンと全角数字を正規化。
- 確認用データから巻情報URL・表紙URL・巻数などを入力欄へ引き継ぐ。
- URL形式、整数項目、保存時のCSRFを検証。入力エラー時は内容を保持。
- 補正APIが呼んでいた未定義の `readMetadataCacheFallback` も実装。確認待ちデータは公開APIへ返さない。
- テスト: `test-override-admin.mjs`、`test-manual-review-list.mjs`、`test-automatic-content-review.mjs` 通過。
- 既存の未コミットの `.gitignore`、README、packageファイル、render.yaml は変更・反映対象外。
- 自動承認審査で停止後、ユーザーがmainへの反映とRender本番更新を明示承認。コミット `475ef5fd1eeeebe23f5e9507bda5e4c2e96b7d30` を反映。Render `dep-db3ggao473hc73bgnkgg` が live（2026-10-08 03:06:24 UTC）。

## 本番データを修正済み

ISBN `9784088744421`（ONE PIECE 48）:

- 本棚や書誌キャッシュではなく、確認用の `book_content_review_jobs` に存在していたため旧補正URL検索では見つからなかった。
- 表紙取得の409「画像が更新されました」をSafariで再現。
- Macで取得した楽天の画像は登録時ハッシュと一致したが、Render経由では不一致。同じURLでも取得結果に差があることを確認。地域差などの具体的要因は未確定。
- 出版社公式でISBN・巻数・作者・発売日を確認し、公式JPEGへ差し替え。`prepare_book_content_review` により未分類・未承認のまま再準備。
- Safariの本番確認一覧でISBN検索が1件ヒットし、公式表紙が正常表示されることを確認。
- 成人向け分類・表紙の公開承認は変更していない。

公式書誌: https://www.s-manga.net/items/contents.html?isbn=9784088744421

画面プレビュー: `design/store-screenshots/2026-10-07/correction-url-editor-preview.jpg`

本番の補正URL画面でも `9784088744421` が検索にヒットし、選択するとタイトル・巻情報URL・表紙URLが自動入力されることをSafariで確認。画面: `design/store-screenshots/2026-10-07/correction-url-editor-live.jpg`。

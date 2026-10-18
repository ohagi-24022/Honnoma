# AI自動判別と確認中表紙

## 自動判別

- 管理画面 /reviews の上部にON/OFF、API・メール設定状況、当日の処理件数・上限を表示。
- 初期上限は既存設定の50件/日を維持。日付はDBのUTC日付、JST9時にリセット。
- 一般向け/成人向け/判断保留をAIで判定し、表紙・紹介文の表示判定を別々に行う。
- 手動判定はclassification_source=manualとして保護。既存4995件を手動判定として維持。
- 判別不能はpending_review。ランキングへの登録・掲載は自動化しない。
- 本番の設定確認APIで enabled=false, apiReady=false, mailReady=false を確認。実際のOpenAI API呼び出しは行っていない。
- 開始にはRenderのOPENAI_API_KEYと、CONTENT_REVIEW_SMTP_HOST / SMTP_USER / SMTP_PASSWORD / MAIL_FROM / MAIL_TO（すべてCONTENT_REVIEW_接頭辞）が必要。
- 管理画面コミット7956197、DB migration automatic_audience_classification反映済み。
- JSの判定・設定・公開画像のテスト、およびロールバックするDBテストで手動判定保護、一般/成人/保留、未分類の公開拒否、ランキング不変更、非管理者の実行不可を検証。

## 確認中表紙

- 公開URL：https://shushukaadmin.onrender.com/assets/cover-pending.png
- 元画像：assets/book-placeholders/cover-pending.png（600x860 PNG）。
- Renderで固定URLを公開、Cache-Control public,max-age=300。
- アプリの未確認表示に上記URLを使用する変更を用意。公開済み表紙を優先し、通信失敗時は文字表示、コンテンツ表示OFFでは画像を表示しない。
- インストール済みバイナリには外部の代替画像を取得する処理がないため、初回反映は次回アプリ更新が必要。ビルド・ストアへの送信は実行していない。
- 初回反映後は、固定URLの画像差し替えにアプリの再ビルドは不要。
- TypeScriptチェックと既存の表紙公開制御・通信失敗・表示OFFのテストが通過。

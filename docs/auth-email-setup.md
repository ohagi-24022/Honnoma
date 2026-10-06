# 認証メールの設定と確認

2026年10月5日に追加した機能:

- 設定のログイン欄からパスワード再設定メールを送信する。
- 設定または新規登録画面から確認メールを再送する。
- 確認済みのメールリンクから本の間へ戻る。
- プライバシーポリシーから問い合わせフォーム・メールアプリを開く。

## サーバー側

Supabaseプロジェクト `ccaregwftbjqwaztvwdu` の Redirect URLs に
`honnoma://auth-callback` を登録済み。アプリの登録・再送・再設定処理は、
いずれもこの戻り先を明示している。広いワイルドカードは不要。

確認メールと再設定メールは標準テンプレートの `{{ .ConfirmationURL }}` を使う。
メール内のリンクは本の間がインストールされている端末で開く。
Expo Goではなく、新しいpreviewまたは本番ビルドを使う。

## Gmailを送信元にする設定

ユーザー指定の送信元は `ohagiworks.contact@gmail.com`。
GmailのSMTPを使い、以下の値をSupabase管理画面に入力する。

| 項目 | 値 |
| --- | --- |
| Sender email address | ohagiworks.contact@gmail.com |
| Sender name | 本の間 |
| Host | smtp.gmail.com |
| Port number | 465 |
| Username | ohagiworks.contact@gmail.com |
| Password | このGoogleアカウントで発行したアプリパスワード |
| Minimum interval per user | 60秒 |

2026年10月5日、ユーザーがアプリパスワードを入力して保存。
別タブから設定を読み直し、SMTPが有効、送信元・表示名・ホスト・ポート・ユーザーが
上記の値で保存されていることと、パスワードが登録済みであることを確認した。
戻り先 `honnoma://auth-callback` の登録も確認済み。
実際のメール到達と実機での再設定は、まだ未確認。

1. 送信元のGoogleアカウントで2段階認証を有効にする。
2. アプリパスワードを発行する。名前は「本の間 Supabase」など識別できるものにする。
3. 本人がSupabaseのPassword欄に直接入力して保存する。
   通常のGoogleパスワードは使わない。秘密情報をチャット、アプリの環境変数、リポジトリに入れない。
4. テスト用アドレスでメールの到達とリンクを確認する。

Supabaseの管理画面には、Gmailが個人向けメール送信サービスであり、
認証メールの到達に影響する可能性がある旨の表示がある。
送信数と到達状況を確認しながら運用する。

管理画面:
https://supabase.com/dashboard/project/ccaregwftbjqwaztvwdu/auth/smtp

Googleのアプリパスワード:
https://myaccount.google.com/apppasswords

公式説明:
https://support.google.com/accounts/answer/185833?hl=ja
https://supabase.com/docs/guides/auth/auth-smtp

## 実機確認

### previewの接続設定

2026年10月5日、EASの`preview`環境に`EXPO_PUBLIC_SUPABASE_URL`と
`EXPO_PUBLIC_SUPABASE_ANON_KEY`を登録した。ローカルの`.env`だけでは
クラウドで作るアプリに接続設定が入らない。
`eas.json`で各ビルドの環境を明示し、クラウドビルド中にこの2項目が不足している場合は
`app.config.js`でビルドを止める。値はEASで管理し、この文書には記載しない。

接続設定の変更は新しく作成したビルドに反映される。
古いpreviewはビルド11以降へ入れ替える。
`development`と`production`でクラウドビルドする場合も、それぞれのEAS環境に
同じ2項目を事前登録する。公開用キーのみを使い、`service_role`や秘密キーは使わない。

送信サービス設定後、テスト用のメールアドレスを使って確認する。

1. 新規登録 → 確認メールのリンク → 本の間で確認完了を表示。
2. 未確認の登録について確認メールを再送。連打できず、60秒の待ち時間が表示される。
3. ログアウト → 再設定メール → アプリを終了した状態でメールリンクを開く → 新しいパスワードを設定。
4. アプリが起動している状態でも再設定メールのリンクから同じ画面に移動できる。
5. 次回ログインで新しいパスワードを使える。
6. 期限切れのメールリンクは再送案内を表示する。
7. 問い合わせフォームが開き、メールボタンは宛先・件名が入った作成画面を開く。
   メールアプリ未設定の場合は、アドレスをコピーできる案内が表示される。

実装の入力チェックは `node scripts/test-auth-recovery.mjs`、型のチェックは
`npm run typecheck`。実際のメール到達と端末上のアプリ起動は、実機で別途確認する。

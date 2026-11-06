# 認証メールでpreviewが開く問題（2026-11-02）

## 原因

本番とpreviewはiOS Bundle IDを分けていたが、schemeが共通の`honnoma`だった。新規登録、確認メール再送、パスワード再設定はすべて`honnoma://auth-callback`を使っていた。両アプリがインストールされているとOSのリンク処理が競合する。リンク先の競合はSupabaseのSite URLだけでは解消しない。

## ローカルの変更

- previewのschemeを`honnoma-preview`へ分離。本番の`honnoma`は維持。
- 認証の戻り先をExpoの実際のschemeから選択。受信時も自分の環境のschemeだけを許可し、別環境や不正なホスト・パス・ユーザー情報・ポートを拒否。
- Androidもpreviewのpackageを`.preview`に分け、iOSと識別方法を合わせた。
- 本番/preview/developmentの設定と実際の認証コールバックの整合、signup/recovery、別環境拒否、既存の不正URL・期限切れ・パスワード検証のテスト成功。
- 型チェック・git diff --check成功。

## サーバー側の確認・反映

初回はSupabase Dashboardがログアウト状態だったためログインを依頼。その後のログイン完了連絡を受け、URL Configurationとメールテンプレートを確認した。

本番の`honnoma://auth-callback`を維持し、今後のpreview用に`honnoma-preview://auth-callback`を完全一致URLとして追加。保存成功通知と、設定画面を開き直して2件が保持されていることを確認した。ワイルドカードは追加していない。

Confirm sign up / Reset passwordの本文はともに`{{ .ConfirmationURL }}`を使っており、previewへの固定リンクはなかった。本文の変更は不要。Site URLは既存の`http://localhost:3000`のまま維持した。アプリの3つのメール送信経路はすべて明示的に許可済みの戻り先を指定するため、本件の競合原因ではない。将来Web認証などを追加する場合は既定値の用途を改めて確認する。

記録画像：`screenshots/auth-redirects-2026-11-02.png`。本作業では検証目的のメール送信や本人のアカウント変更は行っていない。

## 既存端末での対処

旧preview版のネイティブ設定はソース変更だけでは変わらない。ビルド21を今すぐ確認するには、preview側の必要なデータを同期・退避してから旧preview版を端末から外し、本番版から確認メールを再送する。アプリ削除で同期前の端末内データが失われ得るため、先に保全する。

新しいpreview版で恒久的に分離するには再ビルド・インストールが必要。本作業ではビルド・アップロード・審査再提出はしていない。本番版21のschemeは既に正しいため、旧previewを外す対処だけで本件の競合を避けられるが、メール認証そのものの実機完了は未検証。

## 公式資料

- https://docs.expo.dev/versions/v56.0.0/
- https://docs.expo.dev/versions/v56.0.0/sdk/linking/
- https://supabase.com/docs/guides/auth/native-mobile-deep-linking
- https://supabase.com/changelog.md （確認時、直近に本件のリンク競合を説明する変更なし。11月10日予定の旧TLS暗号スイート廃止は本件のscheme競合とは別問題。）

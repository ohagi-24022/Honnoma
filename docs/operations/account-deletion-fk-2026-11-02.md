# 本棚があるアカウントの削除失敗（2026-11-02）

## 原因

delete-accountはHTTP 500。Authログは `books_user_id_fkey` / SQLSTATE 23503。ログのuser_deletedというイベント名だけを成功と解釈しない。HTTP 500と外部キー違反によりAuth側の削除は失敗している。

本番のpublic.books.user_id外部キーは `REFERENCES auth.users(id)`（NO ACTION）で、既存の本棚があるユーザーの削除を禁止する状態。初期移行ファイルのCREATE TABLE IF NOT EXISTSはON DELETE CASCADEを指定するが、既存テーブルの制約を変更しないため本番と差異が残っている。

auth.usersを参照する他の個人用テーブル（wanted_manga、favorite_series、series_metadata、series_reading_suggestions、wishlist_ai_search_usage、通知3テーブル）はCASCADE。Storageにユーザー所有のオブジェクトは0件。booksにDELETEトリガーや、booksを参照する外部キーは確認されなかった。

## 修正案と保留

`supabase/migrations/20261102145808_account_deletion_books_cascade.sql` に、books_user_id_fkeyをON DELETE CASCADEへ変更する原子的なDDLを用意。外部キー変更時点でユーザー・本棚を削除する処理は含めない。以後、アカウント削除時に該当ユーザーの本棚も不可逆に削除される。

本番適用は自動承認審査に拒否された。「この具体的な破壊的副作用への明示承認が確認できないため、適用前に確認が必要」との理由。本番設定は未変更。別経路で適用しない。ユーザーの承認後に本番適用・検証を行う。

本番の実在するユーザーの削除や、本人アカウントを使った削除実験はしていない。アプリビルドは不要。Edge Functionと認証・RLSの設定を弱める変更も不要。

## 検証

適用前に4ユーザー・459冊を確認。修正後の実テーブル検証用SQLは `supabase/tests/account_deletion_books_cascade.sql`。生成した2人だけのデータを使い、該当ユーザーの本棚連動削除・他人のデータ維持を確認し、全体をROLLBACKする。現時点では本番制約が未変更のため、この修正後テストは未実行。

事前確認として、public.booksの列・デフォルト・CHECK制約を複製した一時テーブルと、一時ユーザーテーブルだけでCASCADE動作を検証し成功。対象の巻だけが消え、別ユーザーの巻が残ることを確認した。ROLLBACK後も実在データは4ユーザー・459冊のまま。本番のFKがNO ACTIONのままであることも確認した。

既存のsecurity/performanceアドバイザーを確認。RLS有効かつポリシーなしの管理用表、SECURITY DEFINER公開権限、漏洩パスワード保護OFF、RLS initplan等の既存通知がある。本件のFK違反の原因ではなく、今回権限を緩める修正はしない。

公式根拠：https://supabase.com/docs/guides/auth/managing-user-data （ユーザーデータとの外部キーにON DELETE CASCADEを指定する例）。

## 承認後の本番適用と検証完了

ユーザーが「本番へ反映する」と明示承認した後、本番へ適用成功。移行履歴のversionは20261102145808（2026年11月2日23:58 JST）。ローカルの移行ファイル名もこのversionに合わせた。

修正後テスト `supabase/tests/account_deletion_books_cascade.sql` を本番で実行し成功。生成した2人だけのデータで、アカウント削除時に本人の本棚が消え、もう1人の本棚が残ることを確認。検証は全体をROLLBACK。実在ユーザー4件・本棚459冊は変更前後で同数であり、実在アカウントの削除は実行していない。

制約が実際にON DELETE CASCADEとなったことを再照会。適用後のセキュリティアドバイザーも確認し、通知の種類・件数は適用前と同じ。Edge Functionやクライアントの変更・再ビルドは不要で、ビルド21から次回の削除操作に適用される。実機からの再実行完了はユーザー側で確認する。

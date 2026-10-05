# 新刊通知のサーバー設定

`check-new-releases` は JWT 検証を有効にして公開する。
`notification_scheduler_setup` マイグレーションを適用し、Vault に
`project_url` と `notification_gateway_key`（このプロジェクトの legacy anon JWT）を保存してから、
`check-new-releases.sql` を実行する。同名のジョブは更新され、重複登録されない。
`notification_scheduler_secret` はマイグレーションで生成される。
秘密値はコードやアプリの環境変数に保存しない。

スケジュール（日本時間）:

- 毎日 11:30: 新刊確認（最大100シリーズ）
- 毎日 12:00: 通知送信（最大100ユーザー）
- 12:05〜20:55の10分ごと: 送信を試みて失敗した通知のみ再試行（最大5回）
- 15分ごと: Expoの送信結果確認（送信から15分以上、24時間以内の通知）

2026年10月5日に、各ジョブに対象データの存在条件を追加した。
対象がなければEdge Functionを呼び出さない。既存4ジョブを更新し、時刻とジョブ数は変更しない。
再試行・送信結果確認の時刻は、対象の有無を調べる時刻であり、通知を送る時刻ではない。

通知は購読をONにしたシリーズで、既知の巻数より大きい巻が見つかった時だけ登録される。
ユーザー・シリーズ・巻数の一意制約で同じ巻の再登録を防ぐ。
複数作品はユーザーごとにまとめて、各有効端末へ1通を送る。
通知の表示名は「本の間」、本文には最大3作品の名前と巻数を含め、タップすると `/notifications` を開く。
作品数が4以上なら残りの作品数を表示する。通知本文は「新刊情報が見つかった」と表現し、発売済みを断定しない。
同じまとめ通知の送信結果は、巻ごとに重複問い合わせしない。

`sent` は Expo に受け付けられた状態。
`delivered_at` は APNs/FCM への引き渡し成功を確認した時刻であり、端末での表示保証ではない。
無効な端末トークンは無効化し、送信結果の失敗理由を `last_error` に記録する。

確認方法:

```sql
select jobname, schedule, active from cron.job where jobname like 'honnoma-%';
select jobid, status, start_time, end_time, return_message
from cron.job_run_details order by start_time desc limit 10;
select operation, status, metadata, created_at
from public.server_operation_logs
where operation = 'check-new-releases' order by created_at desc limit 10;
```

cron の成功は HTTP リクエストをキューに登録できたことを示す。
関数の実行結果は `net._http_response` の HTTP ステータス・`ok` と
`server_operation_logs` を併せて確認する。
`mode: health` は認証とDB接続だけを確認し、通知を送らない。
`mode: check` は新刊取得と送信待ち登録を行い、通知を送らない。

通知を送らないローカル回帰テスト:

```sh
node scripts/test-new-release-worker.mjs
```

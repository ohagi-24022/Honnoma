# iPhone本番ビルド21（2026-10-30）

- ユーザーの全体確認後の依頼に基づき、本番ビルドを開始。
- バージョン1.0.0、ビルド21、iPhone専用。
- EAS Build ID: `d372e8d4-ee1d-440c-a156-29ac99fdd1ca`
- https://expo.dev/accounts/ohagi_mikan/projects/honnoma/builds/d372e8d4-ee1d-440c-a156-29ac99fdd1ca
- Expo SDK58、Node.js22.23.4。最新の互換性チェックに合わせReact Nativeを0.88.0から0.88.1へ更新。
- 全45テスト、型チェック、差分チェックに成功。更新後のExpo Doctorは20/20成功。
- 本棚の読み順の再計算削減、表示件数の調整、表示内容の再取得時の不要な再描画削減を含む。
- 未所持巻の表紙補完、未所持カードの誤登録防止、編集時のみ削除ボタンを表示する変更を含む。
- production環境の接続設定と既存の署名情報を使用。Apple側のプロファイル照合は通信エラーにより省略され、EAS側のローカル検証に成功して継続。
- 作成開始時点ではアップロード・ストア審査送信は行っていない。

## 状態

EASの状態FINISHED、2026-10-30 13:55:52 JSTに完成。

完成IPAを取得し、次を検証した。

- CFBundleIdentifier: com.ohagiworks.honnoma
- CFBundleShortVersionString: 1.0.0 / CFBundleVersion: 21
- UIDeviceFamily: [1]（iPhone専用）
- CFBundleDevelopmentRegion: ja / CFBundleLocalizations: [ja]
- ITSAppUsesNonExemptEncryption: false

## App Store Connectへのアップロード

ユーザーの続行依頼に基づき、EAS SubmitでAppleへアップロード完了。

- Submission ID: `607b243e-9044-4fd6-858d-18b67ebe6a90`
- https://expo.dev/accounts/ohagi_mikan/projects/honnoma/submissions/607b243e-9044-4fd6-858d-18b67ebe6a90
- 既存のApp Store Connect APIキーを使用。
- EAS Submitの完了出力でアップロード成功・Apple側の処理中を確認。
- TestFlight: https://appstoreconnect.apple.com/apps/6819377765/testflight/ios
- Apple側の処理完了・内部テスターでの利用可能状態は、この時点では未確認。
- ストア審査への送信は未実施。

## Apple側の処理完了確認

ユーザーの再ログイン後、App Store Connectの画面で確認。

- ビルド21のアップロード履歴は「終了」。Apple Build ID: `098dee7c-23b3-41c9-bfa8-855c699ba346`。
- 既存の内部グループTeam (Expo)に含まれ、グループのビルド一覧で1.0.0（21）は「テスト中」、期限切れまで90日。既存内部テスターが利用可能。
- テスター画面で最後のインストール済み版は20。端末から21への更新が必要。
- アプリ一覧にApple Developer Programの使用許諾契約更新の通知あり。新規提出・更新にはAccount Holder本人による確認・同意が必要。契約への同意は実施していない。

## 初回審査への提出

ユーザー本人による契約同意の後、2026-10-30 14:25 JSTに1.0.0（21）をApp Reviewへ送信完了。画面で「審査待ち」を確認。
Review Submission ID: `d6ba5e23-aa18-4b84-95f7-deeadff79142`。
配信は日本・無料、手動リリース設定。審査承認後に公開操作が必要。

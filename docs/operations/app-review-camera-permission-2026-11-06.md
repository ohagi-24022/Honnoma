# 2026-11-06：カメラ権限の審査指摘への対応

Appleの2026-11-05審査で、1.0.0（21）のカメラ権限説明画面の「カメラを許可」がGuideline 5.1.1(iv)に抵触すると指摘された。審査端末はiPad Air 11-inch (M3)。

## 実装

`app/(tabs)/scan.tsx` の権限要求前のボタンを「次へ」に変更。用途はISBNバーコードの読み取りと説明し、カメラを使わない手動登録を同じ画面から選択できるようにした。

権限情報の読込中は要求ボタンを出さない。再要求できない場合は「設定を開く」に切り替え、設定アプリから復帰したときに権限状態を読み直す。カメラへのアクセスはOSのダイアログでユーザーが決定する。マイク等の権限は追加していない。

## 確認

- `npm run typecheck` 成功。
- 差分確認で対象の「カメラを許可」を除去したこと、手動登録が権限要求を行わないことを確認。
- 実機での権限ダイアログ・設定復帰の操作確認は未実施。

## 次の提出

修正版の本番ビルドを作成し、実機で次を確認した後、新しいビルドを選択して再提出する。

1. 未選択の状態で「登録」を開くと「次へ」「手動登録する」が表示される。
2. 「次へ」でOS標準の権限ダイアログが開き、許可・拒否のいずれも選択できる。
3. 拒否後も作品名・ISBNでの手動登録を利用できる。
4. 「設定を開く」から権限を変更し、アプリへ戻るとスキャンできる。
5. 許可済みではスキャン・連続登録・シリーズ登録が動作する。

新ビルドの作成・アップロード・再提出はこの作業では未実施。前回の動画には旧権限画面が映っている可能性があるため、新しい権限操作の短い実機動画を添えると変更内容を示しやすい。

## Appleへの返信案（実機確認後、ビルド番号を確定して使用）

Thank you for your feedback. We changed the custom camera permission screen: the button preceding the system permission request now says “次へ” (“Next”), instead of “カメラを許可.” The screen explains that the camera is used for ISBN barcode scanning and provides a manual-registration option without camera access. If camera access is denied and cannot be requested again, users can continue with manual registration or open Settings. The system permission dialog remains the place where users choose whether to grant access. Please review the updated build submitted with this resubmission.

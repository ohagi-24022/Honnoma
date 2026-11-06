# App Reviewメモ案：本の間 1.0.0（21）

2026-11-02、Guideline 2.1の追加情報要求に対応する下書き。動画URL・端末情報・第三者コンテンツの根拠資料を確定した後に英語本文をNotesへ入力する。未記入のまま再提出しない。認証情報は専用フィールドに保持し、このファイルへ保存しない。

## Notesへ入力する英語本文

1. Physical-device demonstration
Main video: [INSERT ACCESSIBLE MAIN VIDEO URL]
Login video: [INSERT ACCESSIBLE LOGIN VIDEO URL]
Device / iOS: iPhone 16e, iOS 26.7.2.
App: Honnoma (本の間), version 1.0.0, build 21, installed through TestFlight.
The main recording starts with launching the app and shows normal use, registration, email verification with automatic sign-in, and deletion of a disposable account. A second recording shows logout and email/password login using iOS password AutoFill. No reviewer sign-in is required to view the videos.

2. Purpose and audience
Honnoma is a personal library and reading-status organizer for individual readers of printed books, including comics and novels. It helps users avoid duplicate purchases, find missing volumes, track reading status and organize books they want to buy. It does not provide book pages, manga chapters, ebook downloads or a reading subscription.

3. Access and main features
The UI is Japanese. No sample file or purchase is required.
- Bookshelf (本棚): use locally without an account, filter the library, open a series and manage owned volumes and reading status. Use the explicit add control to register a missing volume.
- Register (登録): scan a printed book's ISBN, use continuous scanning, or choose series registration and specify a volume range. Manual registration/search is available without a barcode. Grant camera access for scanning; camera video is not uploaded.
- Wishlist (欲しい): search for a title, choose a series and save it with a priority. The button below the results offers an optional AI-assisted retry.
- Rankings (順位): view aggregated counts for administrator-approved catalog entries. Individual users' libraries and identities are not published.
- Settings (設定): log in with the credentials in the App Review sign-in fields. There is one consumer account type. New registration (新規登録へ進む) uses email and password and requires the email confirmation link. Signed-in users can sync data and enable optional series notifications.
- Delete account: 設定 > マイページ > アカウントを削除, then confirm. This deletes the account and associated personal cloud data. Use a disposable account to test deletion.
Personal notes and libraries are private. There are no public user posts, profiles, chat, comments or direct messages. Reading-name corrections are sent privately to the administrator, not posted as a social feed. There is no user-to-user blocking feature. There are no paid app features, In-App Purchases, subscriptions or ads. Purchase links open external book retailers; the app does not sell or unlock digital reading content.

4. External services
- Expo / React Native: application framework; Expo Push Notifications: optional push delivery.
- Supabase: authentication, private cloud data, storage and server functions.
- Render: backend, catalog processing and administrator tools.
- openBD, Rakuten Books API, Google Books API, NDL Search, and publisher/bookstore pages: bibliographic metadata, covers, descriptions and prices.
- OpenAI API: optional search-term assistance and administrator-controlled catalog content checks.
- GitHub Pages: privacy policy. Google Forms: support. Gmail SMTP: administrator email alerts.

5. Regions
Initial App Store distribution is Japan only. The app has no region-specific feature modes. Its interface and book search focus on Japanese-language books. External catalog and retailer availability can vary.

6. Third-party content
Honnoma is not a regulated-industry service. Titles, authors, publishers, ISBNs, cover thumbnails and descriptions come from the providers above. Full book contents are not distributed. We do not claim ownership of publishers' artwork.
Supporting documentation and applicable permissions: [INSERT VERIFIED PROVIDER TERMS / PERMISSION EVIDENCE AND ATTACHMENT REFERENCES].

Privacy policy: https://ohagi-24022.github.io/Honnoma/

## 提出前に埋めるもの（英語本文には含めない）

- 実機動画、実際の機種名・OS。動画で実演していない機能を「実演した」と書かない。
- 第三者コンテンツの提供元条件・必要な出典表示・リンク・保存等と実際の使用方法を照合した資料。API利用、公式サイトへの掲載、管理者による内容確認だけで許諾取得済みとしない。
- 審査アカウントのログイン確認。動画で削除するアカウントと、Appleに渡す審査アカウントは分ける。
- 撮影と資料の準備手順：operations/app-review-2.1-response-2026-11-02.md。
- 11月3日提供の動画確認記録：operations/app-review-video-check-2026-11-03.md。初回起動から削除完了、追加動画で明示的なログイン操作を確認。機種/OSは本人確認済み。最初の動画の個人メール候補はモザイク処理したコピーを作成済み。提出にはoutput/app-review/Honnoma-main-demo-mosaic-v2.mp4を使う。旧mosaic.mp4は57～58秒の処理漏れがあるため提出に使わない。動画共有先と第三者コンテンツ資料は未確定。

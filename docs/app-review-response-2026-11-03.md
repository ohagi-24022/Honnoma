# Appleへの追加資料送信用メモ案

動画添付とともに送る英文。権利資料について未確認の許諾を取得済みと記載しない。

For Guideline 2.1, please see the attached videos and information below.

1. Physical-device demonstration
Videos attached to this App Review response:
- Honnoma-main-demo-mosaic-v2-submit.mp4 (main demonstration)
- Honnoma-login-demo.mp4 (logout and email/password login)
Device / iOS: iPhone 16e, iOS 26.7.2.
App: Honnoma (本の間), version 1.0.0, build 21, installed through TestFlight.
The main recording starts with launching the app and shows normal use, registration, email verification with automatic sign-in, and deletion of a disposable account. A second recording shows logout and email/password login using iOS password AutoFill. The main video has a private keyboard email suggestion pixelated; the app interaction sequence is retained.

2. Purpose and audience
Honnoma helps individual readers organize printed books (comics, novels and other books), track reading status, find missing volumes, avoid duplicate purchases and maintain a wishlist. It does not distribute book pages, manga chapters or ebooks.

3. Access and main features
The UI is Japanese. No sample file or purchase is required.
- Bookshelf (本棚): manage series, owned/missing volumes and reading status. It also works locally without login.
- Register (登録): scan an ISBN, scan continuously, register a series by volume range, or search manually. Camera video is not uploaded.
- Wishlist (欲しい): search for a series and save it with a priority. The button below results offers an optional AI-assisted retry.
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
Provider documentation: openBD (https://openbd.jp/), Rakuten (https://webservice.rakuten.co.jp/guide/rule), Google Books (https://developers.google.com/books/branding). These are provider terms; no separate publisher permission letters are attached.

Privacy policy: https://ohagi-24022.github.io/Honnoma/

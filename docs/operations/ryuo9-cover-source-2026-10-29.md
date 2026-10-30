# りゅうおうのおしごと！9巻の表紙参照を修復

対象: コミック9巻、ISBN 9784757560062。

旧参照:
https://magazine.jp.square-enix.com/top/shoei/9784757560062.jpg?t=20250207124355

調査時点で旧画像URLと出版社の商品ページは HTTP 200 / text/html の
「SQUARE ENIX GLOBAL」を返した。画像ではないため、個人の本棚では
画像読み込み失敗後に「表紙確認中」となり、管理の確認一覧でも表示不能。
分類が未判定であることによる本棚の表示制限ではない。

ISBNが一致する楽天の商品ページで画像URLを確認し、実画像でタイトル・
9巻の巻数を確認した:
https://books.rakuten.co.jp/rb/15775777/

新参照:
https://thumbnail.image.rakuten.co.jp/@0_mall/book/cabinet/0062/9784757560062.jpg?_ex=600x600

JPEG、72,959 bytes、確認時SHA-256:
b2c3ea0ed9072097b5726b9205d733096445cd140f57a5ebba78a64c385820b6

- 正確なISBNの管理補正を更新し、確定書誌・共有キャッシュへ同期。
- 本棚の対象行 15ff3560-da8f-4661-951c-c92368f32a58 の旧URLのみ置換。
- pending_review / unreviewed / adult_only null の確認候補について旧画像
  ハッシュ aa1065fac68e8bafa9785484cc8991e164c8b2943ed8950290f411f81e7d8a64
  を条件に、画像参照を差し替えてハッシュを再準備。
- 既存の保護されたworker action=prepareを対象ISBN1件だけ実行し、
  本番サーバー自身で画像を取得・ハッシュを保存する。
- 一般／成人分類、表紙・紹介文の公開許可、購入記録は変更しない。
- AI・メール送信・ビルド・OTA更新は行わない。

const GIFT_KUBO_ISBN = '9784088927343';
const GIFT_KUBO_COVER_URL = 'https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088927343/1200/9784088927343.jpg';
const GIFT_KUBO_SOURCE_URL = 'https://www.s-manga.net/items/contents.html?isbn=9784088927343';

export type KnownBookMetadataOverride = {
  author?: string;
  description?: string;
  isbn?: string;
  publisher?: string;
  seriesTitle?: string;
  sourceUrl?: string;
  thumbnailUrl?: string;
  title?: string;
};

export const KNOWN_ISBN_COVER_OVERRIDES: Record<string, string> = {
  [GIFT_KUBO_ISBN]: GIFT_KUBO_COVER_URL,
};

const KNOWN_BOOK_METADATA_OVERRIDES: Array<KnownBookMetadataOverride & { keywords: string[] }> = [
  {
    author: '雪森寧々',
    isbn: GIFT_KUBO_ISBN,
    keywords: ['GIFT', '久保さん', '公式ファンブック'],
    publisher: '集英社',
    seriesTitle: '久保さんは僕(モブ)を許さない',
    sourceUrl: GIFT_KUBO_SOURCE_URL,
    thumbnailUrl: GIFT_KUBO_COVER_URL,
    title: 'GIFT 久保さんは僕(モブ)を許さない 完結記念公式ファンブック',
  },
  {
    author: '雪森寧々',
    keywords: ['GIFT', '久保さんは僕を許さない'],
    publisher: '集英社',
    seriesTitle: '久保さんは僕(モブ)を許さない',
    sourceUrl: GIFT_KUBO_SOURCE_URL,
    thumbnailUrl: GIFT_KUBO_COVER_URL,
    title: 'GIFT 久保さんは僕(モブ)を許さない 完結記念公式ファンブック',
  },
];

export function normalizeKnownIsbn(isbn?: string | null) {
  return isbn?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';
}

export function getKnownIsbnCoverOverride(isbn?: string | null) {
  const normalized = normalizeKnownIsbn(isbn);
  return normalized ? KNOWN_ISBN_COVER_OVERRIDES[normalized] : undefined;
}

export function getKnownBookCoverOverride(params: { isbn?: string | null; title?: string | null }) {
  return getKnownBookMetadataOverride(params)?.thumbnailUrl;
}

export function getKnownBookMetadataOverride(params: { isbn?: string | null; title?: string | null }) {
  const normalizedIsbn = normalizeKnownIsbn(params.isbn);
  const isbnMatch = normalizedIsbn
    ? KNOWN_BOOK_METADATA_OVERRIDES.find((entry) => normalizeKnownIsbn(entry.isbn) === normalizedIsbn)
    : undefined;
  if (isbnMatch) return isbnMatch;

  const normalizedTitle = params.title?.normalize('NFKC') ?? '';
  return KNOWN_BOOK_METADATA_OVERRIDES.find((entry) =>
    entry.keywords.every((keyword) => normalizedTitle.includes(keyword)),
  );
}


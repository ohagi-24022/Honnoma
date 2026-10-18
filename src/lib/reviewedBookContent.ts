export const PENDING_BOOK_COVER_URL = 'https://shushukaadmin.onrender.com/assets/cover-pending.png';

export type ReviewedBookContent = {
  isbn13: string;
  cover_url: string | null;
  description: string | null;
};

export function isbnFromKnownCoverUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
    let isbn: string | undefined;
    if (url.hostname === 'thumbnail.image.rakuten.co.jp') {
      isbn = url.pathname.match(/^\/@0_mall\/book\/cabinet\/(?:\d+\/)*((?:978|979)\d{10})(?:[_.]|$)/)?.[1];
    } else if (url.hostname === 'cover.openbd.jp') {
      isbn = url.pathname.match(/^\/((?:978|979)\d{10})\.(?:jpg|png)$/)?.[1];
    } else if (url.hostname === 'dosbg3xlm0x1t.cloudfront.net') {
      isbn = url.pathname.match(/^\/images\/items\/((?:978|979)\d{10})\/\d+\/\1\.(?:jpg|png|webp)$/)?.[1];
    }
    if (!isbn) return undefined;
    const sum = [...isbn].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
    return sum % 10 === 0 ? isbn : undefined;
  } catch { return undefined; }
}

export function contentLookupKey(isbn?: string, coverUrl?: string) {
  const normalized = isbn?.replace(/[^0-9X]/gi, '').toUpperCase();
  if (normalized && /^\d{13}$/.test(normalized)) return `isbn:${normalized}`;
  const recovered = !normalized ? isbnFromKnownCoverUrl(coverUrl) : undefined;
  if (recovered) return `isbn:${recovered}`;
  return coverUrl?.startsWith('https://') ? `url:${coverUrl}` : '';
}

// Only reviewed payloads reach rendering. Never fall back to bibliographic API media.
export function resolveReviewedContent(
  enabled: boolean,
  key: string,
  rows: ReviewedBookContent[],
) {
  if (!enabled || !key) return null;
  return rows.find((row) => key.startsWith('isbn:')
    ? row.isbn13 === key.slice(5)
    : row.cover_url === key.slice(4)) ?? null;
}

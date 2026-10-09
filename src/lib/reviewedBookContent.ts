export type ReviewedBookContent = {
  isbn13: string;
  cover_url: string | null;
  description: string | null;
};

export function contentLookupKey(isbn?: string, coverUrl?: string) {
  const normalized = isbn?.replace(/[^0-9X]/gi, '').toUpperCase();
  if (normalized && /^\d{13}$/.test(normalized)) return `isbn:${normalized}`;
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

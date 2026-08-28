export const KNOWN_ISBN_COVER_OVERRIDES: Record<string, string> = {
  '9784088927343': 'https://www.s-manga.net/items/contents_image/978-4-08-892734-3.jpg',
};

export function normalizeKnownIsbn(isbn?: string | null) {
  return isbn?.replace(/[^0-9X]/gi, '').toUpperCase() ?? '';
}

export function getKnownIsbnCoverOverride(isbn?: string | null) {
  const normalized = normalizeKnownIsbn(isbn);
  return normalized ? KNOWN_ISBN_COVER_OVERRIDES[normalized] : undefined;
}
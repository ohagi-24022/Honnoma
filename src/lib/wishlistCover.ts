import { Book } from '../types';
import { isbnFromKnownCoverUrl } from './reviewedBookContent';
import { normalizeSeriesKey } from './series';

export function normalizeCoverIsbn(value?: string | null) {
  let isbn = value?.normalize('NFKC').replace(/[^0-9X]/gi, '').toUpperCase();
  if (!isbn) return undefined;
  if (/^\d{9}[\dX]$/.test(isbn)) {
    if ([...isbn].reduce((sum, digit, index) => sum + (digit === 'X' ? 10 : Number(digit)) * (10 - index), 0) % 11) return undefined;
    const prefix = `978${isbn.slice(0, 9)}`;
    const sum = [...prefix].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
    isbn = `${prefix}${(10 - sum % 10) % 10}`;
  }
  return /^(978|979)\d{10}$/.test(isbn)
    && [...isbn].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0) % 10 === 0 ? isbn : undefined;
}

export function wishlistCoverIdentity(input: { isbn?: string; coverUrl?: string }) {
  return {
    isbn: input.isbn?.trim() ? normalizeCoverIsbn(input.isbn) : isbnFromKnownCoverUrl(input.coverUrl),
    coverUrl: input.coverUrl?.trim() || undefined,
  };
}

export function resolveWishlistCover(input: { title: string; isbn?: string; coverUrl?: string }, books: Book[]): { isbn?: string; coverUrl?: string } {
  // Preserve the selected publication instead of replacing it with a similarly
  // named work (or another edition) already on the user's shelf.
  if (input.isbn || input.coverUrl) return wishlistCoverIdentity(input);
  const key = normalizeSeriesKey(input.title);
  if (!key) return {};
  const matches = books.filter((book) => normalizeSeriesKey(book.seriesTitle) === key)
    .sort((a, b) => (a.volumeNumber ?? Infinity) - (b.volumeNumber ?? Infinity));
  if (!matches.length) return {};
  const first = matches[0];
  const sameVolume = matches.filter((book) => book.volumeNumber === first.volumeNumber);
  if (new Set(sameVolume.map((book) => book.isbn || book.thumbnailUrl).filter(Boolean)).size > 1) return {};
  return wishlistCoverIdentity({ isbn: first.isbn, coverUrl: first.thumbnailUrl });
}

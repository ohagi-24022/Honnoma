import { Book, BookInput } from '../types';
import { normalizeAuthor } from './bookMetadata';
import { normalizeSeriesKey, parseSeriesTitle } from './series';

function normalizeIsbn(value?: string) {
  return value?.replace(/[^0-9X]/gi, '').toUpperCase();
}

export function normalizeBookInput(bookInput: BookInput): BookInput {
  const parsed = parseSeriesTitle(bookInput.title);

  return {
    ...bookInput,
    seriesTitle: bookInput.seriesTitle || parsed.seriesTitle,
    volumeNumber: bookInput.volumeNumber ?? parsed.volumeNumber,
    author: normalizeAuthor(bookInput.author),
    purchasePrice:
      typeof bookInput.purchasePrice === 'number' && Number.isFinite(bookInput.purchasePrice) && bookInput.purchasePrice >= 0
        ? Math.round(bookInput.purchasePrice)
        : bookInput.purchasePrice === null
          ? null
          : undefined,
    listPrice:
      typeof bookInput.listPrice === 'number' && Number.isFinite(bookInput.listPrice) && bookInput.listPrice >= 0
        ? Math.round(bookInput.listPrice)
        : bookInput.listPrice === null
          ? null
          : undefined,
    priceSource: bookInput.priceSource ?? undefined,
    priceFetchedAt: bookInput.priceFetchedAt ?? undefined,
    thumbnailUrl: bookInput.thumbnailUrl?.replace(/^http:\/\//i, 'https://'),
  };
}

export function findDuplicateBook(currentBooks: Book[], bookInput: BookInput) {
  const incomingIsbn = normalizeIsbn(bookInput.isbn);
  if (incomingIsbn) {
    const isbnMatch = currentBooks.find((book) => normalizeIsbn(book.isbn) === incomingIsbn);
    if (isbnMatch) return isbnMatch;
  }

  const normalizedInput = normalizeBookInput(bookInput);
  if (!normalizedInput.volumeNumber || !normalizedInput.seriesTitle.trim()) return undefined;
  const seriesKey = normalizeSeriesKey(normalizedInput.seriesTitle);

  return currentBooks.find(
    (book) =>
      book.volumeNumber === normalizedInput.volumeNumber &&
      normalizeSeriesKey(book.seriesTitle) === seriesKey,
  );
}

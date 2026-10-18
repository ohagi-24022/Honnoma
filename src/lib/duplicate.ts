import { resolveBookFormat } from './bookFormat';
import { Book, BookInput } from '../types';
import { normalizeAuthor } from './bookMetadata';
import { normalizeSeriesKey, parseSeriesTitle } from './series';
import { normalizeVolumeKind } from './volumeKind';
import { resolveUserSeriesName } from './userSeriesNames';

function normalizeIsbn(value?: string) {
  return value?.replace(/[^0-9X]/gi, '').toUpperCase();
}

export function normalizeBookInput(bookInput: BookInput): BookInput {
  const parsed = parseSeriesTitle(bookInput.title);

  return {
    ...bookInput,
    seriesTitle: bookInput.seriesTitle || parsed.seriesTitle,
    volumeNumber: bookInput.volumeNumber ?? parsed.volumeNumber,
    volumeKind: normalizeVolumeKind(bookInput.volumeKind, bookInput.title),
    bookFormat: resolveBookFormat(bookInput),
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

  const normalizedInput = resolveUserSeriesName(currentBooks, normalizeBookInput(bookInput));
  if (!normalizedInput.seriesTitle.trim()) return undefined;
  const seriesKey = normalizeSeriesKey(normalizedInput.seriesTitle);
  const kind = normalizeVolumeKind(normalizedInput.volumeKind, normalizedInput.title);
  const sameFormat = (book: Book) => resolveBookFormat(book) === 'unknown' || resolveBookFormat(normalizedInput) === 'unknown' || resolveBookFormat(book) === resolveBookFormat(normalizedInput);
  const titleKey = (value: string) => value.normalize('NFKC').replace(/\s/g, '').toLocaleLowerCase();
  if (kind === 'extra') {
    return currentBooks.find(book => sameFormat(book) && normalizeVolumeKind(book.volumeKind, book.title) === 'extra'
      && normalizeSeriesKey(book.seriesTitle) === seriesKey && titleKey(book.title) === titleKey(normalizedInput.title));
  }
  if (!normalizedInput.volumeNumber) return undefined;
  return currentBooks.find(book => sameFormat(book) && normalizeVolumeKind(book.volumeKind, book.title) === 'main'
    && book.volumeNumber === normalizedInput.volumeNumber && normalizeSeriesKey(book.seriesTitle) === seriesKey);
}

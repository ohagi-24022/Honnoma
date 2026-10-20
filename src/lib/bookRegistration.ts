import { Book, BookInput, MissingBook } from '../types';
import { normalizeSeriesKey, parseSeriesTitle } from './series';
import { normalizeVolumeKind } from './volumeKind';

export class DuplicateBookError extends Error {
  readonly code = 'BOOK_ALREADY_EXISTS';
  constructor(message: string, readonly reason: 'isbn' | 'volume') {
    super(message);
    this.name = 'DuplicateBookError';
  }
}

export function isDuplicateBookError(error: unknown): error is DuplicateBookError {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'BOOK_ALREADY_EXISTS';
}

export function ownsMissingVolume(books: Book[], item: MissingBook) {
  return books.some((book) => normalizeSeriesKey(book.seriesTitle) === normalizeSeriesKey(item.seriesTitle)
    && book.volumeNumber === item.volumeNumber && normalizeVolumeKind(book.volumeKind, book.title) === 'main');
}

export function missingVolumeInput(item: MissingBook, metadata: BookInput | null): BookInput {
  const parsed = metadata ? parseSeriesTitle(metadata.title) : null;
  const sameIdentity = !!item.isbn && metadata?.isbn === item.isbn;
  const matches = metadata && metadata.volumeNumber === item.volumeNumber
    && (sameIdentity || parsed?.volumeNumber === item.volumeNumber)
    && (!item.isbn || metadata.isbn === item.isbn)
    && ((item.isbn && metadata.isbn === item.isbn) || (normalizeSeriesKey(metadata.seriesTitle) === normalizeSeriesKey(item.seriesTitle)
      && normalizeSeriesKey(parsed?.seriesTitle ?? '') === normalizeSeriesKey(item.seriesTitle)))
    && normalizeVolumeKind(metadata.volumeKind, metadata.title) === 'main'
    && !/特装版|限定版|完全版|文庫版|新装版|愛蔵版/.test(metadata.title);
  return {
    ...(matches ? metadata : {}),
    title: matches ? metadata.title : item.title,
    seriesTitle: item.seriesTitle,
    volumeNumber: item.volumeNumber,
    volumeKind: 'main',
    status: 'unread',
  };
}

/** Build the user's requested range even before publication information is cached. */
export function missingRegistrationTargets(seriesTitle: string, books: Book[], throughVolume: number, userId: string, publishedVolume?: number): MissingBook[] {
  if (!Number.isInteger(throughVolume) || throughVolume < 1 || throughVolume > 500) return [];
  const limit = publishedVolume && Number.isInteger(publishedVolume) && publishedVolume > 0
    ? Math.min(throughVolume, publishedVolume) : throughVolume;
  const createdAt = new Date().toISOString();
  const result: MissingBook[] = [];
  for (let volume = 1; volume <= limit; volume++) {
    const item: MissingBook = { id: `missing-bulk-${seriesTitle}-${volume}`, userId, title: `${seriesTitle} ${volume}`,
      seriesTitle, volumeNumber: volume, status: 'missing', createdAt, isMissing: true };
    if (!ownsMissingVolume(books, item)) result.push(item);
  }
  return result;
}

export async function addMissingVolume(
  item: MissingBook,
  books: Book[],
  lookup: (title: string, isbn?: string) => Promise<BookInput | null>,
  add: (input: BookInput) => Promise<Book>,
): Promise<Book | null> {
  if (ownsMissingVolume(books, item)) return null;
  const input = missingVolumeInput(item, await lookup(`${item.seriesTitle} ${item.volumeNumber}巻`, item.isbn));
  const normalizeIsbn = (value?: string) => value?.replace(/[^0-9X]/gi, '').toUpperCase();
  const conflict = input.isbn && books.find((book) => normalizeIsbn(book.isbn) === normalizeIsbn(input.isbn));
  if (conflict) {
    throw new DuplicateBookError(`取得したISBNは「${conflict.title}」で登録済みです。この巻のISBNを確認してください。`, 'isbn');
  }
  try {
    return await add(input);
  } catch (error) {
    // A volume added on another device can race with the lookup. Keep the ISBN:
    // removing it and retrying would manufacture a second copy without identity.
    if (isDuplicateBookError(error) && error.reason === 'volume') return null;
    throw error;
  }
}

/** Fill legacy bulk placeholders only after title, volume and ISBN agree. */
export function canFillMissingBookIdentity(book: Book, metadata: BookInput | null, books: Book[]) {
  const isbn = metadata?.isbn?.replace(/[^0-9]/g, '');
  if (book.isbn || !metadata || !isbn || !/^(978|979)[0-9]{10}$/.test(isbn)
    || [...isbn].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0) % 10 !== 0) return false;
  if (metadata.volumeNumber !== book.volumeNumber
    || normalizeSeriesKey(parseSeriesTitle(metadata.title).seriesTitle) !== normalizeSeriesKey(parseSeriesTitle(book.title).seriesTitle)
    || /特装版|限定版|完全版|文庫版|新装版|愛蔵版/.test(metadata.title)) return false;
  const publisher = (s?: string) => s?.normalize('NFKC').replace(/\s/g, '');
  if (book.publisher && metadata.publisher && publisher(book.publisher) !== publisher(metadata.publisher)) return false;
  return !books.some(other => other.id !== book.id && other.isbn === isbn);
}

import { Book, MissingBook, ShelfItem } from '../types';
import { normalizeAuthors } from './bookMetadata';
import { getMissingVolumes, normalizeSeriesKey } from './series';

export type SeriesGroup = {
  id: string;
  title: string;
  representative: Book;
  ownedCount: number;
  unreadCount: number;
  readingCount: number;
  readCount: number;
  extraCount: number;
  authors: string[];
  publishers: string[];
  latestVolume?: number;
  latestAddedAt: string;
};

function mainVolumeBooks(books: Book[]) {
  return books.filter((book) => book.volumeKind !== 'extra');
}

function compareShelfItems(left: ShelfItem, right: ShelfItem) {
  const leftExtra = !left.isMissing && left.volumeKind === 'extra';
  const rightExtra = !right.isMissing && right.volumeKind === 'extra';
  if (leftExtra !== rightExtra) return leftExtra ? 1 : -1;
  return (left.volumeNumber ?? 0) - (right.volumeNumber ?? 0) || left.createdAt.localeCompare(right.createdAt);
}

export function buildSeriesGroups(books: Book[]): SeriesGroup[] {
  const bySeries = new Map<string, Book[]>();
  books.forEach((book) => {
    const seriesKey = normalizeSeriesKey(book.seriesTitle);
    const group = bySeries.get(seriesKey) ?? [];
    group.push(book);
    bySeries.set(seriesKey, group);
  });

  return [...bySeries.entries()]
    .map(([seriesKey, groupedBooks]) => {
      const mainBooks = mainVolumeBooks(groupedBooks);
      const countTargetBooks = mainBooks.length > 0 ? mainBooks : groupedBooks;
      const latestSortedBooks = [...countTargetBooks].sort(
        (left, right) => (right.volumeNumber ?? 0) - (left.volumeNumber ?? 0),
      );
      const earliestSortedBooks = [...countTargetBooks].sort(
        (left, right) =>
          (left.volumeNumber ?? Number.MAX_SAFE_INTEGER) -
            (right.volumeNumber ?? Number.MAX_SAFE_INTEGER) ||
          left.createdAt.localeCompare(right.createdAt),
      );
      const representative = earliestSortedBooks[0] ?? latestSortedBooks[0];
      const title = representative.seriesTitle;

      return {
        id: encodeURIComponent(seriesKey),
        title,
        representative,
        ownedCount: mainBooks.length,
        extraCount: groupedBooks.length - mainBooks.length,
        unreadCount: groupedBooks.filter((book) => book.status === 'unread').length,
        readingCount: groupedBooks.filter((book) => book.status === 'reading').length,
        readCount: groupedBooks.filter((book) => book.status === 'read').length,
        authors: normalizeAuthors(groupedBooks.map((book) => book.author)),
        publishers: [
          ...new Set(groupedBooks.map((book) => book.publisher).filter((value): value is string => !!value)),
        ],
        latestVolume: latestSortedBooks[0]?.volumeNumber,
        latestAddedAt: groupedBooks.reduce(
          (latest, book) => (book.createdAt > latest ? book.createdAt : latest),
          groupedBooks[0]?.createdAt ?? '',
        ),
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}

export function buildSeriesItems(
  books: Book[],
  seriesTitle: string,
  missingUserId: string,
): ShelfItem[] {
  const targetSeriesKey = normalizeSeriesKey(seriesTitle);
  const owned = books
    .filter((book) => normalizeSeriesKey(book.seriesTitle) === targetSeriesKey)
    .sort(compareShelfItems);
  const mainOwned = mainVolumeBooks(owned);
  const missingVolumes = getMissingVolumes(
    mainOwned.map((book) => book.volumeNumber).filter((volume): volume is number => !!volume),
  );
  const createdAt = new Date().toISOString();
  const missing: MissingBook[] = missingVolumes.map((volumeNumber) => ({
    id: `missing-${seriesTitle}-${volumeNumber}`,
    userId: missingUserId,
    title: `${seriesTitle} ${volumeNumber}`,
    seriesTitle,
    volumeNumber,
    status: 'missing',
    createdAt,
    isMissing: true,
  }));

  return [...owned, ...missing].sort(compareShelfItems);
}

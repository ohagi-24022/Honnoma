import { Book, BookInput } from '../types';
import { normalizeSeriesKey, parseSeriesTitle } from './series';
import { normalizeVolumeKind } from './volumeKind';

/** Resolve clear companion titles against this user's main series, never a global fuzzy match. */
export function resolveRelatedVolume(books: Book[], input: BookInput): BookInput {
  if (normalizeVolumeKind(input.volumeKind, input.title) !== 'extra'
    || normalizeVolumeKind(undefined, input.title) !== 'extra') return input;
  const titleKey = normalizeSeriesKey(input.title);
  const publisher = input.publisher?.normalize('NFKC').replace(/\s/g, '');
  const matches = books.filter(book => normalizeVolumeKind(book.volumeKind, book.title) === 'main')
    .flatMap(book => {
      if (publisher && book.publisher && publisher !== book.publisher.normalize('NFKC').replace(/\s/g, '')) return [];
      const names = [book.seriesTitle, ...(book.seriesAliases ?? []), parseSeriesTitle(book.title).seriesTitle];
      return names.map(normalizeSeriesKey).filter(key => key.length >= 3 && titleKey.includes(key))
        .map(key => ({ book, length: key.length }));
    });
  const destinations = new Set(matches.map(match => match.book.seriesTitle));
  if (destinations.size !== 1) return input;
  const seriesTitle = [...destinations][0];
  return { ...input, seriesTitle, volumeKind: 'extra',
    seriesAliases: [...new Set([...(input.seriesAliases ?? []), ...(input.seriesTitle !== seriesTitle ? [input.seriesTitle] : [])])] }; 
}

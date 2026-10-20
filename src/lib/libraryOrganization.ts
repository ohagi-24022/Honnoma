import type { Book, BookInput } from '../types';
import { inferBookFormat } from './bookFormat';
import { inferVolumeKindFromText } from './volumeKind';
import { knownCompanionByIsbn } from './knownCompanionBooks';
import { resolveRelatedVolume } from './relatedVolumes';

/** A deliberate library cleanup; never guess a parent from author alone. */
export function planLibraryOrganization(books: Book[], comicForUnknown = false) {
  return books.flatMap(book => {
    const patch: Partial<BookInput> = {};
    if (!book.bookFormat || book.bookFormat === 'unknown') {
      const inferred = inferBookFormat(book);
      if (inferred !== 'unknown' || comicForUnknown) patch.bookFormat = inferred === 'unknown' ? 'comic' : inferred;
    }
    if (inferVolumeKindFromText(book.title) === 'extra') {
      const resolved = resolveRelatedVolume(books, { ...book, volumeKind: 'extra' });
      if (book.volumeKind !== 'extra') patch.volumeKind = 'extra';
      if (resolved.seriesTitle !== book.seriesTitle) {
        patch.seriesTitle = resolved.seriesTitle;
        patch.seriesAliases = resolved.seriesAliases;
      }
    }
    return Object.keys(patch).length ? [{ id: book.id, patch }] : [];
  });
}

/** Automatic maintenance preserves explicit kinds and custom grouping. */
export function planAutomaticLibraryOrganization(books: Book[]) {
  return planLibraryOrganization(books).map(item => {
    const book = books.find(book => book.id === item.id)!;
    const patch = { ...item.patch };
    const knownExtra = !!knownCompanionByIsbn(book.isbn) || book.isbn === '9784832273146';
    if (book.volumeKind && !knownExtra) {
      delete patch.volumeKind;
      if (book.volumeKind === 'main') { delete patch.seriesTitle; delete patch.seriesAliases; }
    }
    if (book.seriesAliases?.length) {
      delete patch.seriesTitle;
      delete patch.seriesAliases;
    }
    return { id: item.id, patch };
  }).filter(item => Object.keys(item.patch).length > 0);
}

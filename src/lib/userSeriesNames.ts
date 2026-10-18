import { resolveBookFormat } from './bookFormat';
import { Book, BookInput } from '../types';
import { normalizeAuthor } from './bookMetadata';
import { parseSeriesTitle } from './series';
import { normalizeVolumeKind } from './volumeKind';
import { resolveRelatedVolume } from './relatedVolumes';

// Keep edition labels and punctuation: user names must not become global catalog aliases.
function nameKey(value?: string | null) {
  return value?.normalize('NFKC').toLocaleLowerCase().replace(/\s/g, '') ?? '';
}

export function renamedBook<T extends BookInput>(book: T, seriesTitle: string): T {
  return {
    ...book,
    seriesTitle,
    seriesAliases: [...new Set([...(book.seriesAliases ?? []), book.seriesTitle])].filter(Boolean),
  };
}

export function hasUserSeriesName(book: BookInput) {
  return (book.seriesAliases ?? []).some((alias) => nameKey(alias) !== nameKey(book.seriesTitle));
}

export function resolveUserSeriesName(books: Book[], input: BookInput): BookInput {
  input = resolveRelatedVolume(books, input);
  const sourceKey = nameKey(input.seriesTitle);
  if (!sourceKey) return input;
  const author = nameKey(normalizeAuthor(input.author));
  const publisher = nameKey(input.publisher);
  const candidates = books.filter((book) => {
    const format = resolveBookFormat(input), bookFormat = resolveBookFormat(book);
    if (format !== 'unknown' && bookFormat !== 'unknown' && format !== bookFormat) return false;
    const bookAuthor = nameKey(normalizeAuthor(book.author));
    if (author && bookAuthor && author !== bookAuthor) return false;
    if (publisher && book.publisher && publisher !== nameKey(book.publisher)) return false;
    if (normalizeVolumeKind(input.volumeKind, input.title) !== normalizeVolumeKind(book.volumeKind, book.title)) return false;
    const edition = (title: string) => (title.match(/完全版|愛蔵版|新装版|文庫版|特装版|限定版|合本版|DVD付き|DVD付/g) ?? []).sort().join('|');
    if (edition(input.title) !== edition(book.title)) return false;
    if (nameKey(book.seriesTitle) === sourceKey) return true;
    if (book.seriesAliases?.some((alias) => nameKey(alias) === sourceKey)) return true;
    // Older versions did not record rename history. Recover only an exact source title
    // with a known matching author, and never infer across edition labels.
    if (!author || author !== bookAuthor) return false;
    if (/完全版|愛蔵版|新装版|文庫版|特装版|限定版|合本版/.test(`${input.title} ${book.title}`)) return false;
    return nameKey(parseSeriesTitle(book.title).seriesTitle) === sourceKey;
  });
  // A previously created, unedited group under the provider name must not take
  // precedence over the user's one unambiguous renamed group.
  const renamedCandidates = candidates.filter((book) =>
    nameKey(book.seriesTitle) !== sourceKey || hasUserSeriesName(book),
  );
  const matches = renamedCandidates.length ? renamedCandidates : candidates;
  const destinations = new Set(matches.map((book) => book.seriesTitle));
  // Conflicting aliases are left untouched; never pick whichever volume came first.
  if (destinations.size !== 1) return input;
  const seriesTitle = matches[0].seriesTitle;
  const seriesAliases = [...new Set([
    ...(input.seriesAliases ?? []),
    ...matches.flatMap((book) => book.seriesAliases ?? []),
    ...(seriesTitle !== input.seriesTitle ? [input.seriesTitle] : []),
  ])];
  return { ...input, seriesTitle, seriesAliases };
}

import type { BookInput } from '../types';

// Original JUMP j BOOKS and re-edited paperback editions, verified against
// https://j-books.shueisha.co.jp/books/nisekoiurabana_01.html (also _02, _03)
// https://www.shueisha.co.jp/books/items/contents.html?isbn=9784086198127 (also 9784086198134)
const editions = [
  { isbn: '9784087032925', volume: 1, paperback: false, date: '2013-06-04' },
  { isbn: '9784087033076', volume: 2, paperback: false, date: '2013-12-28' },
  { isbn: '9784087033557', volume: 3, paperback: false, date: '2015-04-03' },
  { isbn: '9784086198127', volume: 1, paperback: true, date: '2024-01-18' },
  { isbn: '9784086198134', volume: 2, paperback: true, date: '2024-01-18' },
];

export function isNisekoiUrabanaTitle(value?: string | null) {
  const key = value?.normalize('NFKC').replace(/[\s!！:：~〜～ー\-()（）]/g, '').toLowerCase() ?? '';
  return /^ニセコイ(?:第?[0-9]+巻?)?ウラバナ(?:第?[0-9]+巻?)?(?:文庫版?|集英社文庫コミック版|jumpjbooks|新装版)*$/.test(key);
}
function toBook(edition: typeof editions[number]): BookInput {
  return { isbn: edition.isbn, title: `ニセコイ ウラバナ ${edition.volume}${edition.paperback ? ' 文庫版' : ''}`,
    seriesTitle: 'ニセコイ', volumeNumber: edition.volume, volumeKind: 'extra', bookFormat: 'novel',
    author: '古味直志, 田中創', publisher: '集英社', publishedDate: edition.date, status: 'unread',
    thumbnailUrl: `https://dosbg3xlm0x1t.cloudfront.net/images/items/${edition.isbn}/500/${edition.isbn}.jpg` };
}
export function knownCompanionByIsbn(value?: string | null): BookInput | undefined {
  const isbn = value?.replace(/[^0-9X]/gi, '').toUpperCase();
  const edition = editions.find(item => item.isbn === isbn);
  return edition ? toBook(edition) : undefined;
}
export function searchKnownCompanionBooks(query: string): BookInput[] {
  const normalized = query.normalize('NFKC').trim();
  if (normalized === 'ニセコイ') return editions.map(toBook);
  if (!isNisekoiUrabanaTitle(normalized)) return [];
  const match = normalized.match(/ウラバナ\s*(?:第\s*)?[（(]?\s*([0-9]+)|ニセコイ\s*[（(]?\s*(?:第\s*)?([0-9]+)/);
  const volume = match ? Number(match[1] ?? match[2]) : undefined;
  const paperback = /文庫|新装版/.test(normalized);
  const original = /JUMP\s*j\s*BOOKS/i.test(normalized);
  return editions.filter(item => (!volume || item.volume === volume)
    && (!paperback || item.paperback) && (!original || !item.paperback)).map(toBook);
}

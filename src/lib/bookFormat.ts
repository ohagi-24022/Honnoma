import { isNisekoiUrabanaTitle, knownCompanionByIsbn } from './knownCompanionBooks';
import { verifiedBakemonogatariBooks } from './verifiedBakemonogatari';
import type { BookFormat } from '../types';

export type BookFormatFilter = 'all' | BookFormat;
export const bookFormatOptions = [
  { value: 'comic', label: 'コミック' }, { value: 'novel', label: '小説' }, { value: 'unknown', label: '未分類' },
] as const;
type FormatHints = { title?: string; seriesTitle?: string; isbn?: string; labels?: string[]; size?: string | number };

/** Use explicit bibliographic labels, never assume that a paperback is a novel. */
export function inferBookFormat(input: FormatHints): BookFormat {
  if (knownCompanionByIsbn(input.isbn) || isNisekoiUrabanaTitle(input.title) || isNisekoiUrabanaTitle(input.seriesTitle)) return 'novel';
  if (input.isbn && verifiedBakemonogatariBooks.some(book => book.isbn === input.isbn)) return 'comic';
  if (input.isbn === '9784832273146') return 'comic'; // 芳文社公式「がっこうぐらし！～おたより～」
  const labels = (input.labels ?? []).join(' ').normalize('NFKC');
  const title = [input.title, input.seriesTitle].filter(Boolean).join(' ').normalize('NFKC');
  const evidence = `${labels} ${title} ${input.size ?? ''}`;
  if (String(input.size) === '9' || /コミック|コミックス|漫画|マンガ|まんが|comics|graphic novels|manga/i.test(evidence)) return 'comic';
  if (/小説(?!家)|ライトノベル|ノベライズ|\bnovels?\b|\blight novels?\b|電撃文庫|GA文庫|MF文庫J|富士見ファンタジア文庫|角川スニーカー文庫|ガガガ文庫|講談社ラノベ文庫/i.test(evidence)) return 'novel';
  return 'unknown';
}
export function resolveBookFormat(input: FormatHints & { bookFormat?: BookFormat | null }): BookFormat {
  if (input.bookFormat === 'comic' || input.bookFormat === 'novel' || input.bookFormat === 'unknown') return input.bookFormat;
  return inferBookFormat(input);
}
export function matchesBookFormat(input: FormatHints & { bookFormat?: BookFormat | null }, filter: BookFormatFilter) {
  return filter === 'all' || resolveBookFormat(input) === filter;
}

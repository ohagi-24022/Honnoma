import { BookInput, BookVolumeKind } from '../types';

const EXTRA_VOLUME_KEYWORDS = [
  '\u30a2\u30f3\u30bd\u30ed\u30b8\u30fc',
  '\u30a2\u30f3\u30bd\u30ed\u30b8\uff70',
  '\u756a\u5916\u7de8',
  '\u5916\u4f1d',
  '\u30b9\u30d4\u30f3\u30aa\u30d5',
  '\u516c\u5f0f\u30d5\u30a1\u30f3\u30d6\u30c3\u30af',
  '\u30d5\u30a1\u30f3\u30d6\u30c3\u30af',
  '\u30ad\u30e3\u30e9\u30af\u30bf\u30fc\u30d6\u30c3\u30af',
  '\u30ad\u30e3\u30e9\u30d6\u30c3\u30af',
  '\u30ac\u30a4\u30c9\u30d6\u30c3\u30af',
  '\u516c\u5f0f\u30ac\u30a4\u30c9',
  '\u77ed\u7de8\u96c6',
  '\u5c0f\u8aac\u7248',
  '\u30ce\u30d9\u30e9\u30a4\u30ba',
  '\u8a2d\u5b9a\u8cc7\u6599\u96c6',
  '\u753b\u96c6',
  '\u30a4\u30e9\u30b9\u30c8\u96c6',
  '\u8aad\u5207\u7248',
  '\u7dcf\u96c6\u7de8',
  '\u7279\u5225\u7de8',
];

const EXTRA_VOLUME_PATTERNS = [/after\s*story/i, /side\s*story/i, /anthology/i, /fan\s*book/i, /guide\s*book/i];

export function inferVolumeKindFromText(value: string | undefined | null): BookVolumeKind {
  const text = value?.normalize('NFKC').trim() ?? '';
  if (!text) return 'main';
  return EXTRA_VOLUME_KEYWORDS.some((keyword) => text.includes(keyword)) ||
    EXTRA_VOLUME_PATTERNS.some((pattern) => pattern.test(text))
    ? 'extra'
    : 'main';
}

export function normalizeVolumeKind(value: unknown, fallbackText?: string | null): BookVolumeKind {
  if (value === 'main' || value === 'extra') return value;
  return inferVolumeKindFromText(fallbackText);
}

export function withInferredVolumeKind<T extends Partial<BookInput>>(book: T): T & { volumeKind: BookVolumeKind } {
  return {
    ...book,
    volumeKind: normalizeVolumeKind(book.volumeKind, [book.title, book.seriesTitle].filter(Boolean).join(' ')),
  };
}

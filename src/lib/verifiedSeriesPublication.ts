import type { SeriesPublicationInfo } from './bookApis';
import { normalizeSeriesKey } from './series';

/** Publisher-verified corrections, applied to stale automatic caches as well. */
export function verifiedSeriesPublication(title: string): SeriesPublicationInfo | undefined {
  // 講談社・瀬尾公治『ヒットマン』既刊一覧と13巻の公式商品ページ。
  // https://www.kodansha.co.jp/titles/1000032796
  // https://www.kodansha.co.jp/comic/products/0000350175
  if (normalizeSeriesKey(title) !== normalizeSeriesKey('ヒットマン')) return undefined;
  return { latestVolume: 13, isCompleted: true, source: 'Publisher', checkedAt: '2026-10-17T00:00:00.000Z' };
}

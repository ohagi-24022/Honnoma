import { WishlistItem } from '../store/WishlistContext';
import { normalizeSeriesKey } from './series';

export type GlobalRankingRow = {
  average_score: number | string | null;
  cover_url: string | null;
  favorite_count: number;
  owned_volume_count: number;
  owner_count: number;
  popularity_score: number | string | null;
  title: string;
  top_score: number | null;
  want_count: number;
};

export type RankingCategory = 'overall' | 'wanted' | 'owned' | 'favorite' | 'personal';

export type RankingDisplayRow = {
  averageScore?: number;
  coverUrl?: string;
  favoriteCount?: number;
  isbn?: string;
  ownedVolumeCount?: number;
  ownerCount?: number;
  popularityScore?: number;
  preferIsbnCover?: boolean;
  score?: number;
  title: string;
  topScore?: number;
  wantCount?: number;
};

export const rankingCategoryLabels: Record<RankingCategory, { description: string; title: string }> = {
  overall: {
    title: '総合ランキング',
    description: '欲しい登録、所持ユーザー数、登録冊数をまとめたランキングです。',
  },
  wanted: {
    title: '欲しいランキング',
    description: '利用者の欲しいリストに多く入っている漫画です。',
  },
  owned: {
    title: '所持ランキング',
    description: '本棚に登録している利用者が多い漫画です。',
  },
  favorite: {
    title: 'お気に入りランキング',
    description: '利用者全体でお気に入りに入れられているシリーズです。',
  },
  personal: {
    title: '自分の欲しい順',
    description: 'あなたの欲しいリストをスコア順に並べたランキングです。',
  },
};

export const rankingCategories = Object.keys(rankingCategoryLabels) as RankingCategory[];

function toNumber(value: number | string | null | undefined) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function toOptionalNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return undefined;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : undefined;
}

function toDisplayRow(row: GlobalRankingRow): RankingDisplayRow {
  return {
    averageScore: toOptionalNumber(row.average_score),
    coverUrl: row.cover_url ?? undefined,
    favoriteCount: Number(row.favorite_count ?? 0),
    ownedVolumeCount: Number(row.owned_volume_count ?? 0),
    ownerCount: Number(row.owner_count ?? 0),
    popularityScore: toOptionalNumber(row.popularity_score),
    title: row.title,
    topScore: toOptionalNumber(row.top_score),
    wantCount: Number(row.want_count ?? 0),
  };
}

function normalizeRankingSeriesKey(title: string) {
  return normalizeSeriesKey(title).replace(/[!！?？。．.・･]/g, '');
}

function preferDisplayTitle(current: RankingDisplayRow, next: RankingDisplayRow) {
  const currentScore =
    Number(current.favoriteCount ?? 0) +
    Number(current.ownerCount ?? 0) +
    Number(current.wantCount ?? 0) +
    (current.coverUrl ? 1 : 0);
  const nextScore =
    Number(next.favoriteCount ?? 0) +
    Number(next.ownerCount ?? 0) +
    Number(next.wantCount ?? 0) +
    (next.coverUrl ? 1 : 0);

  if (nextScore !== currentScore) return nextScore > currentScore ? next.title : current.title;
  return next.title.length < current.title.length ? next.title : current.title;
}

function mergeDuplicateSeriesRows(rows: RankingDisplayRow[]) {
  const merged = new Map<string, RankingDisplayRow>();

  for (const row of rows) {
    const key = normalizeRankingSeriesKey(row.title);
    if (!key) continue;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, row);
      continue;
    }

    merged.set(key, {
      ...current,
      averageScore: Math.max(Number(current.averageScore ?? 0), Number(row.averageScore ?? 0)) || undefined,
      coverUrl: current.coverUrl ?? row.coverUrl,
      favoriteCount: Number(current.favoriteCount ?? 0) + Number(row.favoriteCount ?? 0),
      ownedVolumeCount: Math.max(Number(current.ownedVolumeCount ?? 0), Number(row.ownedVolumeCount ?? 0)),
      ownerCount: Number(current.ownerCount ?? 0) + Number(row.ownerCount ?? 0),
      popularityScore: Number(current.popularityScore ?? 0) + Number(row.popularityScore ?? 0),
      title: preferDisplayTitle(current, row),
      topScore: Math.max(Number(current.topScore ?? 0), Number(row.topScore ?? 0)) || undefined,
      wantCount: Number(current.wantCount ?? 0) + Number(row.wantCount ?? 0),
    });
  }

  return [...merged.values()];
}

export function buildRankingRows(
  category: RankingCategory,
  globalRows: GlobalRankingRow[],
  wishlistItems: WishlistItem[],
) {
  if (category === 'favorite') {
    return mergeDuplicateSeriesRows(globalRows.map(toDisplayRow))
      .sort(
        (left, right) =>
          Number(right.favoriteCount ?? 0) - Number(left.favoriteCount ?? 0) ||
          Number(right.ownerCount ?? 0) - Number(left.ownerCount ?? 0) ||
          Number(right.wantCount ?? 0) - Number(left.wantCount ?? 0) ||
          Number(right.popularityScore ?? 0) - Number(left.popularityScore ?? 0) ||
          left.title.localeCompare(right.title),
      );
  }

  if (category === 'personal') {
    return wishlistItems
      .map((item) => ({
        coverUrl: item.coverUrl,
        score: item.score,
        title: item.title,
      }))
      .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0) || left.title.localeCompare(right.title));
  }

  const rows = mergeDuplicateSeriesRows(globalRows.map(toDisplayRow));

  if (category === 'wanted') {
    return rows
      .filter((row) => Number(row.wantCount ?? 0) > 0)
      .sort(
        (left, right) =>
          Number(right.wantCount ?? 0) - Number(left.wantCount ?? 0) ||
          Number(right.averageScore ?? 0) - Number(left.averageScore ?? 0) ||
          left.title.localeCompare(right.title),
      );
  }

  if (category === 'owned') {
    return rows
      .filter((row) => Number(row.ownerCount ?? 0) > 0)
      .sort(
        (left, right) =>
          Number(right.ownerCount ?? 0) - Number(left.ownerCount ?? 0) ||
          Number(right.favoriteCount ?? 0) - Number(left.favoriteCount ?? 0) ||
          Number(right.wantCount ?? 0) - Number(left.wantCount ?? 0) ||
          left.title.localeCompare(right.title),
      );
  }

  return rows.sort(
    (left, right) =>
      Number(right.popularityScore ?? 0) - Number(left.popularityScore ?? 0) ||
      Number(right.ownerCount ?? 0) - Number(left.ownerCount ?? 0) ||
      Number(right.favoriteCount ?? 0) - Number(left.favoriteCount ?? 0) ||
      Number(right.wantCount ?? 0) - Number(left.wantCount ?? 0) ||
      left.title.localeCompare(right.title),
  );
}


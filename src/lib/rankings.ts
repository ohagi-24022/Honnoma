import { WishlistItem } from '../store/WishlistContext';

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
    wantCount: Number(row.want_count ?? 0),
  };
}

export function buildRankingRows(
  category: RankingCategory,
  globalRows: GlobalRankingRow[],
  wishlistItems: WishlistItem[],
) {
  if (category === 'favorite') {
    return globalRows
      .map(toDisplayRow)
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

  const rows = globalRows.map(toDisplayRow);

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

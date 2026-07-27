import Ionicons from '@expo/vector-icons/Ionicons';
import { useScrollToTop } from '@react-navigation/native';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RankingCard } from '../../src/components/RankingCard';
import { buildPurchaseUrl } from '../../src/lib/bookApis';
import {
  buildRankingRows,
  GlobalRankingRow,
  RankingCategory,
  RankingDisplayRow,
  rankingCategories,
  rankingCategoryLabels,
} from '../../src/lib/rankings';
import { buildSeriesGroups } from '../../src/lib/seriesSelectors';
import { normalizeSeriesKey } from '../../src/lib/series';
import { supabase } from '../../src/lib/supabase';
import { isMissingSupabaseFunctionError } from '../../src/lib/supabaseErrors';
import { useLibrary } from '../../src/store/LibraryContext';
import { useAppTheme } from '../../src/store/ThemeContext';
import { useWishlist } from '../../src/store/WishlistContext';

type LocalSeriesCover = {
  coverUrl?: string;
  isbn?: string;
};

type RankingSummary = {
  favoriteTotal: number;
  listedCount: number;
  ownerTotal: number;
  personalCount: number;
  wantTotal: number;
};

const RANKING_CATEGORY_ICONS: Record<RankingCategory, keyof typeof Ionicons.glyphMap> = {
  overall: 'sparkles-outline',
  wanted: 'heart-outline',
  owned: 'people-outline',
  favorite: 'bookmark-outline',
  personal: 'star-outline',
};

export default function RankingScreen() {
  const { colors } = useAppTheme();
  const { books } = useLibrary();
  const { addItem, items } = useWishlist();
  const [globalRows, setGlobalRows] = useState<GlobalRankingRow[]>([]);
  const [globalFavoriteRows, setGlobalFavoriteRows] = useState<GlobalRankingRow[]>([]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const tabScrollToTopRef = useRef({
    scrollToTop: () => scrollRef.current?.scrollTo({ y: 0, animated: true }),
  });
  const addedTitles = useMemo(() => new Set(items.map((item) => normalizeRankingTitle(item.title))), [items]);
  const localSeriesCoverByKey = useMemo(
    () =>
      new Map(
        buildSeriesGroups(books)
          .filter((group) => !!group.representative.thumbnailUrl || !!group.representative.isbn)
          .map((group) => [
            normalizeLooseSeriesKey(group.title),
            {
              coverUrl: group.representative.thumbnailUrl,
              isbn: group.representative.isbn,
            } satisfies LocalSeriesCover,
          ]),
      ),
    [books],
  );
  const ownedSeriesKeys = useMemo(
    () => new Set(buildSeriesGroups(books).map((group) => normalizeLooseSeriesKey(group.title))),
    [books],
  );
  useScrollToTop(tabScrollToTopRef);
  const sections = useMemo(
    () =>
      rankingCategories.map((category) => ({
        category,
        rows: buildRankingRows(category, category === 'favorite' ? globalFavoriteRows : globalRows, items).map((row) => {
          const localCover = resolveLocalSeriesCover(row.title, localSeriesCoverByKey);
          return {
            ...row,
            ...localCover,
            coverUrl: localCover?.coverUrl ?? row.coverUrl,
            preferIsbnCover: !!localCover?.isbn && !localCover.coverUrl,
          };
        }),
        ...rankingCategoryLabels[category],
      })),
    [globalFavoriteRows, globalRows, items, localSeriesCoverByKey],
  );
  const rankingSummary = useMemo<RankingSummary>(() => {
    const titles = new Set(globalRows.map((row) => normalizeRankingTitle(row.title)));
    globalFavoriteRows.forEach((row) => titles.add(normalizeRankingTitle(row.title)));
    return {
      favoriteTotal: globalFavoriteRows.reduce((sum, row) => sum + Number(row.favorite_count ?? 0), 0),
      listedCount: titles.size,
      ownerTotal: globalRows.reduce((sum, row) => sum + Number(row.owner_count ?? 0), 0),
      personalCount: items.length,
      wantTotal: globalRows.reduce((sum, row) => sum + Number(row.want_count ?? 0), 0),
    };
  }, [globalFavoriteRows, globalRows, items.length]);

  const loadRankings = async () => {
    if (!supabase) {
      setError('Supabaseが未設定のため、ランキングを取得できません。');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_wanted_manga_rankings', { limit_count: 50 });
      if (rpcError) throw rpcError;
      setGlobalRows((data ?? []) as GlobalRankingRow[]);
      const { data: favoriteData, error: favoriteRpcError } = await supabase.rpc('get_favorite_series_rankings', {
        limit_count: 50,
      });
      if (favoriteRpcError) {
        if (!isMissingSupabaseFunctionError(favoriteRpcError)) {
          console.warn('Failed to load favorite rankings', favoriteRpcError);
        }
        setGlobalFavoriteRows([]);
      } else {
        setGlobalFavoriteRows((favoriteData ?? []) as GlobalRankingRow[]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'ランキングを取得できませんでした。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRankings();
  }, []);

  return (
    <ScrollView
      ref={scrollRef}
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => void loadRankings()} tintColor={colors.text} />
      }
    >
      <Pressable onPress={() => setExpandedKey(null)} style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.text }]}>{'ランキング'}</Text>
        </View>
        <Text style={[styles.copy, { color: colors.muted }]}>
          {'欲しい、所持、お気に入りをまとめて、今動いているシリーズを一覧で見られます。'}
        </Text>
      </Pressable>

      <RankingHighlights sections={sections} />

      {error ? <EmptyState icon="cloud-offline-outline" text={error} /> : null}

      {sections.map((section) => (
        <RankingShelf
          key={section.category}
          category={section.category}
          addedTitles={addedTitles}
          description={section.description}
          expandedKey={expandedKey}
          ownedSeriesKeys={ownedSeriesKeys}
          onAddWishlist={
            section.category === 'personal'
              ? undefined
              : (row) =>
                  addItem({
                    title: row.title,
                    score: row.score ?? 75,
                    coverUrl: row.coverUrl,
                    purchaseUrl: buildPurchaseUrl(row.title),
                  })
          }
          onClearExpanded={() => setExpandedKey(null)}
          onToggleExpanded={(key) => setExpandedKey((current) => (current === key ? null : key))}
          rows={section.rows}
          title={section.title}
        />
      ))}
    </ScrollView>
  );
}


function RankingHighlights({
  sections,
}: {
  sections: Array<{
    category: RankingCategory;
    description: string;
    rows: ReturnType<typeof buildRankingRows>;
    title: string;
  }>;
}) {
  const { colors } = useAppTheme();
  const wantedTop = sections.find((section) => section.category === 'wanted')?.rows[0];
  const ownedTop = sections.find((section) => section.category === 'owned')?.rows[0];
  const favoriteTop = sections.find((section) => section.category === 'favorite')?.rows[0];
  const personalTop = sections.find((section) => section.category === 'personal')?.rows[0];
  const wantedTopCount = getRankingMetric(wantedTop, 'wantCount');
  const ownedTopCount = getRankingMetric(ownedTop, 'ownerCount');
  const favoriteTopCount = getRankingMetric(favoriteTop, 'favoriteCount');
  const personalTopScore = getRankingMetric(personalTop, 'score');

  return (
    <View style={styles.highlightSection}>
      <View style={styles.highlightHeader}>
        <View>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{'\u6ce8\u76ee\u30b5\u30de\u30ea\u30fc'}</Text>
          <Text style={[styles.copy, { color: colors.muted }]}>
            {'\u4eca\u306e\u4eba\u6c17\u3001\u6240\u6301\u3001\u81ea\u5206\u306e\u5019\u88dc\u3092\u3072\u3068\u76ee\u3067\u78ba\u8a8d\u3067\u304d\u307e\u3059\u3002'}
          </Text>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.highlightList}>
        <HighlightTile
          icon="heart"
          label={'\u6b32\u3057\u3044\u6700\u591a'}
          title={wantedTop?.title ?? '\u96c6\u8a08\u5f85\u3061'}
          value={wantedTopCount !== undefined ? `${wantedTopCount}\u4ef6` : '-'}
        />
        <HighlightTile
          icon="people"
          label={'\u6240\u6301\u30e6\u30fc\u30b6\u30fc'}
          title={ownedTop?.title ?? '\u96c6\u8a08\u5f85\u3061'}
          value={ownedTopCount !== undefined ? `${ownedTopCount}\u4eba` : '-'}
        />
        <HighlightTile
          icon="bookmark"
          label={'\u304a\u6c17\u306b\u5165\u308a'}
          title={favoriteTop?.title ?? '\u96c6\u8a08\u5f85\u3061'}
          value={favoriteTopCount !== undefined ? `${favoriteTopCount}\u4ef6` : '-'}
        />
        <HighlightTile
          icon="star"
          label={'\u81ea\u5206\u306e1\u4f4d'}
          title={personalTop?.title ?? '\u672a\u767b\u9332'}
          value={personalTopScore !== undefined ? `${personalTopScore}\u70b9` : '-'}
        />
      </ScrollView>
    </View>
  );
}

function getRankingMetric(row: ReturnType<typeof buildRankingRows>[number] | undefined, key: keyof RankingDisplayRow) {
  if (!row || !(key in row)) return undefined;
  const value = row[key as keyof typeof row];
  return typeof value === 'number' ? value : undefined;
}

function HighlightTile({
  icon,
  label,
  title,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  title: string;
  value: string;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.highlightTile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.highlightTileTop}>
        <View style={[styles.highlightIcon, { backgroundColor: colors.text }]}>
          <Ionicons color={colors.background} name={icon} size={15} />
        </View>
        <Text style={[styles.highlightValue, { color: colors.text }]}>{value}</Text>
      </View>
      <Text style={[styles.highlightLabel, { color: colors.muted }]}>{label}</Text>
      <Text numberOfLines={2} style={[styles.highlightTitle, { color: colors.text }]}>{title}</Text>
    </View>
  );
}

function RankingShelf({
  addedTitles,
  category,
  description,
  expandedKey,
  onAddWishlist,
  onClearExpanded,
  onToggleExpanded,
  ownedSeriesKeys,
  rows,
  title,
}: {
  addedTitles: Set<string>;
  category: RankingCategory;
  description: string;
  expandedKey: string | null;
  onAddWishlist?: (row: ReturnType<typeof buildRankingRows>[number]) => void;
  onClearExpanded: () => void;
  onToggleExpanded: (key: string) => void;
  ownedSeriesKeys: Set<string>;
  rows: ReturnType<typeof buildRankingRows>;
  title: string;
}) {
  const { colors } = useAppTheme();
  const topRows = rows.slice(0, 10);

  return (
    <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable onPress={onClearExpanded} style={styles.sectionHeader}>
        <View style={[styles.sectionIcon, { backgroundColor: colors.background }]}>
          <Ionicons color={colors.text} name={RANKING_CATEGORY_ICONS[category]} size={18} />
        </View>
        <View style={styles.sectionTitleBlock}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
            <View style={[styles.countPill, { borderColor: colors.border }]}>
              <Text style={[styles.countPillText, { color: colors.muted }]}>{`${rows.length}\u4ef6`}</Text>
            </View>
            {rows.length > 10 ? (
              <Pressable
                accessibilityLabel={`${title}??????`}
                onPress={() => router.push(`/(tabs)/ranking/${category}`)}
                style={styles.moreHeaderButton}
              >
                <Text style={[styles.moreHeaderText, { color: colors.primary }]}>?????</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={[styles.copy, { color: colors.muted }]}>{description}</Text>
        </View>
      </Pressable>

      {topRows.length === 0 ? (
        <EmptyState icon="podium-outline" text="まだ表示できるデータがありません。" />
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalList}
        >
          {topRows.map((row, index) => {
            const key = `${category}-${row.title}-${index}`;
            const owned = !!onAddWishlist && isOwnedSeriesTitle(row.title, ownedSeriesKeys);
            const canAddWishlist = !!onAddWishlist && !owned;
            return (
              <RankingCard
                key={key}
                added={addedTitles.has(normalizeRankingTitle(row.title))}
                disabledAddLabel={owned ? '所持済み' : undefined}
                expanded={expandedKey === key}
                index={index}
                onAddWishlist={canAddWishlist ? () => onAddWishlist(row) : undefined}
                onPress={onAddWishlist ? () => onToggleExpanded(key) : undefined}
                row={row}
                variant="compact"
              />
            );
          })}
          {rows.length > 10 ? (
            <Pressable
              accessibilityLabel={`${title}をもっと見る`}
              onPress={() => router.push(`/(tabs)/ranking/${category}`)}
              style={[styles.moreTailCard, { borderColor: colors.border }]}
            >
              <Ionicons color={colors.text} name="chevron-forward-circle-outline" size={24} />
              <Text style={[styles.moreTailText, { color: colors.text }]}>もっと見る</Text>
              <Text style={[styles.moreTailSubText, { color: colors.muted }]}>11位以降</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function normalizeRankingTitle(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeLooseSeriesKey(value: string) {
  return normalizeSeriesKey(value).replace(/[!！?？。．.・･]/g, '');
}


function isOwnedSeriesTitle(title: string, ownedSeriesKeys: Set<string>) {
  const key = normalizeLooseSeriesKey(title);
  if (!key) return false;
  if (ownedSeriesKeys.has(key)) return true;
  return [...ownedSeriesKeys].some((ownedKey) => ownedKey.includes(key) || key.includes(ownedKey));
}

function resolveLocalSeriesCover(title: string, covers: Map<string, LocalSeriesCover>) {
  const key = normalizeLooseSeriesKey(title);
  const exact = covers.get(key);
  if (exact) return exact;
  return [...covers.entries()].find(([candidateKey]) => candidateKey.includes(key) || key.includes(candidateKey))?.[1];
}

function EmptyState({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  const { colors } = useAppTheme();

  return (
    <View style={[styles.emptyBox, { borderColor: colors.border }]}>
      <Ionicons color={colors.muted} name={icon} size={24} />
      <Text style={[styles.copy, { color: colors.muted }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 18, padding: 18, paddingBottom: 40 },
  header: { gap: 5 },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  title: { flex: 1, fontSize: 24, fontWeight: '900' },
  copy: { fontSize: 13, lineHeight: 18 },
  highlightSection: { gap: 10 },
  highlightHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  highlightList: { gap: 10, paddingRight: 8 },
  highlightTile: { borderRadius: 8, borderWidth: 1, gap: 6, minHeight: 116, padding: 12, width: 154 },
  highlightTileTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  highlightIcon: { alignItems: 'center', borderRadius: 8, height: 30, justifyContent: 'center', width: 30 },
  highlightValue: { fontSize: 15, fontWeight: '900' },
  highlightLabel: { fontSize: 11, fontWeight: '900' },
  highlightTitle: { fontSize: 14, fontWeight: '900', lineHeight: 19 },
  section: { borderRadius: 8, borderWidth: 1, gap: 12, padding: 12 },
  sectionHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
  sectionIcon: { alignItems: 'center', borderRadius: 8, height: 34, justifyContent: 'center', width: 34 },
  sectionTitleBlock: { flex: 1, gap: 3 },
  sectionTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  sectionTitle: { flex: 1, fontSize: 18, fontWeight: '900' },
  countPill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  countPillText: { fontSize: 11, fontWeight: '900' },
  moreHeaderButton: { paddingHorizontal: 2, paddingVertical: 4 },
  moreHeaderText: { fontSize: 12, fontWeight: '900' },
  moreTailCard: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    height: 196,
    justifyContent: 'center',
    padding: 10,
    width: 136,
  },
  moreTailText: { fontSize: 13, fontWeight: '900' },
  moreTailSubText: { fontSize: 11, fontWeight: '800' },
  horizontalList: { alignItems: 'flex-start', gap: 10, minHeight: 236, paddingRight: 8 },
  emptyBox: { alignItems: 'center', borderRadius: 8, borderWidth: 1, gap: 6, padding: 18 },
});

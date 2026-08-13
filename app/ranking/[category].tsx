import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RankingCard } from '../../src/components/RankingCard';
import { buildPurchaseUrl } from '../../src/lib/bookApis';
import {
  buildRankingRows,
  GlobalRankingRow,
  RankingCategory,
  rankingCategoryLabels,
} from '../../src/lib/rankings';
import { normalizeSeriesKey } from '../../src/lib/series';
import { buildSeriesGroups } from '../../src/lib/seriesSelectors';
import { supabase } from '../../src/lib/supabase';
import { isMissingSupabaseFunctionError } from '../../src/lib/supabaseErrors';
import { useLibrary } from '../../src/store/LibraryContext';
import { useAppTheme } from '../../src/store/ThemeContext';
import { useWishlist } from '../../src/store/WishlistContext';

const PAGE_SIZE = 10;

type LocalSeriesCover = {
  coverUrl?: string;
  isbn?: string;
};

function parseCategory(value: string | string[] | undefined): RankingCategory {
  const category = Array.isArray(value) ? value[0] : value;
  if (category === 'wanted' || category === 'owned' || category === 'favorite' || category === 'personal') return category;
  return 'overall';
}

export default function RankingCategoryScreen() {
  const { category: rawCategory } = useLocalSearchParams();
  const category = parseCategory(rawCategory);
  const { colors } = useAppTheme();
  const navigation = useNavigation();
  const router = useRouter();
  const { books } = useLibrary();
  const { addItem, items } = useWishlist();
  const [globalRows, setGlobalRows] = useState<GlobalRankingRow[]>([]);
  const [globalFavoriteRows, setGlobalFavoriteRows] = useState<GlobalRankingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const label = rankingCategoryLabels[category];

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
  const rows = useMemo(
    () =>
      buildRankingRows(category, category === 'favorite' ? globalFavoriteRows : globalRows, items).map((row) => {
        const localCover = resolveLocalSeriesCover(row.title, localSeriesCoverByKey);
        return {
          ...row,
          ...localCover,
          coverUrl: localCover?.coverUrl ?? row.coverUrl,
          preferIsbnCover: !!localCover?.isbn && !localCover.coverUrl,
        };
      }),
    [category, globalFavoriteRows, globalRows, items, localSeriesCoverByKey],
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [page, rows],
  );
  const addedTitles = useMemo(() => new Set(items.map((item) => normalizeRankingTitle(item.title))), [items]);
  const goBackToRanking = useCallback(() => {
    router.replace('/(tabs)/ranking');
  }, [router]);
  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <Pressable
          accessibilityLabel="順位に戻る"
          hitSlop={10}
          onPress={goBackToRanking}
          style={styles.headerBackButton}
        >
          <Ionicons color={colors.text} name="chevron-back" size={24} />
          <Text style={[styles.headerBackText, { color: colors.text }]}>戻る</Text>
        </Pressable>
      ),
    });
  }, [colors.text, goBackToRanking, navigation]);

  const loadRankings = async () => {
    if (category === 'personal') {
      setGlobalRows([]);
      setGlobalFavoriteRows([]);
      setError(null);
      return;
    }
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
      if (category === 'favorite') {
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
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'ランキングを取得できませんでした。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRankings();
  }, [category]);

  useEffect(() => {
    setPage(1);
  }, [category]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: label.title }} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => void loadRankings()} tintColor={colors.text} />
        }
      >
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View style={styles.titleBlock}>
              <Text style={[styles.title, { color: colors.text }]}>{label.title}</Text>
              <Text style={[styles.copy, { color: colors.muted }]}>
                {label.description} 画面上部から下に引くと更新できます。
              </Text>
            </View>
          </View>
        </View>

        {error ? (
          <EmptyState icon="cloud-offline-outline" text={error} />
        ) : rows.length === 0 ? (
          <EmptyState icon="podium-outline" text="まだ表示できるデータがありません。" />
        ) : (
          <View style={styles.list}>
            <Pagination
              page={page}
              pageCount={pageCount}
              onChange={setPage}
            />
            {pageRows.map((row, index) => {
              const owned = category !== 'personal' && isOwnedSeriesTitle(row.title, ownedSeriesKeys);
              const canAddWishlist = category !== 'personal' && !owned;
              return (
                <RankingCard
                  key={`${category}-${row.title}-${(page - 1) * PAGE_SIZE + index}`}
                  added={addedTitles.has(normalizeRankingTitle(row.title))}
                  disabledAddLabel={owned ? '所持済み' : undefined}
                  index={(page - 1) * PAGE_SIZE + index}
                  onAddWishlist={
                    canAddWishlist
                      ? () =>
                          addItem({
                            title: row.title,
                            score: row.score ?? 75,
                            coverUrl: row.coverUrl,
                            purchaseUrl: buildPurchaseUrl(row.title),
                          })
                      : undefined
                  }
                  row={row}
                  showOwnedVolumeCount={false}
                />
              );
            })}
            <Pagination
              page={page}
              pageCount={pageCount}
              onChange={setPage}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}) {
  const { colors } = useAppTheme();
  if (pageCount <= 1) return null;

  return (
    <View style={styles.pagination}>
      <Pressable
        accessibilityLabel="前のページを表示"
        disabled={page === 1}
        onPress={() => onChange(Math.max(1, page - 1))}
        style={[
          styles.pageArrowButton,
          { borderColor: colors.border },
          page === 1 && styles.disabledButton,
        ]}
      >
        <Text style={[styles.pageArrowText, { color: colors.text }]}>{'<'}</Text>
      </Pressable>
      <View style={[styles.pageNumberBox, { backgroundColor: colors.text, borderColor: colors.text }]}>
        <Text style={[styles.pageNumberText, { color: colors.background }]}>
          {page}
          <Text style={styles.pageCountText}> / {pageCount}</Text>
        </Text>
      </View>
      <Pressable
        accessibilityLabel="次のページを表示"
        disabled={page === pageCount}
        onPress={() => onChange(Math.min(pageCount, page + 1))}
        style={[
          styles.pageArrowButton,
          { borderColor: colors.border },
          page === pageCount && styles.disabledButton,
        ]}
      >
        <Text style={[styles.pageArrowText, { color: colors.text }]}>{'>'}</Text>
      </Pressable>
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
  headerBackButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
    minHeight: 36,
    paddingRight: 8,
  },
  headerBackText: { fontSize: 15, fontWeight: '800' },
  content: { gap: 16, padding: 18, paddingBottom: 40 },
  header: { gap: 6 },
  titleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  titleBlock: { flex: 1, gap: 4 },
  title: { fontSize: 24, fontWeight: '900' },
  copy: { fontSize: 13, lineHeight: 18 },
  list: { gap: 8 },
  disabledButton: { opacity: 0.35 },
  pagination: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'center', paddingTop: 8 },
  pageArrowButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 42,
  },
  pageArrowText: { fontSize: 18, fontWeight: '900' },
  pageNumberBox: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    minWidth: 86,
    paddingHorizontal: 12,
  },
  pageNumberText: { fontSize: 13, fontWeight: '900' },
  pageCountText: { fontSize: 11, fontWeight: '800' },
  emptyBox: { alignItems: 'center', borderRadius: 8, borderWidth: 1, gap: 6, padding: 18 },
});

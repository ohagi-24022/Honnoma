import AsyncStorage from '@react-native-async-storage/async-storage';
import { useScrollToTop } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';

import { BookCover } from '../../src/components/BookCover';
import { BookRow } from '../../src/components/home/BookRow';
import { EmptyLibraryState } from '../../src/components/home/EmptyLibraryState';
import { HomeToolbar } from '../../src/components/home/HomeToolbar';
import { OptionSheet } from '../../src/components/home/OptionSheet';
import { SeriesCard } from '../../src/components/home/SeriesCard';
import { lookupLatestSeriesPublication, SeriesPublicationInfo } from '../../src/lib/bookApis';
import {
  getNewReleaseSubscriptions,
  setNewReleaseSeriesSubscription,
  syncNewReleaseSubscriptions,
} from '../../src/lib/newReleaseNotifications';
import { getMissingVolumes, normalizeSeriesKey } from '../../src/lib/series';
import { SeriesGroup } from '../../src/lib/seriesSelectors';
import { supabase } from '../../src/lib/supabase';
import { isMissingSupabaseRelationError } from '../../src/lib/supabaseErrors';
import { useAppSettings } from '../../src/store/AppSettingsContext';
import { useAuth } from '../../src/store/AuthContext';
import { useLibrary } from '../../src/store/LibraryContext';
import { useAppTheme } from '../../src/store/ThemeContext';
import { Book, ReadingStatus } from '../../src/types';

type HomeFilter =
  | ReadingStatus
  | 'all'
  | 'missing'
  | 'favorite'
  | 'completed'
  | 'ongoing'
  | `author:${string}`
  | `publisher:${string}`;
type SeriesSort = 'title' | 'recent' | 'missing' | 'unread' | 'completion' | 'favorite' | 'author' | 'publisher';
type BookSort = 'recent' | 'title' | 'series' | 'volume' | 'status' | 'favorite' | 'author' | 'publisher';
type SeriesDisplayMode = 'detail' | 'cover' | 'title';
type SeriesPublicationCache = Record<string, SeriesPublicationInfo>;
type SeriesStats = {
  completionRate: number;
  internalMissingVolumes: number[];
  missingVolumes: number[];
  trailingUnownedVolumes: number[];
};

export const SERIES_PUBLICATION_STORAGE_KEY = 'booknest.series-publication.v1';
const filterOptions: Array<{ label: string; value: HomeFilter }> = [
  { label: 'すべて', value: 'all' },
  { label: '未読', value: 'unread' },
  { label: '読書中', value: 'reading' },
  { label: '読了', value: 'read' },
  { label: '巻抜け', value: 'missing' },
  { label: 'お気に入り', value: 'favorite' },
  { label: '完結済み', value: 'completed' },
  { label: '未完結', value: 'ongoing' },
];
const filterCategoryOptions = [
  ...filterOptions,
  { label: '作者で絞る', value: 'select-author' },
  { label: '出版社で絞る', value: 'select-publisher' },
];
const seriesSortOptions: Array<{ label: string; value: SeriesSort }> = [
  { label: '名前順', value: 'title' },
  { label: '最近追加', value: 'recent' },
  { label: '巻抜け優先', value: 'missing' },
  { label: '未読優先', value: 'unread' },
  { label: '所持率順', value: 'completion' },
  { label: 'お気に入り優先', value: 'favorite' },
  { label: '作者順', value: 'author' },
  { label: '出版社順', value: 'publisher' },
];
const bookSortOptions: Array<{ label: string; value: BookSort }> = [
  { label: '最近追加', value: 'recent' },
  { label: 'タイトル順', value: 'title' },
  { label: 'シリーズ順', value: 'series' },
  { label: '巻数順', value: 'volume' },
  { label: '読書状態順', value: 'status' },
  { label: 'お気に入り優先', value: 'favorite' },
  { label: '作者順', value: 'author' },
  { label: '出版社順', value: 'publisher' },
];
const readingStatusOrder: Record<ReadingStatus, number> = { reading: 0, unread: 1, read: 2 };
const readingFilters: ReadingStatus[] = ['unread', 'reading', 'read'];

function getActiveFilters(filters: HomeFilter[]) {
  return filters.includes('all') ? [] : filters;
}

function getMetadataFilter(filter: HomeFilter) {
  if (filter.startsWith('author:')) {
    return { field: 'author' as const, value: decodeURIComponent(filter.slice('author:'.length)) };
  }
  if (filter.startsWith('publisher:')) {
    return { field: 'publisher' as const, value: decodeURIComponent(filter.slice('publisher:'.length)) };
  }
  return null;
}

function getSelectedMetadataFilters(filters: HomeFilter[]) {
  const activeFilters = getActiveFilters(filters);
  return {
    authors: activeFilters
      .filter((filter) => filter.startsWith('author:'))
      .map((filter) => decodeURIComponent(filter.slice('author:'.length))),
    publishers: activeFilters
      .filter((filter) => filter.startsWith('publisher:'))
      .map((filter) => decodeURIComponent(filter.slice('publisher:'.length))),
  };
}

function toggleFilterValue(filters: HomeFilter[], value: HomeFilter) {
  if (value === 'all') return ['all'] satisfies HomeFilter[];
  const activeFilters = getActiveFilters(filters);
  const next = activeFilters.includes(value)
    ? activeFilters.filter((filter) => filter !== value)
    : [...activeFilters, value];
  return next.length > 0 ? next : (['all'] satisfies HomeFilter[]);
}

function removeFilterGroup(filters: HomeFilter[], prefix: 'author:' | 'publisher:') {
  const next = getActiveFilters(filters).filter((filter) => !filter.startsWith(prefix));
  return next.length > 0 ? next : (['all'] satisfies HomeFilter[]);
}

function getTrailingUnownedVolumes(ownedLatestVolume?: number, publishedLatestVolume?: number) {
  if (!ownedLatestVolume || !publishedLatestVolume || publishedLatestVolume <= ownedLatestVolume) return [];
  return Array.from({ length: publishedLatestVolume - ownedLatestVolume }, (_, index) => ownedLatestVolume + index + 1);
}

function normalizeText(value: string) {
  return value.normalize('NFKC').toLowerCase();
}

function findRepresentativeRefreshTarget(books: Book[], seriesTitle: string) {
  const targetSeriesKey = normalizeSeriesKey(seriesTitle);
  return books
    .filter((book) => normalizeSeriesKey(book.seriesTitle) === targetSeriesKey)
    .sort(
      (left, right) =>
        (left.volumeNumber ?? Number.MAX_SAFE_INTEGER) -
          (right.volumeNumber ?? Number.MAX_SAFE_INTEGER) ||
        left.createdAt.localeCompare(right.createdAt),
    )[0];
}

function getNextSeriesDisplayMode(mode: SeriesDisplayMode): SeriesDisplayMode {
  if (mode === 'detail') return 'cover';
  if (mode === 'cover') return 'title';
  return 'detail';
}

export default function HomeScreen() {
  const { colors } = useAppTheme();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const { favoriteSeriesKeys, hydrated: appSettingsHydrated, newReleaseNotifications, setFavoriteSeries, showPublishedLatestVolume } =
    useAppSettings();
  const { user } = useAuth();
  const { books, error, loading, refreshLibrary, repairBookMetadata, requiresAuth, seriesGroups } = useLibrary();
  const [filters, setFilters] = useState<HomeFilter[]>(['all']);
  const [viewMode, setViewMode] = useState<'series' | 'books'>('series');
  const [seriesDisplayMode, setSeriesDisplayMode] = useState<SeriesDisplayMode>('detail');
  const [seriesSort, setSeriesSort] = useState<SeriesSort>('title');
  const [bookSort, setBookSort] = useState<BookSort>('recent');
  const [query, setQuery] = useState('');
  const [openMenu, setOpenMenu] = useState<'filter' | 'sort' | 'author' | 'publisher' | null>(null);
  const [toolbarHeight, setToolbarHeight] = useState(152);
  const [publicationCache, setPublicationCache] = useState<SeriesPublicationCache>({});
  const [visibleFavoriteSeriesKeys, setVisibleFavoriteSeriesKeys] = useState<string[]>(favoriteSeriesKeys);
  const [refreshingSeriesTitle, setRefreshingSeriesTitle] = useState<string | null>(null);
  const [notificationSeriesKeys, setNotificationSeriesKeys] = useState<string[]>([]);
  const [updatingNotificationSeriesKey, setUpdatingNotificationSeriesKey] = useState<string | null>(null);
  const toolbarTranslateY = useRef(new Animated.Value(0)).current;
  const seriesListRef = useRef<FlatList<SeriesGroup>>(null);
  const booksListRef = useRef<FlatList<Book>>(null);
  const activeViewModeRef = useRef(viewMode);
  const tabScrollToTopRef = useRef({ scrollToTop: () => {} });
  const toolbarVisibleRef = useRef(true);
  const lastScrollYRef = useRef(0);
  const directionDistanceRef = useRef(0);
  const lastDirectionRef = useRef<1 | -1>(1);
  const favoriteSeriesKeySet = useMemo(() => new Set(visibleFavoriteSeriesKeys), [visibleFavoriteSeriesKeys]);
  const coverGridColumns = Math.max(3, Math.floor((windowWidth - 36 + 10) / 92));
  const coverTileWidth = (windowWidth - 36 - (coverGridColumns - 1) * 10) / coverGridColumns;
  activeViewModeRef.current = viewMode;

  useEffect(() => {
    setVisibleFavoriteSeriesKeys(favoriteSeriesKeys);
  }, [favoriteSeriesKeys]);

  useEffect(() => {
    if (!appSettingsHydrated || !user || !supabase || seriesGroups.length === 0) return;
    let cancelled = false;
    const groupKeys = new Map(
      seriesGroups.map((group) => [normalizeSeriesKey(group.title), normalizeSeriesKey(group.title)]),
    );

    supabase
      .from('favorite_series')
      .select('series_key, series_title')
      .eq('user_id', user.id)
      .then(({ data, error: favoriteLoadError }) => {
        if (cancelled) return;
        if (favoriteLoadError) {
          if (!isMissingSupabaseRelationError(favoriteLoadError)) {
            console.warn('Failed to refresh favorite series state', favoriteLoadError);
          }
          return;
        }

        const remoteKeys = (data ?? []).flatMap((row) => {
          const seriesKey = typeof row.series_key === 'string' ? normalizeSeriesKey(row.series_key) : '';
          const seriesTitle = typeof row.series_title === 'string' ? normalizeSeriesKey(row.series_title) : '';
          return [seriesKey, seriesTitle].filter(Boolean);
        });
        const matchedKeys = remoteKeys
          .map((key) => groupKeys.get(key))
          .filter((key): key is string => !!key);

        if (matchedKeys.length === 0) return;
        setVisibleFavoriteSeriesKeys((current) => [...new Set([...current, ...matchedKeys])]);
      });

    return () => {
      cancelled = true;
    };
  }, [appSettingsHydrated, seriesGroups, user]);

  useEffect(() => {
    AsyncStorage.getItem(SERIES_PUBLICATION_STORAGE_KEY)
      .then((storedCache) => {
        if (storedCache) setPublicationCache(JSON.parse(storedCache) as SeriesPublicationCache);
      })
      .catch((cacheError) => console.warn('Failed to load series publication cache', cacheError));
  }, []);

  useEffect(() => {
    if (!user || !newReleaseNotifications) {
      setNotificationSeriesKeys([]);
      return;
    }

    let cancelled = false;
    syncNewReleaseSubscriptions(user.id, seriesGroups)
      .then(() => getNewReleaseSubscriptions(user.id))
      .then((subscriptions) => {
        if (cancelled) return;
        setNotificationSeriesKeys(
          subscriptions.filter((subscription) => subscription.enabled).map((subscription) => subscription.seriesKey),
        );
      })
      .catch((notificationError) => {
        if (cancelled) return;
        Alert.alert(
          '通知対象を読み込めませんでした',
          notificationError instanceof Error ? notificationError.message : '通信状態を確認してもう一度お試しください。',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [newReleaseNotifications, seriesGroups, user]);

  useEffect(() => {
    if (!appSettingsHydrated || !user || !supabase) return;
    const client = supabase;

    const favoriteKeySet = new Set(favoriteSeriesKeys);
    const favoriteRows = seriesGroups
      .filter((group) => favoriteKeySet.has(normalizeSeriesKey(group.title)))
      .map((group) => ({
        user_id: user.id,
        series_key: normalizeSeriesKey(group.title),
        series_title: group.title,
        cover_url: group.representative.thumbnailUrl ?? null,
        owned_volume_count: group.ownedCount,
        updated_at: new Date().toISOString(),
      }));

    const syncFavoriteSeries = async () => {
      if (favoriteRows.length > 0) {
        const { error: upsertError } = await client
          .from('favorite_series')
          .upsert(favoriteRows, { onConflict: 'user_id,series_key' });
        if (upsertError) throw upsertError;
      }
    };

    syncFavoriteSeries().catch((favoriteSyncError) => {
      console.warn('Failed to sync favorite series rankings', favoriteSyncError);
    });
  }, [appSettingsHydrated, favoriteSeriesKeys, seriesGroups, user]);

  const metadataFilterOptions = useMemo(() => {
    const authors = [...new Set(seriesGroups.flatMap((group) => group.authors))]
      .sort((left, right) => left.localeCompare(right))
      .map((author) => ({ label: author, value: `author:${encodeURIComponent(author)}` as HomeFilter }));
    const publishers = [...new Set(seriesGroups.flatMap((group) => group.publishers))]
      .sort((left, right) => left.localeCompare(right))
      .map((publisher) => ({ label: publisher, value: `publisher:${encodeURIComponent(publisher)}` as HomeFilter }));
    return { authors, publishers };
  }, [seriesGroups]);

  const seriesStats = useMemo(() => {
    const bySeries = new Map<string, Book[]>();
    books.forEach((book) => {
      const seriesKey = normalizeSeriesKey(book.seriesTitle);
      const group = bySeries.get(seriesKey) ?? [];
      group.push(book);
      bySeries.set(seriesKey, group);
    });

    return new Map<string, SeriesStats>(
      [...bySeries.entries()].map(([seriesKey, groupedBooks]) => {
        const volumes = groupedBooks
          .map((book) => book.volumeNumber)
          .filter((volume): volume is number => !!volume);
        const latestVolume = volumes.length > 0 ? Math.max(...volumes) : undefined;
        const publishedLatestVolume = publicationCache[seriesKey]?.latestVolume;
        const internalMissingVolumes = getMissingVolumes(volumes);
        const trailingUnownedVolumes = getTrailingUnownedVolumes(latestVolume, publishedLatestVolume);
        const missingVolumes = [...new Set([...internalMissingVolumes, ...trailingUnownedVolumes])].sort(
          (left, right) => left - right,
        );
        const denominator = Math.max(latestVolume ?? 0, publishedLatestVolume ?? 0);
        const completionRate = denominator > 0 ? Math.round((groupedBooks.length / denominator) * 100) : 100;
        return [seriesKey, { completionRate, internalMissingVolumes, missingVolumes, trailingUnownedVolumes }] as const;
      }),
    );
  }, [books, publicationCache]);

  const visibleGroups = useMemo(() => {
    const activeFilters = getActiveFilters(filters);
    const metadataFilters = getSelectedMetadataFilters(filters);
    const statusFilters = activeFilters.filter((filter): filter is ReadingStatus =>
      readingFilters.includes(filter as ReadingStatus),
    );
    const keyword = normalizeText(query);

    const filtered = seriesGroups.filter((group) => {
      const seriesKey = normalizeSeriesKey(group.title);
      const stats = seriesStats.get(seriesKey);
      const publicationInfo = publicationCache[seriesKey];
      const matchesStatus =
        statusFilters.length === 0 ||
        statusFilters.some(
          (status) =>
            (status === 'unread' && group.unreadCount > 0) ||
            (status === 'reading' && group.readingCount > 0) ||
            (status === 'read' && group.readCount === group.ownedCount),
        );
      const matchesFilter =
        matchesStatus &&
        (!activeFilters.includes('missing') || (stats?.missingVolumes.length ?? 0) > 0) &&
        (!activeFilters.includes('favorite') || favoriteSeriesKeySet.has(seriesKey)) &&
        (!activeFilters.includes('completed') || publicationInfo?.isCompleted === true) &&
        (!activeFilters.includes('ongoing') || publicationInfo?.isCompleted !== true) &&
        (metadataFilters.authors.length === 0 ||
          group.authors.some((author) => metadataFilters.authors.includes(author))) &&
        (metadataFilters.publishers.length === 0 ||
          group.publishers.some((publisher) => metadataFilters.publishers.includes(publisher)));
      const matchesQuery =
        normalizeText(group.title).includes(keyword) ||
        group.authors.some((author) => normalizeText(author).includes(keyword)) ||
        group.publishers.some((publisher) => normalizeText(publisher).includes(keyword));
      return matchesFilter && matchesQuery;
    });

    return filtered.sort((left, right) => {
      if (seriesSort === 'recent') return right.latestAddedAt.localeCompare(left.latestAddedAt);
      if (seriesSort === 'missing') {
        return (
          (seriesStats.get(normalizeSeriesKey(right.title))?.missingVolumes.length ?? 0) -
            (seriesStats.get(normalizeSeriesKey(left.title))?.missingVolumes.length ?? 0) ||
          left.title.localeCompare(right.title)
        );
      }
      if (seriesSort === 'unread') return right.unreadCount - left.unreadCount || left.title.localeCompare(right.title);
      if (seriesSort === 'completion') {
        return (
          (seriesStats.get(normalizeSeriesKey(right.title))?.completionRate ?? 100) -
            (seriesStats.get(normalizeSeriesKey(left.title))?.completionRate ?? 100) ||
          left.title.localeCompare(right.title)
        );
      }
      if (seriesSort === 'favorite') {
        return (
          Number(favoriteSeriesKeySet.has(normalizeSeriesKey(right.title))) -
            Number(favoriteSeriesKeySet.has(normalizeSeriesKey(left.title))) ||
          left.title.localeCompare(right.title)
        );
      }
      if (seriesSort === 'author') {
        return (left.authors[0] ?? '\uffff').localeCompare(right.authors[0] ?? '\uffff') || left.title.localeCompare(right.title);
      }
      if (seriesSort === 'publisher') {
        return (left.publishers[0] ?? '\uffff').localeCompare(right.publishers[0] ?? '\uffff') || left.title.localeCompare(right.title);
      }
      return left.title.localeCompare(right.title);
    });
  }, [favoriteSeriesKeySet, filters, publicationCache, query, seriesGroups, seriesSort, seriesStats]);

  const visibleBooks = useMemo(() => {
    const activeFilters = getActiveFilters(filters);
    const metadataFilters = getSelectedMetadataFilters(filters);
    const statusFilters = activeFilters.filter((filter): filter is ReadingStatus =>
      readingFilters.includes(filter as ReadingStatus),
    );
    const keyword = normalizeText(query);
    const filtered = books.filter((book) => {
      const seriesKey = normalizeSeriesKey(book.seriesTitle);
      const publicationInfo = publicationCache[seriesKey];
      const matchesFilter =
        (statusFilters.length === 0 || statusFilters.includes(book.status)) &&
        (!activeFilters.includes('missing') || (seriesStats.get(seriesKey)?.missingVolumes.length ?? 0) > 0) &&
        (!activeFilters.includes('favorite') || favoriteSeriesKeySet.has(seriesKey)) &&
        (!activeFilters.includes('completed') || publicationInfo?.isCompleted === true) &&
        (!activeFilters.includes('ongoing') || publicationInfo?.isCompleted !== true) &&
        (metadataFilters.authors.length === 0 || (book.author ? metadataFilters.authors.includes(book.author) : false)) &&
        (metadataFilters.publishers.length === 0 ||
          (book.publisher ? metadataFilters.publishers.includes(book.publisher) : false));
      const matchesQuery =
        normalizeText(book.title).includes(keyword) ||
        normalizeText(book.seriesTitle).includes(keyword) ||
        (book.author ? normalizeText(book.author).includes(keyword) : false) ||
        (book.publisher ? normalizeText(book.publisher).includes(keyword) : false);
      return matchesFilter && matchesQuery;
    });

    return filtered.sort((left, right) => {
      if (bookSort === 'title') return left.title.localeCompare(right.title);
      if (bookSort === 'series') {
        return left.seriesTitle.localeCompare(right.seriesTitle) || (left.volumeNumber ?? 9999) - (right.volumeNumber ?? 9999);
      }
      if (bookSort === 'volume') {
        return (left.volumeNumber ?? 9999) - (right.volumeNumber ?? 9999) || left.seriesTitle.localeCompare(right.seriesTitle);
      }
      if (bookSort === 'status') {
        return readingStatusOrder[left.status] - readingStatusOrder[right.status] || left.title.localeCompare(right.title);
      }
      if (bookSort === 'favorite') {
        return (
          Number(favoriteSeriesKeySet.has(normalizeSeriesKey(right.seriesTitle))) -
            Number(favoriteSeriesKeySet.has(normalizeSeriesKey(left.seriesTitle))) ||
          right.createdAt.localeCompare(left.createdAt)
        );
      }
      if (bookSort === 'author') return (left.author ?? '\uffff').localeCompare(right.author ?? '\uffff') || left.title.localeCompare(right.title);
      if (bookSort === 'publisher') return (left.publisher ?? '\uffff').localeCompare(right.publisher ?? '\uffff') || left.title.localeCompare(right.title);
      return right.createdAt.localeCompare(left.createdAt);
    });
  }, [bookSort, books, favoriteSeriesKeySet, filters, publicationCache, query, seriesStats]);

  const selectedMetadataFilters = getSelectedMetadataFilters(filters);
  const selectedFilterLabel = useMemo(() => {
    const activeFilters = getActiveFilters(filters);
    if (activeFilters.length === 0) return 'すべて';
    const labels = activeFilters
      .map((filter) => {
        const metadataFilter = getMetadataFilter(filter);
        if (metadataFilter?.field === 'author') return `作者:${metadataFilter.value}`;
        if (metadataFilter?.field === 'publisher') return `出版社:${metadataFilter.value}`;
        return filterOptions.find((option) => option.value === filter)?.label;
      })
      .filter(Boolean) as string[];
    return labels.length > 2 ? `${labels.slice(0, 2).join(' / ')} ほか${labels.length - 2}` : labels.join(' / ');
  }, [filters]);
  const selectedSortLabel =
    viewMode === 'series'
      ? seriesSortOptions.find((option) => option.value === seriesSort)?.label ?? '名前順'
      : bookSortOptions.find((option) => option.value === bookSort)?.label ?? '最近追加';
  const listVersion = `${books.length}-${seriesGroups.length}-${filters.join('|')}-${query}`;

  const setToolbarVisible = useCallback(
    (visible: boolean) => {
      if (toolbarVisibleRef.current === visible) return;
      toolbarVisibleRef.current = visible;
      Animated.timing(toolbarTranslateY, {
        toValue: visible ? 0 : -toolbarHeight,
        duration: 180,
        useNativeDriver: true,
      }).start();
    },
    [toolbarHeight, toolbarTranslateY],
  );

  tabScrollToTopRef.current.scrollToTop = () => {
    setToolbarVisible(true);
    lastScrollYRef.current = 0;
    directionDistanceRef.current = 0;
    if (activeViewModeRef.current === 'series') {
      seriesListRef.current?.scrollToOffset({ offset: 0, animated: true });
    } else {
      booksListRef.current?.scrollToOffset({ offset: 0, animated: true });
    }
  };
  useScrollToTop(tabScrollToTopRef);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nextY = Math.max(0, event.nativeEvent.contentOffset.y);
      const delta = nextY - lastScrollYRef.current;
      lastScrollYRef.current = nextY;
      if (nextY < 8) {
        directionDistanceRef.current = 0;
        setToolbarVisible(true);
        return;
      }
      if (Math.abs(delta) < 1) return;
      const direction: 1 | -1 = delta > 0 ? 1 : -1;
      if (lastDirectionRef.current !== direction) {
        lastDirectionRef.current = direction;
        directionDistanceRef.current = 0;
      }
      directionDistanceRef.current += Math.abs(delta);
      if (directionDistanceRef.current >= 14) {
        setToolbarVisible(direction < 0);
        directionDistanceRef.current = 0;
      }
    },
    [setToolbarVisible],
  );

  const selectViewMode = (nextMode: 'series' | 'books') => {
    setViewMode(nextMode);
    lastScrollYRef.current = 0;
    directionDistanceRef.current = 0;
    setToolbarVisible(true);
  };

  const refreshSeriesPublication = async (seriesTitle: string, ownedLatestVolume?: number) => {
    if (refreshingSeriesTitle) return;
    setRefreshingSeriesTitle(seriesTitle);
    const representativeTarget = findRepresentativeRefreshTarget(books, seriesTitle);
    const refreshRepresentativeCover = representativeTarget
      ? repairBookMetadata(representativeTarget.id, { preserveIdentity: true }).catch((metadataError) => {
          console.warn('Failed to refresh representative cover', metadataError);
        })
      : Promise.resolve();

    try {
      const result = await lookupLatestSeriesPublication(seriesTitle);
      await refreshRepresentativeCover;
      if (!result) {
        Alert.alert('刊行巻数を取得できませんでした', '同じシリーズの巻数情報が見つかりませんでした。');
        return;
      }
      const safeResult = { ...result, latestVolume: Math.max(result.latestVolume, ownedLatestVolume ?? 0) };
      const cacheKey = normalizeSeriesKey(seriesTitle);
      setPublicationCache((current) => {
        const next = { ...current, [cacheKey]: safeResult };
        void AsyncStorage.setItem(SERIES_PUBLICATION_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    } catch (refreshError) {
      await refreshRepresentativeCover;
      Alert.alert(
        '更新できませんでした',
        refreshError instanceof Error ? refreshError.message : '通信状態を確認して、もう一度お試しください。',
      );
    } finally {
      setRefreshingSeriesTitle(null);
    }
  };

  const toggleSeriesFavorite = async (group: SeriesGroup) => {
    const seriesKey = normalizeSeriesKey(group.title);
    const nextFavorite = !favoriteSeriesKeySet.has(seriesKey);
    setVisibleFavoriteSeriesKeys((current) => {
      const withoutCurrent = current.filter((key) => key !== seriesKey);
      return nextFavorite ? [...withoutCurrent, seriesKey] : withoutCurrent;
    });
    setFavoriteSeries(group.title, nextFavorite);

    if (!user || !supabase) return;

    try {
      if (nextFavorite) {
        const { error: upsertError } = await supabase.from('favorite_series').upsert(
          {
            user_id: user.id,
            series_key: seriesKey,
            series_title: group.title,
            cover_url: group.representative.thumbnailUrl ?? null,
            owned_volume_count: group.ownedCount,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,series_key' },
        );
        if (upsertError) throw upsertError;
      } else {
        const { error: deleteError } = await supabase
          .from('favorite_series')
          .delete()
          .eq('user_id', user.id)
          .eq('series_key', seriesKey);
        if (deleteError) throw deleteError;
      }
    } catch (favoriteError) {
      console.warn(
        'Favorite was saved locally, but failed to sync to Supabase.',
        isMissingSupabaseRelationError(favoriteError) ? 'favorite_series is not available yet.' : favoriteError,
      );
    }
  };

  const toggleSeriesNotification = async (group: SeriesGroup) => {
    if (!newReleaseNotifications) {
      Alert.alert('新刊通知がOFFです', '設定画面で新刊通知をONにすると、シリーズごとに通知対象を選べます。');
      return;
    }
    if (!user) {
      Alert.alert('ログインが必要です', '新刊通知はログイン後に利用できます。');
      return;
    }

    const seriesKey = normalizeSeriesKey(group.title);
    const enabled = !notificationSeriesKeys.includes(seriesKey);
    setUpdatingNotificationSeriesKey(seriesKey);
    setNotificationSeriesKeys((current) =>
      enabled ? [...new Set([...current, seriesKey])] : current.filter((key) => key !== seriesKey),
    );
    try {
      await setNewReleaseSeriesSubscription(user.id, { latestVolume: group.latestVolume, seriesKey, seriesTitle: group.title }, enabled);
    } catch (notificationError) {
      setNotificationSeriesKeys((current) =>
        enabled ? current.filter((key) => key !== seriesKey) : [...new Set([...current, seriesKey])],
      );
      Alert.alert(
        'シリーズ通知を更新できませんでした',
        notificationError instanceof Error ? notificationError.message : '通信状態を確認してもう一度お試しください。',
      );
    } finally {
      setUpdatingNotificationSeriesKey(null);
    }
  };

  const closeMenu = () => setOpenMenu(null);
  const listTopPadding = toolbarHeight + 10;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <HomeToolbar
        translateY={toolbarTranslateY}
        viewMode={viewMode}
        seriesDisplayMode={seriesDisplayMode}
        visibleCount={viewMode === 'series' ? visibleGroups.length : visibleBooks.length}
        totalCount={viewMode === 'series' ? seriesGroups.length : books.length}
        requiresAuth={requiresAuth}
        loading={loading}
        error={error}
        query={query}
        filterLabel={selectedFilterLabel}
        sortLabel={selectedSortLabel}
        onHeightChange={(nextHeight) => {
          if (nextHeight === toolbarHeight) return;
          setToolbarHeight(nextHeight);
          if (!toolbarVisibleRef.current) toolbarTranslateY.setValue(-nextHeight);
        }}
        onQueryChange={setQuery}
        onSeriesDisplayModeChange={() => setSeriesDisplayMode((current) => getNextSeriesDisplayMode(current))}
        onViewModeChange={selectViewMode}
        onOpenMyPage={() => router.navigate({ pathname: '/(tabs)/account', params: { from: 'home' } })}
        onOpenFilter={() => setOpenMenu('filter')}
        onOpenSort={() => setOpenMenu('sort')}
      />

      {viewMode === 'series' ? (
        <FlatList
          key={`series-${seriesDisplayMode}-${seriesDisplayMode === 'cover' ? coverGridColumns : 1}`}
          ref={seriesListRef}
          style={styles.list}
          data={visibleGroups}
          extraData={`${listVersion}-${seriesDisplayMode}-${coverTileWidth}-${visibleFavoriteSeriesKeys.join(',')}-${refreshingSeriesTitle}-${showPublishedLatestVolume}-${notificationSeriesKeys.join(',')}-${updatingNotificationSeriesKey}`}
          keyExtractor={(item) => item.id}
          numColumns={seriesDisplayMode === 'cover' ? coverGridColumns : 1}
          columnWrapperStyle={seriesDisplayMode === 'cover' ? styles.coverGridRow : undefined}
          contentContainerStyle={[
            seriesDisplayMode === 'cover' ? styles.coverGrid : styles.grid,
            { paddingTop: listTopPadding },
          ]}
          showsVerticalScrollIndicator={false}
          refreshing={loading}
          onRefresh={refreshLibrary}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          renderItem={({ item }) => {
            const cacheKey = normalizeSeriesKey(item.title);
            const stats = seriesStats.get(cacheKey);
            const publicationInfo = publicationCache[cacheKey];
            if (seriesDisplayMode === 'cover') {
              return (
                <Pressable
                  accessibilityLabel={`${item.title}の詳細を開く`}
                  onPress={() => router.navigate(`/(tabs)/series/${encodeURIComponent(item.title)}`)}
                  style={[styles.coverTile, { width: coverTileWidth }]}
                >
                  <BookCover
                    thumbnailUrl={item.representative.thumbnailUrl}
                    isbn={item.representative.isbn}
                    style={styles.coverTileImage}
                  />
                </Pressable>
              );
            }
            if (seriesDisplayMode === 'title') {
              return (
                <View style={[styles.titleRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Pressable
                    accessibilityLabel={`${item.title}の詳細を開く`}
                    onPress={() => router.navigate(`/(tabs)/series/${encodeURIComponent(item.title)}`)}
                    style={styles.titleRowBody}
                  >
                    <Text numberOfLines={1} style={[styles.titleRowText, { color: colors.text }]}>
                      {item.title}
                    </Text>
                    <Text numberOfLines={1} style={[styles.titleRowMeta, { color: colors.muted }]}>
                      {item.ownedCount}冊所持
                      {item.latestVolume ? ` / ${item.latestVolume}巻まで` : ''}
                      {(stats?.missingVolumes.length ?? 0) > 0 ? ` / 不足 ${stats?.missingVolumes.length}` : ''}
                    </Text>
                  </Pressable>
                  <View style={styles.titleRowActions}>
                    <TouchableOpacity
                      accessibilityLabel={favoriteSeriesKeySet.has(cacheKey) ? `${item.title}のお気に入りを解除` : `${item.title}をお気に入りに追加`}
                      activeOpacity={0.75}
                      onPress={() => void toggleSeriesFavorite(item)}
                      style={[styles.titleIconButton, { borderColor: colors.border }]}
                    >
                      <Ionicons
                        color={favoriteSeriesKeySet.has(cacheKey) ? colors.primary : colors.muted}
                        name={favoriteSeriesKeySet.has(cacheKey) ? 'bookmark' : 'bookmark-outline'}
                        size={17}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                        accessibilityLabel={`${item.title}の刊行情報を更新`}
                        activeOpacity={0.75}
                        disabled={refreshingSeriesTitle !== null}
                        onPress={() => void refreshSeriesPublication(item.title, item.latestVolume)}
                        style={[
                          styles.titleIconButton,
                          { borderColor: colors.border },
                          refreshingSeriesTitle !== null && styles.disabledButton,
                        ]}
                      >
                        {refreshingSeriesTitle === item.title ? (
                          <ActivityIndicator color={colors.text} size="small" />
                        ) : (
                          <Ionicons color={colors.text} name="refresh" size={16} />
                        )}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }
            return (
              <SeriesCard
                key={item.id}
                group={item}
                missingVolumes={stats?.internalMissingVolumes ?? []}
                unownedVolumes={showPublishedLatestVolume ? stats?.trailingUnownedVolumes ?? [] : []}
                completionRate={stats?.completionRate ?? 100}
                favorite={favoriteSeriesKeySet.has(cacheKey)}
                showPublishedLatestVolume={showPublishedLatestVolume}
                publicationInfo={publicationInfo}
                refreshing={refreshingSeriesTitle === item.title}
                refreshDisabled={refreshingSeriesTitle !== null}
                notificationAvailable={Boolean(user && newReleaseNotifications)}
                notificationEnabled={newReleaseNotifications && notificationSeriesKeys.includes(cacheKey)}
                notificationUpdating={updatingNotificationSeriesKey === cacheKey}
                onToggleFavorite={() => void toggleSeriesFavorite(item)}
                onToggleNotification={() => void toggleSeriesNotification(item)}
                onRefresh={() => void refreshSeriesPublication(item.title, item.latestVolume)}
              />
            );
          }}
          ListEmptyComponent={!loading ? <EmptyLibraryState requiresAuth={requiresAuth} libraryIsEmpty={books.length === 0} /> : null}
        />
      ) : (
        <FlatList
          key="books-list"
          ref={booksListRef}
          style={styles.list}
          data={visibleBooks}
          extraData={listVersion}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.bookList, { paddingTop: listTopPadding }]}
          refreshing={loading}
          onRefresh={refreshLibrary}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          renderItem={({ item }) => <BookRow book={item} />}
          ListEmptyComponent={!loading ? <EmptyLibraryState requiresAuth={requiresAuth} libraryIsEmpty={books.length === 0} /> : null}
        />
      )}

      <OptionSheet
        visible={openMenu !== null}
        title={
          openMenu === 'sort'
            ? '並び替え'
            : openMenu === 'author'
              ? '作者で絞る'
              : openMenu === 'publisher'
                ? '出版社で絞る'
                : '表示条件'
        }
        options={
          openMenu === 'sort'
            ? viewMode === 'series'
              ? seriesSortOptions
              : bookSortOptions
            : openMenu === 'author'
              ? [{ label: '作者指定を解除', value: 'all' }, ...metadataFilterOptions.authors]
              : openMenu === 'publisher'
                ? [{ label: '出版社指定を解除', value: 'all' }, ...metadataFilterOptions.publishers]
                : filterCategoryOptions
        }
        multiple={openMenu !== 'sort'}
        selectedValue={openMenu === 'sort' ? (viewMode === 'series' ? seriesSort : bookSort) : undefined}
        selectedValues={
          openMenu === 'sort'
            ? undefined
            : openMenu === 'author'
              ? selectedMetadataFilters.authors.length > 0
                ? selectedMetadataFilters.authors.map((author) => `author:${encodeURIComponent(author)}`)
                : ['all']
              : openMenu === 'publisher'
                ? selectedMetadataFilters.publishers.length > 0
                  ? selectedMetadataFilters.publishers.map((publisher) => `publisher:${encodeURIComponent(publisher)}`)
                  : ['all']
                : [
                    ...getActiveFilters(filters).filter(
                      (filter) => !filter.startsWith('author:') && !filter.startsWith('publisher:'),
                    ),
                    ...(selectedMetadataFilters.authors.length > 0 ? ['select-author'] : []),
                    ...(selectedMetadataFilters.publishers.length > 0 ? ['select-publisher'] : []),
                  ].length > 0
                  ? [
                      ...getActiveFilters(filters).filter(
                        (filter) => !filter.startsWith('author:') && !filter.startsWith('publisher:'),
                      ),
                      ...(selectedMetadataFilters.authors.length > 0 ? ['select-author'] : []),
                      ...(selectedMetadataFilters.publishers.length > 0 ? ['select-publisher'] : []),
                    ]
                  : ['all']
        }
        onBack={openMenu === 'author' || openMenu === 'publisher' ? () => setOpenMenu('filter') : undefined}
        onApply={closeMenu}
        onSelect={(value) => {
          if (openMenu === 'sort') {
            if (viewMode === 'series') setSeriesSort(value as SeriesSort);
            else setBookSort(value as BookSort);
            closeMenu();
          } else if (openMenu === 'filter' && value === 'select-author') {
            setOpenMenu('author');
          } else if (openMenu === 'filter' && value === 'select-publisher') {
            setOpenMenu('publisher');
          } else if (openMenu === 'author' && value === 'all') {
            setFilters((current) => removeFilterGroup(current, 'author:'));
          } else if (openMenu === 'publisher' && value === 'all') {
            setFilters((current) => removeFilterGroup(current, 'publisher:'));
          } else {
            setFilters((current) => toggleFilterValue(current, value as HomeFilter));
          }
        }}
        onClose={closeMenu}
        variant={openMenu === 'sort' ? 'list' : 'check'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { flex: 1 },
  grid: { paddingBottom: 110, paddingHorizontal: 18 },
  coverGrid: { paddingBottom: 110, paddingHorizontal: 18 },
  coverGridRow: { gap: 10 },
  coverTile: {
    alignItems: 'center',
    marginBottom: 14,
  },
  coverTileImage: {
    aspectRatio: 0.68,
    borderRadius: 5,
    width: '100%',
  },
  bookList: { paddingBottom: 110, paddingHorizontal: 18 },
  titleRow: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  titleRowBody: { flex: 1, minWidth: 0 },
  titleRowText: { fontSize: 15, fontWeight: '800', lineHeight: 20 },
  titleRowMeta: { fontSize: 12, marginTop: 2 },
  titleRowActions: { flexDirection: 'row', gap: 6 },
  titleIconButton: {
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 34,
  },
  disabledButton: { opacity: 0.4 },
});

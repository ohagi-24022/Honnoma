import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BookCover } from '../../src/components/BookCover';
import { buildPurchaseUrl, lookupBookByTitle, SeriesPublicationInfo } from '../../src/lib/bookApis';
import { migrateNewReleaseSeriesSubscription } from '../../src/lib/newReleaseNotifications';
import { normalizeSeriesKey } from '../../src/lib/series';
import {
  loadSeriesMetadata,
  mergeSeriesPublicationInfo,
  SeriesMetadataOverride,
} from '../../src/lib/seriesMetadata';
import { useAppSettings } from '../../src/store/AppSettingsContext';
import { useAuth } from '../../src/store/AuthContext';
import { useLibrary } from '../../src/store/LibraryContext';
import { useAppTheme } from '../../src/store/ThemeContext';
import { useWishlist } from '../../src/store/WishlistContext';
import { Book, BookInput, MissingBook, ReadingStatus, ShelfItem } from '../../src/types';

const PAGE_SIZE = 10;
const SERIES_PUBLICATION_STORAGE_KEY = 'booknest.series-publication.v1';
const MISSING_VOLUME_QUEUE_INTERVAL_MS = 6500;

const statusLabels: Record<ReadingStatus, string> = {
  unread: '未読',
  reading: '読書中',
  read: '読了',
};

function isOwnedBook(item: ShelfItem): item is Book {
  return !item.isMissing;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compareSeriesItems(left: ShelfItem, right: ShelfItem) {
  const leftExtra = isOwnedBook(left) && left.volumeKind === 'extra';
  const rightExtra = isOwnedBook(right) && right.volumeKind === 'extra';
  if (leftExtra !== rightExtra) return leftExtra ? 1 : -1;
  return (left.volumeNumber ?? 0) - (right.volumeNumber ?? 0) || left.createdAt.localeCompare(right.createdAt);
}

export default function SeriesScreen() {
  const params = useLocalSearchParams<{ title: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const seriesTitle = decodeURIComponent(params.title ?? '');
  const { user } = useAuth();
  const { addBook, getSeriesItems, bulkUpdateStatus, updateBook, renameSeries, deleteBook, repairBookMetadata } =
    useLibrary();
  const { addItem: addWishlistItem } = useWishlist();
  const { isFavoriteSeries, migrateFavoriteSeries, openExternalPurchaseLinks, setFavoriteSeries, trackPurchasePrices } =
    useAppSettings();
  const { colors } = useAppTheme();
  const listRef = useRef<FlatList<ShelfItem>>(null);
  const shouldKeepBottomRef = useRef(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [draftSeries, setDraftSeries] = useState('');
  const [draftVolume, setDraftVolume] = useState('');
  const [draftVolumeKind, setDraftVolumeKind] = useState<'main' | 'extra'>('main');
  const [draftPurchasePrice, setDraftPurchasePrice] = useState('');
  const [bulkPurchasePrice, setBulkPurchasePrice] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftSeriesTitle, setDraftSeriesTitle] = useState(seriesTitle);
  const [publicationInfo, setPublicationInfo] = useState<SeriesPublicationInfo | null>(null);
  const [seriesMetadata, setSeriesMetadata] = useState<SeriesMetadataOverride | null>(null);
  const [bulkFillOpen, setBulkFillOpen] = useState(false);
  const [bulkFillTargetVolume, setBulkFillTargetVolume] = useState('');
  const [bulkFillRunning, setBulkFillRunning] = useState(false);
  const [bulkFillProgress, setBulkFillProgress] = useState<{ current: number; total: number } | null>(null);

  const baseItems = useMemo(() => getSeriesItems(seriesTitle), [getSeriesItems, seriesTitle]);
  const effectivePublicationInfo = useMemo(
    () => mergeSeriesPublicationInfo(publicationInfo, seriesMetadata ?? undefined) ?? null,
    [publicationInfo, seriesMetadata],
  );
  const items = useMemo(() => {
    if (!effectivePublicationInfo?.latestVolume) return baseItems;

    const existingVolumes = new Set(
      baseItems
        .filter((item) => item.isMissing || item.volumeKind !== 'extra')
        .map((item) => item.volumeNumber)
        .filter((volume): volume is number => typeof volume === 'number'),
    );
    const ownedVolumes = baseItems
      .filter((item) => isOwnedBook(item) && item.volumeKind !== 'extra')
      .map((item) => item.volumeNumber)
      .filter((volume): volume is number => typeof volume === 'number');
    const ownedLatestVolume = ownedVolumes.length > 0 ? Math.max(...ownedVolumes) : 0;
    const createdAt = new Date().toISOString();
    const trailingMissing: MissingBook[] = [];

    for (let volume = ownedLatestVolume + 1; volume <= effectivePublicationInfo.latestVolume; volume += 1) {
      if (existingVolumes.has(volume)) continue;
      trailingMissing.push({
        id: `missing-published-${seriesTitle}-${volume}`,
        userId: user?.id ?? 'local-user',
        title: `${seriesTitle} ${volume}`,
        seriesTitle,
        volumeNumber: volume,
        status: 'missing',
        createdAt,
        isMissing: true,
      });
    }

    return [...baseItems, ...trailingMissing].sort(compareSeriesItems);
  }, [baseItems, effectivePublicationInfo, seriesTitle, user?.id]);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pageItems = useMemo(() => items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [items, page]);
  const ownedItems = useMemo(() => items.filter(isOwnedBook), [items]);
  const missingItems = useMemo(() => items.filter((item) => item.isMissing), [items]);
  const readCount = ownedItems.filter((item) => item.status === 'read').length;
  const readingCount = ownedItems.filter((item) => item.status === 'reading').length;
  const unreadCount = ownedItems.filter((item) => item.status === 'unread').length;
  const readPercent = ownedItems.length > 0 ? Math.round((readCount / ownedItems.length) * 100) : 0;
  const pageVolumes = pageItems
    .map((item) => item.volumeNumber)
    .filter((volume): volume is number => typeof volume === 'number');
  const pageRangeLabel =
    pageVolumes.length > 0 ? `${Math.min(...pageVolumes)}〜${Math.max(...pageVolumes)}巻` : `${page}ページ目`;
  const selectedCount = selectedIds.length;
  const allSelected = ownedItems.length > 0 && selectedCount === ownedItems.length;
  const favorite = isFavoriteSeries(seriesTitle);
  const latestKnownMainVolume = Math.max(
    0,
    ...items
      .filter((item) => !item.isMissing && item.volumeKind !== 'extra')
      .map((item) => item.volumeNumber)
      .filter((volume): volume is number => typeof volume === 'number'),
    effectivePublicationInfo?.latestVolume ?? 0,
  );
  const bulkFillTarget = Number.parseInt(bulkFillTargetVolume.replace(/[^0-9]/g, ''), 10);
  const bulkFillMissingTargets = items
    .filter((item): item is MissingBook => item.isMissing === true)
    .filter((item) => typeof item.volumeNumber === 'number' && item.volumeNumber <= (Number.isFinite(bulkFillTarget) ? bulkFillTarget : 0))
    .sort(compareSeriesItems);
  const resetSeriesView = useCallback((animated = false) => {
    shouldKeepBottomRef.current = false;
    setPage(1);
    setSelectedIds([]);
    setEditingId(null);
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated });
    });
  }, []);
  const goBackToShelf = useCallback(() => {
    if (navigation.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)');
  }, [navigation, router]);
  useLayoutEffect(() => {
    navigation.setOptions({
      title: seriesTitle,
      headerLeft: () => (
        <Pressable
          accessibilityLabel="本棚に戻る"
          hitSlop={10}
          onPress={goBackToShelf}
          style={styles.headerBackButton}
        >
          <Ionicons color={colors.text} name="chevron-back" size={24} />
          <Text style={[styles.headerBackText, { color: colors.text }]}>戻る</Text>
        </Pressable>
      ),
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel="シリーズ情報の違いを報告"
            hitSlop={10}
            onPress={() => router.navigate({ pathname: '/report', params: { series: seriesTitle, reason: 'publication', from: 'series' } })}
            style={styles.headerReportButton}
          >
            <Ionicons color={colors.muted} name="flag-outline" size={17} />
          </Pressable>
          <Pressable
            accessibilityLabel={favorite ? 'お気に入りを解除' : 'お気に入りに追加'}
            hitSlop={10}
            onPress={() => setFavoriteSeries(seriesTitle, !favorite)}
            style={styles.headerFavoriteButton}
          >
            <Ionicons
              color={favorite ? colors.primary : colors.muted}
              name={favorite ? 'bookmark' : 'bookmark-outline'}
              size={21}
            />
          </Pressable>
        </View>
      ),
    });
  }, [colors.muted, colors.primary, colors.text, favorite, goBackToShelf, navigation, router, seriesTitle, setFavoriteSeries]);

  useEffect(() => {
    resetSeriesView(false);
  }, [resetSeriesView, seriesTitle]);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(SERIES_PUBLICATION_STORAGE_KEY)
      .then((storedCache) => {
        if (cancelled || !storedCache) {
          if (!cancelled) setPublicationInfo(null);
          return;
        }
        const cache = JSON.parse(storedCache) as Record<string, SeriesPublicationInfo>;
        setPublicationInfo(cache[normalizeSeriesKey(seriesTitle)] ?? null);
      })
      .catch(() => {
        if (!cancelled) setPublicationInfo(null);
      });

    return () => {
      cancelled = true;
    };
  }, [seriesTitle]);

  useEffect(() => {
    let cancelled = false;
    loadSeriesMetadata(user?.id)
      .then((metadata) => {
        if (cancelled) return;
        const override = metadata[normalizeSeriesKey(seriesTitle)] ?? null;
        setSeriesMetadata(override);
      })
      .catch((metadataError) => console.warn('Failed to load series metadata override', metadataError));
    return () => {
      cancelled = true;
    };
  }, [seriesTitle, user?.id]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const changePageFromBottom = (nextPage: number) => {
    shouldKeepBottomRef.current = true;
    setPage(nextPage);
  };

  const toggleSelected = (item: ShelfItem) => {
    if (!isOwnedBook(item)) return;
    setSelectedIds((current) =>
      current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id],
    );
  };

  const closeInlineEdit = () => {
    setEditingId(null);
    setDraftSeries('');
    setDraftVolume('');
    setDraftVolumeKind('main');
    setDraftPurchasePrice('');
  };

  const handleRowPress = (item: ShelfItem) => {
    if (editingId) {
      closeInlineEdit();
      return;
    }
    if (item.isMissing) {
      void addMissingAsOwned(item);
      return;
    }
    toggleSelected(item);
  };

  const openPurchaseCandidates = async (item: ShelfItem) => {
    const purchaseUrl = buildPurchaseUrl(item.seriesTitle, item.volumeNumber);
    if (openExternalPurchaseLinks) {
      await Linking.openURL(purchaseUrl);
    } else {
      await WebBrowser.openBrowserAsync(purchaseUrl);
    }
  };

  const addMissingAsOwned = async (item: ShelfItem) => {
    if (isOwnedBook(item) || refreshingId) return;
    setRefreshingId(item.id);
    try {
      const metadata = await lookupBookByTitle(`${item.seriesTitle} ${item.volumeNumber}巻`);
      const metadataMatchesExpected =
        !!metadata &&
        metadata.volumeNumber === item.volumeNumber &&
        normalizeSeriesKey(metadata.seriesTitle || item.seriesTitle) === normalizeSeriesKey(item.seriesTitle);
      const trustedMetadata = metadataMatchesExpected ? metadata : null;
      const bookInput: BookInput = {
        isbn: trustedMetadata?.isbn,
        title: trustedMetadata?.title ?? item.title,
        seriesTitle: item.seriesTitle,
        volumeNumber: item.volumeNumber,
        volumeKind: 'main',
        author: trustedMetadata?.author,
        publisher: trustedMetadata?.publisher,
        thumbnailUrl: trustedMetadata?.thumbnailUrl,
        status: 'unread',
      };

      try {
        await addBook(bookInput);
      } catch (addError) {
        if (!bookInput.isbn || !(addError instanceof Error) || !/ISBN|登録済|already/i.test(addError.message)) {
          throw addError;
        }
        await addBook({ ...bookInput, isbn: undefined });
      }
    } catch (error) {
      Alert.alert('追加できませんでした', error instanceof Error ? error.message : 'もう一度お試しください。');
    } finally {
      setRefreshingId(null);
    }
  };

  const addMissingVolumesAsOwnedQueue = async () => {
    const targetVolume = Number.parseInt(bulkFillTargetVolume.replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(targetVolume) || targetVolume <= 0) {
      Alert.alert('追加する範囲を入力してください', '「何巻まで所持しているか」を数字で入力してください。');
      return;
    }

    const targets = bulkFillMissingTargets;
    if (targets.length === 0) {
      Alert.alert('追加対象がありません', '指定した範囲内に未登録の通常巻はありません。');
      return;
    }

    setBulkFillRunning(true);
    setBulkFillProgress({ current: 0, total: targets.length });
    let addedCount = 0;
    let skippedCount = 0;
    try {
      for (const [index, item] of targets.entries()) {
        setBulkFillProgress({ current: index + 1, total: targets.length });
        const metadata = await lookupBookByTitle(`${item.seriesTitle} ${item.volumeNumber}巻`);
        const metadataMatchesExpected =
          !!metadata &&
          metadata.volumeNumber === item.volumeNumber &&
          normalizeSeriesKey(metadata.seriesTitle || item.seriesTitle) === normalizeSeriesKey(item.seriesTitle);
        const trustedMetadata = metadataMatchesExpected ? metadata : null;
        const bookInput: BookInput = {
          isbn: trustedMetadata?.isbn,
          title: trustedMetadata?.title ?? item.title,
          seriesTitle: item.seriesTitle,
          volumeNumber: item.volumeNumber,
          volumeKind: 'main',
          author: trustedMetadata?.author,
          publisher: trustedMetadata?.publisher,
          publishedDate: trustedMetadata?.publishedDate,
          thumbnailUrl: trustedMetadata?.thumbnailUrl,
          listPrice: trustedMetadata?.listPrice,
          priceSource: trustedMetadata?.priceSource,
          priceFetchedAt: trustedMetadata?.priceFetchedAt,
          status: 'unread',
        };

        try {
          await addBook(bookInput);
          addedCount += 1;
        } catch (addError) {
          const addErrorMessage = addError instanceof Error ? addError.message : '';
          if (bookInput.isbn && /ISBN|already/i.test(addErrorMessage)) {
            await addBook({ ...bookInput, isbn: undefined });
            addedCount += 1;
          } else if (addErrorMessage.includes('同じシリーズ') || addErrorMessage.includes('登録') || /already/i.test(addErrorMessage)) {
            skippedCount += 1;
          } else {
            throw addError;
          }
        }

        if (index < targets.length - 1) {
          await wait(MISSING_VOLUME_QUEUE_INTERVAL_MS);
        }
      }

      setBulkFillOpen(false);
      setBulkFillTargetVolume('');
      Alert.alert(
        '未登録巻を追加しました',
        skippedCount > 0
          ? `${addedCount}冊を追加しました。${skippedCount}冊は登録済みのためスキップしました。`
          : `${addedCount}冊を追加しました。`,
      );
    } catch (error) {
      Alert.alert('未登録巻を追加しました', error instanceof Error ? error.message : '??????????????????????');
    } finally {
      setBulkFillRunning(false);
      setBulkFillProgress(null);
    }
  };

  const addMissingToWishlist = (item: ShelfItem) => {
    addWishlistItem({
      title: item.volumeNumber ? `${item.seriesTitle} ${item.volumeNumber}巻` : item.title,
      score: 75,
      coverUrl: item.thumbnailUrl,
      note: '巻抜けから追加',
      purchaseUrl: buildPurchaseUrl(item.seriesTitle, item.volumeNumber),
    });
    Alert.alert('欲しいリストに追加しました', `${item.title}を購入候補として保存しました。`);
  };

  const updateSelected = async (status: ReadingStatus) => {
    try {
      await bulkUpdateStatus(selectedIds, status);
      setSelectedIds([]);
    } catch (error) {
      Alert.alert('本の間', error instanceof Error ? error.message : '更新に失敗しました。');
    }
  };

  const updateSelectedPurchasePrice = async () => {
    const selected = new Set(selectedIds);
    const normalizedPrice = bulkPurchasePrice.replace(/[^0-9]/g, '');
    const nextPrice = normalizedPrice ? Number.parseInt(normalizedPrice, 10) : null;
    const targets = ownedItems.filter((book) => selected.has(book.id));
    if (targets.length === 0) return;

    try {
      await Promise.all(targets.map((book) => updateBook(book.id, { purchasePrice: nextPrice })));
      setBulkPurchasePrice('');
      setSelectedIds([]);
      Alert.alert('購入価格を更新しました', `${targets.length}冊の購入価格を${nextPrice === null ? '未設定' : `¥${nextPrice.toLocaleString('ja-JP')}`}にしました。`);
    } catch (error) {
      Alert.alert('本の間', error instanceof Error ? error.message : '購入価格の更新に失敗しました。');
    }
  };

  const toggleAllSelected = () => {
    setSelectedIds(allSelected ? [] : ownedItems.map((book) => book.id));
  };

  const startEditing = (book: Book) => {
    setEditingId(book.id);
    setDraftSeries(book.seriesTitle);
    setDraftVolume(book.volumeNumber ? String(book.volumeNumber) : '');
    setDraftVolumeKind(book.volumeKind ?? 'main');
    setDraftPurchasePrice(typeof book.purchasePrice === 'number' ? String(book.purchasePrice) : '');
  };

  const submitEdit = async (book: Book) => {
    try {
      const normalizedPrice = draftPurchasePrice.replace(/[^0-9]/g, '');
      await updateBook(book.id, {
        seriesTitle: draftSeries.trim() || book.seriesTitle,
        volumeNumber: draftVolume ? Number.parseInt(draftVolume, 10) : undefined,
        volumeKind: draftVolumeKind,
        ...(trackPurchasePrices
          ? { purchasePrice: normalizedPrice ? Number.parseInt(normalizedPrice, 10) : null }
          : {}),
      });
      setEditingId(null);
    } catch (error) {
      Alert.alert('本の間', error instanceof Error ? error.message : '保存に失敗しました。');
    }
  };

  const submitSeriesRename = async () => {
    try {
      const nextTitle = draftSeriesTitle.trim();
      const updatedCount = await renameSeries(seriesTitle, nextTitle);
      migrateFavoriteSeries(seriesTitle, nextTitle);
      if (user) {
        const latestVolume = ownedItems
          .filter((item) => item.volumeKind !== 'extra')
          .map((item) => item.volumeNumber)
          .filter((volume): volume is number => typeof volume === 'number')
          .sort((left, right) => right - left)[0];
        try {
          await migrateNewReleaseSeriesSubscription(user.id, seriesTitle, nextTitle, latestVolume);
        } catch (subscriptionError) {
          console.warn(
            'Failed to migrate new release subscription after series rename.',
            subscriptionError instanceof Error ? subscriptionError.message : subscriptionError,
          );
        }
      }
      setRenameOpen(false);
      Alert.alert('シリーズ名を更新しました', `${updatedCount}冊を「${nextTitle}」へ移しました。`);
      router.replace(`/series/${encodeURIComponent(nextTitle)}`);
    } catch (error) {
      Alert.alert('本の間', error instanceof Error ? error.message : 'シリーズ名の更新に失敗しました。');
    }
  };

  const confirmDelete = (book: Book) => {
    Alert.alert('本の間', `${book.title} を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteBook(book.id);
            setSelectedIds((current) => current.filter((id) => id !== book.id));
          } catch (error) {
            Alert.alert('本の間', error instanceof Error ? error.message : '削除に失敗しました。');
          }
        },
      },
    ]);
  };

  const refreshMetadata = async (book: Book) => {
    if (refreshingId) return;
    setRefreshingId(book.id);
    try {
      const result = await repairBookMetadata(book.id, { updatePurchasePrice: trackPurchasePrices });
      const beforeCover = result.beforeThumbnailUrl ? 'あり' : 'なし';
      const afterCover = result.afterThumbnailUrl ? 'あり' : 'なし';
      const formatPrice = (price?: number | null) =>
        typeof price === 'number' ? `¥${price.toLocaleString('ja-JP')}` : '未設定';
      const purchasePriceSummary = result.purchasePriceLookupAttempted
        ? result.purchasePriceUpdated
          ? `購入価格: ${formatPrice(result.beforePurchasePrice)} → ${formatPrice(result.afterPurchasePrice)}`
          : typeof result.afterPurchasePrice === 'number'
            ? `購入価格: ${formatPrice(result.afterPurchasePrice)}（維持）`
            : '購入価格: 未取得'
        : null;
      if (!__DEV__) {
        Alert.alert(
          '書籍情報を更新しました',
          [`表紙: ${beforeCover} → ${afterCover}`, `出版社: ${result.publisher ?? '未取得'}`, purchasePriceSummary]
            .filter(Boolean)
            .join('\n'),
        );
        return;
      }
      Alert.alert(
        '再取得デバッグ',
        [
          `対象: ${book.title}`,
          `検索語: ${result.lookupTitle}`,
          `取得タイトル: ${result.title}`,
          `シリーズ: ${result.seriesTitle ?? 'なし'}`,
          `巻数: ${result.volumeNumber ?? 'なし'}`,
          `出版社: ${result.publisher ?? 'なし'}`,
          purchasePriceSummary,
          `表紙: ${beforeCover} → ${afterCover}`,
          result.afterThumbnailUrl ? `表紙URL: ${result.afterThumbnailUrl}` : '表紙URL: なし',
          ...(result.debugEntries?.length
            ? [
                '',
                'API候補:',
                ...result.debugEntries.map((entry, index) =>
                  [
                    `${index + 1}. ${entry.provider} / ${entry.status}`,
                    `検索: ${entry.query}`,
                    entry.title ? `題名: ${entry.title}` : undefined,
                    entry.volumeNumber ? `巻数: ${entry.volumeNumber}` : undefined,
                    entry.coverUrl ? '表紙URL: あり' : '表紙URL: なし',
                    entry.reason ? `理由: ${entry.reason}` : undefined,
                  ]
                    .filter(Boolean)
                    .join(' / '),
                ),
              ]
            : []),
        ].join('\n'),
      );
    } catch (error) {
      Alert.alert('本の間', error instanceof Error ? error.message : '再取得に失敗しました。');
    } finally {
      setRefreshingId(null);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.bulkBar, { borderBottomColor: colors.border }]}>
        <Text style={[styles.bulkText, { color: colors.muted }]}>{selectedCount}冊選択中</Text>
        <Pressable
          accessibilityLabel="シリーズ名を変更"
          onPress={() => {
            setDraftSeriesTitle(seriesTitle);
            setRenameOpen((current) => !current);
          }}
          style={[styles.iconActionButton, { borderColor: colors.border }]}
        >
          <Ionicons color={colors.text} name="create-outline" size={19} />
        </Pressable>
        <Pressable
          accessibilityLabel="未登録巻をまとめて追加"
          disabled={bulkFillRunning}
          onPress={() => {
            setBulkFillTargetVolume((current) => current || (latestKnownMainVolume > 0 ? String(latestKnownMainVolume) : ''));
            setBulkFillOpen((current) => !current);
          }}
          style={[styles.bulkFillShortcutButton, { borderColor: colors.border }, bulkFillRunning && styles.disabledButton]}
        >
          {bulkFillRunning ? (
            <ActivityIndicator color={colors.text} size="small" />
          ) : (
            <Ionicons color={colors.text} name="albums-outline" size={17} />
          )}
          <Text style={[styles.bulkFillShortcutLabel, { color: colors.text }]}>未登録巻を追加</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={allSelected ? '選択をすべて解除' : '全巻を選択'}
          disabled={ownedItems.length === 0}
          onPress={toggleAllSelected}
          style={[styles.iconActionButton, { borderColor: colors.border }, ownedItems.length === 0 && styles.disabledButton]}
        >
          <Ionicons color={colors.text} name={allSelected ? 'close-circle-outline' : 'checkbox-outline'} size={19} />
        </Pressable>
      </View>

      <View style={[styles.statusSlot, { borderBottomColor: colors.border }]}>
        {selectedCount > 0 ? (
          <View style={[styles.statusBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Pressable
              accessibilityLabel="選択した本を未読にする"
              onPress={() => updateSelected('unread')}
              style={[styles.statusTextButton, { borderColor: colors.border }]}
            >
              <Text style={[styles.statusTextButtonLabel, { color: colors.text }]}>未読にする</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="選択した本を読書中にする"
              onPress={() => updateSelected('reading')}
              style={[styles.statusTextButton, { borderColor: colors.border }]}
            >
              <Text style={[styles.statusTextButtonLabel, { color: colors.text }]}>読書中にする</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="選択した本を読了にする"
              onPress={() => updateSelected('read')}
              style={[styles.statusTextButton, { backgroundColor: colors.success, borderColor: colors.success }]}
            >
              <Text style={[styles.statusTextButtonLabel, { color: '#ffffff' }]}>読了にする</Text>
            </Pressable>
            {trackPurchasePrices && (
              <View style={styles.bulkPriceRow}>
                <TextInput
                  keyboardType="number-pad"
                  onChangeText={(value) => setBulkPurchasePrice(value.replace(/[^0-9]/g, ''))}
                  placeholder="中古価格"
                  placeholderTextColor={colors.muted}
                  style={[styles.bulkPriceInput, { backgroundColor: colors.input, color: colors.text }]}
                  value={bulkPurchasePrice}
                />
                <Pressable
                  accessibilityLabel="選択した本の購入価格を一括設定"
                  onPress={() => void updateSelectedPurchasePrice()}
                  style={[styles.statusTextButton, { borderColor: colors.border }]}
                >
                  <Text style={[styles.statusTextButtonLabel, { color: colors.text }]}>価格設定</Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : (
          <Text style={[styles.statusHint, { color: colors.muted }]}>
            本を選択するとステータスをまとめて変更できます
          </Text>
        )}
      </View>

      {renameOpen && (
        <View style={[styles.renameBox, { borderBottomColor: colors.border }]}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>シリーズ名の一括変更</Text>
          <Text style={[styles.renameCopy, { color: colors.muted }]}>
            既存のシリーズ名を入力すると、そのシリーズへ統合します。
          </Text>
          <View style={styles.renameRow}>
            <TextInput
              value={draftSeriesTitle}
              onChangeText={setDraftSeriesTitle}
              placeholder="シリーズ名"
              placeholderTextColor={colors.muted}
              style={[styles.renameInput, { backgroundColor: colors.input, color: colors.text }]}
            />
            <Pressable
              accessibilityLabel="シリーズ名の変更を反映"
              onPress={() => void submitSeriesRename()}
              style={[styles.saveIconButton, { backgroundColor: colors.text }]}
            >
              <Ionicons color={colors.background} name="checkmark" size={20} />
            </Pressable>
          </View>
        </View>
      )}

      {bulkFillOpen && (
        <View style={[styles.bulkFillBox, { borderBottomColor: colors.border }]}>
          <View style={styles.bulkFillHeader}>
            <View style={styles.bulkFillTitleWrap}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>未登録巻をまとめて追加</Text>
              <Text style={[styles.renameCopy, { color: colors.muted }]}>
                指定した巻までの未登録巻を、1冊ずつ順番に取得して追加します。APIを一気に呼ばないため、初回登録向けです。
              </Text>
            </View>
            <Pressable
              accessibilityLabel="一括追加パネルを閉じる"
              disabled={bulkFillRunning}
              onPress={() => setBulkFillOpen(false)}
              style={[styles.smallIconButton, { borderColor: colors.border }, bulkFillRunning && styles.disabledButton]}
            >
              <Ionicons color={colors.text} name="close" size={18} />
            </Pressable>
          </View>
          <View style={styles.renameRow}>
            <TextInput
              value={bulkFillTargetVolume}
              onChangeText={(value) => setBulkFillTargetVolume(value.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder={latestKnownMainVolume > 0 ? `${latestKnownMainVolume}巻まで` : '何巻まで'}
              placeholderTextColor={colors.muted}
              style={[styles.renameInput, { backgroundColor: colors.input, color: colors.text }]}
            />
            <Pressable
              accessibilityLabel="未登録巻を順番に追加"
              disabled={bulkFillRunning || bulkFillMissingTargets.length === 0}
              onPress={() => void addMissingVolumesAsOwnedQueue()}
              style={[
                styles.bulkFillButton,
                { backgroundColor: colors.text },
                (bulkFillRunning || bulkFillMissingTargets.length === 0) && styles.disabledButton,
              ]}
            >
              {bulkFillRunning ? (
                <ActivityIndicator color={colors.background} size="small" />
              ) : (
                <Text style={[styles.bulkFillButtonText, { color: colors.background }]}>追加</Text>
              )}
            </Pressable>
          </View>
          <Text style={[styles.bulkFillMeta, { color: colors.muted }]}>
            {bulkFillRunning && bulkFillProgress
              ? `${bulkFillProgress.current} / ${bulkFillProgress.total}冊を処理中`
              : `追加予定: ${bulkFillMissingTargets.length}冊`}
          </Text>
          {bulkFillRunning && bulkFillProgress && (
            <View style={[styles.bulkFillProgressTrack, { backgroundColor: colors.elevated }]}>
              <View
                style={[
                  styles.bulkFillProgressFill,
                  {
                    backgroundColor: colors.primary,
                    width: `${Math.round((bulkFillProgress.current / Math.max(1, bulkFillProgress.total)) * 100)}%`,
                  },
                ]}
              />
            </View>
          )}
        </View>
      )}

      <FlatList
        key={normalizeSeriesKey(seriesTitle)}
        ref={listRef}
        data={pageItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => {
          if (!shouldKeepBottomRef.current) return;
          shouldKeepBottomRef.current = false;
          requestAnimationFrame(() => {
            listRef.current?.scrollToEnd({ animated: false });
          });
        }}
        ListHeaderComponent={
          <View>
            <SeriesOverview
              missingCount={missingItems.length}
              ownedCount={ownedItems.length}
              pageRangeLabel={pageRangeLabel}
              readCount={readCount}
              readingCount={readingCount}
              readPercent={readPercent}
              unreadCount={unreadCount}
            />
            <Pagination page={page} pageCount={pageCount} onChange={setPage} />
          </View>
        }
        ListFooterComponent={
          <View style={styles.footerPagination}>
            <Pagination page={page} pageCount={pageCount} onChange={changePageFromBottom} />
          </View>
        }
        renderItem={({ item }) => {
          const selected = selectedIds.includes(item.id);
          const missing = item.isMissing;

          return (
            <Pressable
              onPress={() => handleRowPress(item)}
              onLongPress={() => isOwnedBook(item) && startEditing(item)}
              style={[
                styles.row,
                { backgroundColor: missing ? colors.elevated : colors.surface, borderColor: colors.border },
                selected && { borderColor: colors.primary, borderWidth: 2 },
              ]}
            >
              <Pressable
                accessibilityLabel={selected ? `${item.title}の選択を解除` : `${item.title}を選択`}
                onPress={(event) => {
                  event.stopPropagation();
                  if (editingId) {
                    closeInlineEdit();
                    return;
                  }
                  if (missing) void addMissingAsOwned(item);
                  else toggleSelected(item);
                }}
                style={[styles.checkbox, { borderColor: colors.border }]}
              >
                <Text style={[styles.checkboxText, { color: colors.text }]}>{selected ? '✓' : missing ? '+' : ''}</Text>
              </Pressable>

              <BookCover
                thumbnailUrl={item.thumbnailUrl}
                isbn={isOwnedBook(item) ? item.isbn : undefined}
                style={styles.cover}
                missing={missing}
                placeholderText={`No.${item.volumeNumber ?? '-'}`}
              />

              <View style={styles.rowBody}>
                <Text style={[styles.bookTitle, { color: missing ? colors.muted : colors.text }]} numberOfLines={2}>
                  {item.title}
                </Text>
                <View style={styles.metaRow}>
                  <Text style={[styles.meta, { color: colors.muted }]}>
                    {item.volumeNumber ? `${item.volumeNumber}巻` : '巻数なし'}
                    {missing ? ' / 未所持' : ''}
                  </Text>
                  {isOwnedBook(item) && item.volumeKind === 'extra' && (
                    <View style={[styles.statusPill, { backgroundColor: colors.elevated }]}>
                      <Text style={[styles.statusPillText, { color: colors.muted }]}>関連巻</Text>
                    </View>
                  )}
                  {isOwnedBook(item) && (
                    <View style={[styles.statusPill, { backgroundColor: colors.elevated }]}>
                      <Text style={[styles.statusPillText, { color: colors.text }]}>{statusLabels[item.status]}</Text>
                    </View>
                  )}
                </View>

                {isOwnedBook(item) && (item.author || item.publisher) && (
                  <Text style={[styles.credits, { color: colors.muted }]} numberOfLines={2}>
                    {[item.author, item.publisher].filter(Boolean).join(' / ')}
                  </Text>
                )}

                {missing && (
                  <View style={styles.actionRow}>
                    <Pressable
                      accessibilityLabel={`${item.title}の購入候補を開く`}
                      onPress={(event) => {
                        event.stopPropagation();
                        void openPurchaseCandidates(item);
                      }}
                      style={[styles.iconActionButton, { borderColor: colors.primary }]}
                    >
                      <Ionicons color={colors.primary} name="cart-outline" size={19} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`${item.title}を所持に追加`}
                      disabled={refreshingId === item.id}
                      onPress={(event) => {
                        event.stopPropagation();
                        void addMissingAsOwned(item);
                      }}
                      style={[
                        styles.iconActionButton,
                        { backgroundColor: colors.text, borderColor: colors.text },
                        refreshingId === item.id && styles.disabledButton,
                      ]}
                    >
                      {refreshingId === item.id ? (
                        <ActivityIndicator color={colors.background} size="small" />
                      ) : (
                        <Ionicons color={colors.background} name="add" size={20} />
                      )}
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`${item.title}を欲しいリストに追加`}
                      onPress={(event) => {
                        event.stopPropagation();
                        addMissingToWishlist(item);
                      }}
                      style={[styles.textActionButton, { borderColor: colors.border }]}
                    >
                      <Ionicons color={colors.text} name="heart-outline" size={19} />
                      <Text style={[styles.textActionLabel, { color: colors.text }]}>欲しいへ</Text>
                    </Pressable>
                  </View>
                )}

                {isOwnedBook(item) && editingId === item.id && (
                  <Pressable onPress={(event) => event.stopPropagation()} style={styles.editBox}>
                    <TextInput
                      value={draftSeries}
                      onChangeText={setDraftSeries}
                      placeholder="シリーズ名"
                      placeholderTextColor={colors.muted}
                      style={[styles.editInput, { backgroundColor: colors.input, color: colors.text }]}
                    />
                    {draftVolumeKind === 'main' && (
                      <TextInput
                        value={draftVolume}
                        onChangeText={setDraftVolume}
                        keyboardType="number-pad"
                        placeholder="巻"
                        placeholderTextColor={colors.muted}
                        style={[styles.editInput, { backgroundColor: colors.input, color: colors.text }]}
                      />
                    )}
                    <View style={[styles.volumeKindRow, { backgroundColor: colors.elevated }]}>
                      {([
                        ['main', '通常巻'],
                        ['extra', '関連巻'],
                      ] as const).map(([value, label]) => (
                        <Pressable
                          key={value}
                          onPress={() => setDraftVolumeKind(value)}
                          style={[styles.volumeKindButton, draftVolumeKind === value && { backgroundColor: colors.text }]}
                        >
                          <Text style={[styles.volumeKindText, { color: draftVolumeKind === value ? colors.background : colors.muted }]}>
                            {label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    {trackPurchasePrices && (
                      <TextInput
                        value={draftPurchasePrice}
                        onChangeText={(value) => setDraftPurchasePrice(value.replace(/[^0-9]/g, ''))}
                        keyboardType="number-pad"
                        placeholder="購入価格"
                        placeholderTextColor={colors.muted}
                        style={[styles.editInput, { backgroundColor: colors.input, color: colors.text }]}
                      />
                    )}
                    <Pressable
                      accessibilityLabel={`${item.title}の編集内容を保存`}
                      onPress={() => submitEdit(item)}
                      style={[styles.saveIconButton, { backgroundColor: colors.text }]}
                    >
                      <Ionicons color={colors.background} name="checkmark" size={20} />
                    </Pressable>
                  </Pressable>
                )}

                {isOwnedBook(item) && (
                  <View style={styles.actionRow}>
                    <Pressable
                      accessibilityLabel={`${item.title}の詳細を見る`}
                      onPress={(event) => {
                        event.stopPropagation();
                        router.push({
                          pathname: '/book/[id]',
                          params: { fromSeries: seriesTitle, id: item.id },
                        });
                      }}
                      style={[styles.iconActionButton, { borderColor: colors.primary }]}
                    >
                      <Ionicons color={colors.primary} name="information-circle-outline" size={19} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`${item.title}の書籍情報を再取得`}
                      disabled={refreshingId === item.id}
                      onPress={(event) => {
                        event.stopPropagation();
                        refreshMetadata(item);
                      }}
                      style={[styles.iconActionButton, { borderColor: colors.border }, refreshingId === item.id && styles.disabledButton]}
                    >
                      {refreshingId === item.id ? (
                        <ActivityIndicator color={colors.text} size="small" />
                      ) : (
                        <Ionicons color={colors.text} name="refresh" size={19} />
                      )}
                    </Pressable>
                    {trackPurchasePrices && (
                      <Pressable
                        accessibilityLabel={`${item.title}の購入価格を編集`}
                        onPress={(event) => {
                          event.stopPropagation();
                          startEditing(item);
                        }}
                        style={[styles.iconActionButton, { borderColor: colors.border }]}
                      >
                        <Ionicons color={colors.text} name="pricetag-outline" size={19} />
                      </Pressable>
                    )}
                    <Pressable
                      accessibilityLabel={`${item.title}を削除`}
                      onPress={(event) => {
                        event.stopPropagation();
                        confirmDelete(item);
                      }}
                      style={[styles.iconActionButton, { borderColor: colors.danger }]}
                    >
                      <Ionicons color={colors.danger} name="trash-outline" size={19} />
                    </Pressable>
                  </View>
                )}
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function SeriesOverview({
  missingCount,
  ownedCount,
  pageRangeLabel,
  readCount,
  readingCount,
  readPercent,
  unreadCount,
}: {
  missingCount: number;
  ownedCount: number;
  pageRangeLabel: string;
  readCount: number;
  readingCount: number;
  readPercent: number;
  unreadCount: number;
}) {
  const { colors } = useAppTheme();
  const totalKnown = ownedCount + missingCount;

  return (
    <View style={[styles.overview, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.overviewHeader}>
        <View>
          <Text style={[styles.overviewLabel, { color: colors.muted }]}>このページ</Text>
          <Text style={[styles.overviewTitle, { color: colors.text }]}>{pageRangeLabel}</Text>
        </View>
        <View style={[styles.readProgressBadge, { backgroundColor: colors.elevated }]}>
          <Text style={[styles.readProgressText, { color: colors.text }]}>読了 {readPercent}%</Text>
        </View>
      </View>

      <View style={[styles.progressTrack, { backgroundColor: colors.elevated }]}>
        <View style={[styles.progressFill, { backgroundColor: colors.success, width: `${readPercent}%` }]} />
      </View>

      <View style={styles.overviewStats}>
        <OverviewStat label="所持" value={ownedCount} />
        <OverviewStat label="抜け巻" value={missingCount} danger={missingCount > 0} />
        <OverviewStat label="表示巻" value={totalKnown} />
      </View>

      <Text style={[styles.statusSummaryText, { color: colors.muted }]}>
        未読 {unreadCount} / 読書中 {readingCount} / 読了 {readCount}
      </Text>
    </View>
  );
}


function OverviewStat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.overviewStat}>
      <Text style={[styles.overviewStatValue, { color: danger ? colors.danger : colors.text }]}>{value}</Text>
      <Text style={[styles.overviewStatLabel, { color: colors.muted }]}>{label}</Text>
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
        style={[styles.pageArrowButton, { borderColor: colors.border }, page === 1 && styles.disabledButton]}
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
        style={[styles.pageArrowButton, { borderColor: colors.border }, page === pageCount && styles.disabledButton]}
      >
        <Text style={[styles.pageArrowText, { color: colors.text }]}>{'>'}</Text>
      </Pressable>
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
  bulkBar: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    padding: 12,
  },
  bulkText: { flex: 1, fontSize: 13, fontWeight: '700' },
  bulkFillShortcutButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    height: 38,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  bulkFillShortcutLabel: { fontSize: 11, fontWeight: '900' },
  smallIconButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 36,
  },
  disabledButton: { opacity: 0.35 },
  iconActionButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 42,
  },
  textActionButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    height: 38,
    justifyContent: 'center',
    paddingHorizontal: 10,
    minWidth: 96,
  },
  textActionLabel: { fontSize: 12, fontWeight: '800' },
  statusSlot: {
    borderBottomWidth: 1,
    justifyContent: 'center',
    minHeight: 58,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusHint: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  statusBar: {
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  statusTextButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    height: 36,
    justifyContent: 'center',
    minWidth: 96,
    paddingHorizontal: 10,
  },
  statusTextButtonLabel: { fontSize: 12, fontWeight: '800' },
  bulkPriceRow: { flexDirection: 'row', gap: 8, width: '100%' },
  bulkPriceInput: { borderRadius: 8, flex: 1, fontSize: 13, fontWeight: '700', height: 36, paddingHorizontal: 10 },
  renameBox: { borderBottomWidth: 1, gap: 8, padding: 12 },
  bulkFillBox: { borderBottomWidth: 1, gap: 8, padding: 12 },
  bulkFillHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 8 },
  bulkFillTitleWrap: { flex: 1, gap: 4 },
  bulkFillButton: { alignItems: 'center', borderRadius: 8, height: 40, justifyContent: 'center', minWidth: 74, paddingHorizontal: 12 },
  bulkFillButtonText: { fontSize: 13, fontWeight: '900' },
  bulkFillMeta: { fontSize: 12, fontWeight: '800' },
  bulkFillProgressTrack: {
    borderRadius: 999,
    height: 5,
    marginTop: 8,
    overflow: 'hidden',
  },
  bulkFillProgressFill: {
    borderRadius: 999,
    height: '100%',
  },
  rowTitle: { fontSize: 14, fontWeight: '800' },
  renameCopy: { fontSize: 12, lineHeight: 17 },
  renameRow: { flexDirection: 'row', gap: 8 },
  renameInput: {
    borderRadius: 8,
    flex: 1,
    fontSize: 15,
    height: 40,
    paddingHorizontal: 10,
  },
  saveIconButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 40,
    justifyContent: 'center',
    width: 44,
  },
  list: { padding: 14, paddingBottom: 28 },
  footerPagination: { paddingBottom: 16 },
  overview: {
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    marginBottom: 10,
    padding: 12,
  },
  overviewHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  overviewLabel: { fontSize: 11, fontWeight: '800' },
  overviewTitle: { fontSize: 18, fontWeight: '900', marginTop: 2 },
  readProgressBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  readProgressText: { fontSize: 12, fontWeight: '900' },
  progressTrack: {
    borderRadius: 999,
    height: 7,
    overflow: 'hidden',
  },
  progressFill: {
    borderRadius: 999,
    height: '100%',
  },
  overviewStats: { flexDirection: 'row', gap: 8 },
  overviewStat: { flex: 1 },
  overviewStatValue: { fontSize: 18, fontWeight: '900' },
  overviewStatLabel: { fontSize: 11, fontWeight: '800', marginTop: 2 },
  statusSummaryText: { fontSize: 12, fontWeight: '700' },
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
  row: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
    minHeight: 176,
    padding: 10,
  },
  checkbox: {
    alignItems: 'center',
    borderRadius: 4,
    borderWidth: 1,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  checkboxText: { fontSize: 14, fontWeight: '900' },
  cover: { borderRadius: 4, height: 88, width: 60 },
  rowBody: { flex: 1 },
  bookTitle: { fontSize: 16, fontWeight: '800', lineHeight: 21 },
  meta: { fontSize: 13, marginTop: 6 },
  metaRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  statusPill: {
    borderRadius: 999,
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusPillText: { fontSize: 11, fontWeight: '800' },
  credits: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  editBox: { gap: 8, marginTop: 10 },
  volumeKindRow: { borderRadius: 8, flexDirection: 'row', marginBottom: 8, padding: 4 },
  volumeKindButton: { alignItems: 'center', borderRadius: 6, flex: 1, height: 34, justifyContent: 'center' },
  volumeKindText: { fontSize: 13, fontWeight: '800' },
  editInput: {
    borderRadius: 8,
    height: 40,
    paddingHorizontal: 10,
  },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  headerActions: { alignItems: 'center', flexDirection: 'row', gap: 2 },
  headerReportButton: { alignItems: 'center', height: 34, justifyContent: 'center', width: 30 },
  headerFavoriteButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 40,
  },
});



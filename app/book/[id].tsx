import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BookCover } from '../../src/components/BookCover';
import { BookVolumeDetails } from '../../src/lib/bookApis';
import { getBookVolumeDetails } from '../../src/lib/bookDetailsCache';
import { getKnownBookCoverOverride } from '../../src/lib/knownBookOverrides';
import { useAppSettings } from '../../src/store/AppSettingsContext';
import { useLibrary } from '../../src/store/LibraryContext';
import { useAppTheme } from '../../src/store/ThemeContext';

const statusLabels = {
  unread: '未読',
  reading: '読書中',
  read: '読了',
} as const;

function formatCurrency(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '未記録';
  return `¥${Math.round(value).toLocaleString('ja-JP')}`;
}

export default function BookDetailsScreen() {
  const params = useLocalSearchParams<{ editPrice?: string; fromSeries?: string; id: string }>();
  const navigation = useNavigation();
  const { books, loading: libraryLoading, updateBook } = useLibrary();
  const { trackPurchasePrices } = useAppSettings();
  const { colors } = useAppTheme();
  const routeBookId = Array.isArray(params.id) ? params.id[0] : params.id;
  const activeBookIdRef = useRef(routeBookId);
  const priceEditParamConsumedRef = useRef<string | null>(null);
  const book = books.find((candidate) => candidate.id === routeBookId);
  const [details, setDetails] = useState<BookVolumeDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingPrice, setEditingPrice] = useState(false);
  const [draftPurchasePrice, setDraftPurchasePrice] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);

  const goBack = useCallback(() => {
    const fromSeries = Array.isArray(params.fromSeries) ? params.fromSeries[0] : params.fromSeries;
    if (fromSeries) {
      router.replace(`/series/${encodeURIComponent(fromSeries)}`);
      return;
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    if (book?.seriesTitle) {
      router.replace(`/series/${encodeURIComponent(book.seriesTitle)}`);
      return;
    }
    router.replace('/(tabs)');
  }, [book?.seriesTitle, navigation, params.fromSeries]);
  useLayoutEffect(() => {
    navigation.setOptions({
      title: book?.volumeNumber ? `${book.volumeNumber}巻` : '巻の情報',
      headerLeft: () => (
        <Pressable
          accessibilityLabel="戻る"
          hitSlop={8}
          onPress={goBack}
          style={styles.headerBackButton}
        >
          <Ionicons color={colors.text} name="chevron-back" size={22} />
          <Text style={[styles.headerBackText, { color: colors.text }]}>戻る</Text>
        </Pressable>
      ),
      headerRight: () => (
        <Pressable
          accessibilityLabel="巻情報の違いを報告"
          hitSlop={10}
          onPress={() => router.navigate({ pathname: '/report', params: { series: book?.seriesTitle ?? '', title: book?.title ?? '', volume: book?.volumeNumber ? String(book.volumeNumber) : '', isbn: book?.isbn ?? '', reason: 'book', from: 'book' } })}
          style={styles.headerReportButton}
        >
          <Ionicons color={colors.muted} name="flag-outline" size={17} />
        </Pressable>
      ),
    });
  }, [book?.seriesTitle, book?.volumeNumber, colors.muted, colors.text, goBack, navigation]);

  useEffect(() => {
    activeBookIdRef.current = routeBookId;
    setDetails(null);
    setError(null);
    setLoaded(false);
    setLoading(false);
    setEditingPrice(false);
    setDraftPurchasePrice('');
    setSavingPrice(false);
    priceEditParamConsumedRef.current = null;
  }, [routeBookId]);

  const loadDetails = useCallback(
    async (forceRefresh = false) => {
      const targetBook = book;
      const targetBookId = routeBookId;
      if (!targetBook || loading) return;
      setLoading(true);
      setError(null);
      try {
        const result = await getBookVolumeDetails(targetBook, { forceRefresh });
        if (activeBookIdRef.current !== targetBookId) return;
        setDetails(result);
        if (result) {
          const knownCover = getKnownBookCoverOverride({ isbn: targetBook.isbn, title: targetBook.title });
          const nextThumbnailUrl = knownCover ?? result.thumbnailUrl;
          const metadataUpdates = {
            ...(result.source === 'Developer Override' && result.title && result.title !== targetBook.title
              ? { title: result.title }
              : {}),
            ...(result.author && result.author !== targetBook.author
              ? { author: result.author }
              : {}),
            ...(result.publisher && result.publisher !== targetBook.publisher
              ? { publisher: result.publisher }
              : {}),
            ...(nextThumbnailUrl && nextThumbnailUrl !== targetBook.thumbnailUrl
              ? { thumbnailUrl: nextThumbnailUrl }
              : {}),
            ...(typeof result.listPrice === 'number' && result.listPrice !== targetBook.listPrice
              ? { listPrice: result.listPrice }
              : {}),
            ...(result.priceSource && result.priceSource !== targetBook.priceSource
              ? { priceSource: result.priceSource }
              : {}),
            ...(result.priceFetchedAt && result.priceFetchedAt !== targetBook.priceFetchedAt
              ? { priceFetchedAt: result.priceFetchedAt }
              : {}),
            ...(trackPurchasePrices && typeof targetBook.purchasePrice !== 'number' && typeof result.listPrice === 'number'
              ? { purchasePrice: result.listPrice }
              : {}),
          };
          if (Object.keys(metadataUpdates).length > 0) {
            await updateBook(targetBook.id, metadataUpdates);
          }
        }
        setLoaded(true);
      } catch (loadError) {
        if (activeBookIdRef.current !== targetBookId) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : '巻の紹介を取得できませんでした。',
        );
        setLoaded(true);
      } finally {
        if (activeBookIdRef.current === targetBookId) {
          setLoading(false);
        }
      }
    },
    [book, loading, routeBookId, trackPurchasePrices, updateBook],
  );

  useEffect(() => {
    if (book && !loaded) void loadDetails();
  }, [book, loadDetails, loaded, routeBookId]);
  useEffect(() => {
    if (!book || !trackPurchasePrices) return;
    setDraftPurchasePrice(typeof book.purchasePrice === 'number' ? String(book.purchasePrice) : '');
    if (params.editPrice === '1' && priceEditParamConsumedRef.current !== routeBookId) {
      priceEditParamConsumedRef.current = routeBookId;
      setEditingPrice(true);
    }
  }, [book, params.editPrice, routeBookId, trackPurchasePrices]);

  const savePurchasePrice = useCallback(async () => {
    if (!book || savingPrice) return;
    const normalizedPrice = draftPurchasePrice.replace(/[^0-9]/g, '');
    const nextPrice = normalizedPrice ? Number.parseInt(normalizedPrice, 10) : null;
    setSavingPrice(true);
    try {
      await updateBook(book.id, { purchasePrice: nextPrice });
      setEditingPrice(false);
    } catch (saveError) {
      Alert.alert('本の間', saveError instanceof Error ? saveError.message : '購入価格の保存に失敗しました。');
    } finally {
      setSavingPrice(false);
    }
  }, [book, draftPurchasePrice, savingPrice, updateBook]);

  if (!book) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        {libraryLoading ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Text style={[styles.emptyText, { color: colors.muted }]}>
            この本は本棚に見つかりませんでした。
          </Text>
        )}
      </View>
    );
  }

  const knownCover = getKnownBookCoverOverride({ isbn: book.isbn, title: book.title });
  const displayTitle = details?.title ?? book.title;
  const displayAuthor = details?.author ?? book.author;
  const seriesPublisher = books.find(
    (candidate) =>
      candidate.seriesTitle === book.seriesTitle &&
      candidate.publisher,
  )?.publisher;
  const displayPublisher = details?.publisher ?? book.publisher ?? seriesPublisher;
  const displayCover = knownCover ?? details?.thumbnailUrl ?? book.thumbnailUrl;
  const shouldPrioritizePriceEditor = trackPurchasePrices && params.editPrice === '1';
  const priceSection = trackPurchasePrices ? (
    <View style={[styles.pricePanel, { backgroundColor: colors.elevated, borderColor: colors.border }]}>
      <View style={styles.priceHeader}>
        <View style={styles.priceHeaderText}>
          <Text style={[styles.priceTitle, { color: colors.text }]}>購入価格</Text>
          <Text style={[styles.priceValue, { color: typeof book.purchasePrice === 'number' ? colors.text : colors.muted }]}>
            {formatCurrency(book.purchasePrice)}
          </Text>
          {typeof book.listPrice === 'number' ? (
            <Text style={[styles.priceMeta, { color: colors.muted }]}>新品価格: {formatCurrency(book.listPrice)}</Text>
          ) : null}
        </View>
        <Pressable
          accessibilityLabel="購入価格を編集"
          disabled={savingPrice}
          onPress={() => {
            setDraftPurchasePrice(typeof book.purchasePrice === 'number' ? String(book.purchasePrice) : '');
            setEditingPrice((current) => !current);
          }}
          style={[styles.priceEditButton, { borderColor: colors.border }]}
        >
          <Ionicons color={colors.text} name={editingPrice ? 'close' : 'create-outline'} size={18} />
        </Pressable>
      </View>
      {editingPrice ? (
        <View style={styles.priceEditRow}>
          <TextInput
            value={draftPurchasePrice}
            onChangeText={(value) => setDraftPurchasePrice(value.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder="購入価格"
            placeholderTextColor={colors.muted}
            style={[styles.priceInput, { backgroundColor: colors.input, color: colors.text }]}
          />
          <Pressable
            accessibilityLabel="購入価格を保存"
            disabled={savingPrice}
            onPress={() => void savePurchasePrice()}
            style={[styles.priceSaveButton, { backgroundColor: colors.text }, savingPrice && styles.disabled]}
          >
            {savingPrice ? <ActivityIndicator color={colors.background} size="small" /> : <Ionicons color={colors.background} name="checkmark" size={20} />}
          </Pressable>
        </View>
      ) : null}
    </View>
  ) : null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
      <BookCover
        thumbnailUrl={displayCover}
        isbn={book.isbn}
        style={styles.cover}
        placeholderText="表紙なし"
      />

      <Text style={[styles.title, { color: colors.text }]}>{displayTitle}</Text>
      {!!details?.subtitle && (
        <Text style={[styles.subtitle, { color: colors.muted }]}>{details.subtitle}</Text>
      )}
      <Text style={[styles.series, { color: colors.muted }]}>
        {book.seriesTitle}
        {book.volumeNumber ? ` / ${book.volumeNumber}巻` : ''}
      </Text>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <MetadataRow label="作者" value={displayAuthor} />
      <MetadataRow label="出版社" value={displayPublisher} />
      <MetadataRow label="状態" value={statusLabels[book.status]} />
      <MetadataRow label="ISBN" value={book.isbn} />

      {shouldPrioritizePriceEditor ? priceSection : null}

      <View style={styles.descriptionHeading}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>巻の紹介</Text>
        <Pressable
          accessibilityLabel="巻の紹介を再取得"
          disabled={loading}
          hitSlop={8}
          onPress={() => void loadDetails(true)}
          style={[styles.refreshButton, { borderColor: colors.border }, loading && styles.disabled]}
        >
          {loading ? (
            <ActivityIndicator color={colors.text} size="small" />
          ) : (
            <Ionicons color={colors.text} name="refresh" size={17} />
          )}
        </Pressable>
      </View>

      {loading && !loaded ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.text} />
          <Text style={[styles.loadingText, { color: colors.muted }]}>紹介文を取得しています</Text>
        </View>
      ) : details?.description ? (
        <Text style={[styles.description, { color: colors.text }]}>{details.description}</Text>
      ) : (
        <Text style={[styles.descriptionEmpty, { color: colors.muted }]}>
          {error ?? 'この巻の紹介文は提供されていません。'}
        </Text>
      )}

      {!!details?.source && (
        <Text style={[styles.source, { color: colors.muted }]}>
          情報提供: {details.source}
        </Text>
      )}

      {!shouldPrioritizePriceEditor ? priceSection : null}
      </ScrollView>
    </View>
  );
}

function MetadataRow({ label, value }: { label: string; value?: string }) {
  const { colors } = useAppTheme();
  if (!value) return null;

  return (
    <View style={styles.metadataRow}>
      <Text style={[styles.metadataLabel, { color: colors.muted }]}>{label}</Text>
      <Text selectable style={[styles.metadataValue, { color: colors.text }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { alignItems: 'center', paddingBottom: 60, paddingHorizontal: 22, paddingTop: 22 },
  center: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  emptyText: { fontSize: 14, textAlign: 'center' },
  cover: { borderRadius: 6, height: 276, width: 190 },
  title: {
    alignSelf: 'stretch',
    fontSize: 23,
    fontWeight: '800',
    lineHeight: 31,
    marginTop: 22,
    textAlign: 'center',
  },
  subtitle: { fontSize: 14, lineHeight: 20, marginTop: 5, textAlign: 'center' },
  series: { fontSize: 13, marginTop: 8, textAlign: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 22, width: '100%' },
  pricePanel: { alignSelf: 'stretch', borderRadius: 8, borderWidth: 1, gap: 12, marginTop: 14, padding: 12 },
  priceHeader: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  priceHeaderText: { flex: 1, minWidth: 0 },
  priceTitle: { fontSize: 13, fontWeight: '800' },
  priceValue: { fontSize: 18, fontWeight: '900', marginTop: 3 },
  priceMeta: { fontSize: 12, fontWeight: '700', marginTop: 4 },
  priceEditButton: { alignItems: 'center', borderRadius: 8, borderWidth: 1, height: 36, justifyContent: 'center', width: 38 },
  priceEditRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  priceInput: { borderRadius: 8, flex: 1, fontSize: 15, fontWeight: '800', height: 42, paddingHorizontal: 12 },
  priceSaveButton: { alignItems: 'center', borderRadius: 8, height: 42, justifyContent: 'center', width: 46 },
  metadataRow: {
    alignItems: 'flex-start',
    alignSelf: 'stretch',
    flexDirection: 'row',
    minHeight: 30,
  },
  metadataLabel: { fontSize: 13, fontWeight: '700', width: 68 },
  metadataValue: { flex: 1, fontSize: 14, lineHeight: 20 },
  descriptionHeading: {
    alignItems: 'center',
    alignSelf: 'stretch',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
  },
  sectionTitle: { fontSize: 18, fontWeight: '800' },
  refreshButton: {
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 38,
  },
  disabled: { opacity: 0.4 },
  loadingRow: {
    alignItems: 'center',
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 24,
  },
  loadingText: { fontSize: 13 },
  description: {
    alignSelf: 'stretch',
    fontSize: 15,
    lineHeight: 25,
    marginTop: 14,
  },
  descriptionEmpty: {
    alignSelf: 'stretch',
    fontSize: 14,
    lineHeight: 22,
    marginTop: 14,
  },
  source: { alignSelf: 'stretch', fontSize: 11, marginTop: 20 },
  headerBackButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
    paddingRight: 8,
  },
  headerBackText: { fontSize: 15, fontWeight: '700' },
  headerReportButton: { alignItems: 'center', height: 34, justifyContent: 'center', width: 30 },
});


import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BookCover } from '../../../src/components/BookCover';
import { EdgeSwipeBack } from '../../../src/components/EdgeSwipeBack';
import { BookVolumeDetails } from '../../../src/lib/bookApis';
import { getBookVolumeDetails } from '../../../src/lib/bookDetailsCache';
import { useLibrary } from '../../../src/store/LibraryContext';
import { useAppTheme } from '../../../src/store/ThemeContext';

const statusLabels = {
  unread: '未読',
  reading: '読書中',
  read: '読了',
} as const;

export default function BookDetailsScreen() {
  const params = useLocalSearchParams<{ fromSeries?: string; id: string }>();
  const navigation = useNavigation();
  const { books, loading: libraryLoading, updateBook } = useLibrary();
  const { colors } = useAppTheme();
  const routeBookId = Array.isArray(params.id) ? params.id[0] : params.id;
  const activeBookIdRef = useRef(routeBookId);
  const book = books.find((candidate) => candidate.id === routeBookId);
  const [details, setDetails] = useState<BookVolumeDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    const fromSeries = Array.isArray(params.fromSeries) ? params.fromSeries[0] : params.fromSeries;
    if (fromSeries) {
      router.replace(`/(tabs)/series/${encodeURIComponent(fromSeries)}`);
      return;
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    if (book?.seriesTitle) {
      router.replace(`/(tabs)/series/${encodeURIComponent(book.seriesTitle)}`);
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
    });
  }, [book?.volumeNumber, colors.text, goBack, navigation]);

  useEffect(() => {
    activeBookIdRef.current = routeBookId;
    setDetails(null);
    setError(null);
    setLoaded(false);
    setLoading(false);
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
          const metadataUpdates = {
            ...(result.author && result.author !== targetBook.author
              ? { author: result.author }
              : {}),
            ...(result.publisher && result.publisher !== targetBook.publisher
              ? { publisher: result.publisher }
              : {}),
            ...(result.thumbnailUrl && result.thumbnailUrl !== targetBook.thumbnailUrl
              ? { thumbnailUrl: result.thumbnailUrl }
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
    [book, loading, routeBookId, updateBook],
  );

  useEffect(() => {
    if (book && !loaded) void loadDetails();
  }, [book, loadDetails, loaded, routeBookId]);

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

  const displayTitle = details?.title ?? book.title;
  const displayAuthor = details?.author ?? book.author;
  const seriesPublisher = books.find(
    (candidate) =>
      candidate.seriesTitle === book.seriesTitle &&
      candidate.publisher,
  )?.publisher;
  const displayPublisher = details?.publisher ?? book.publisher ?? seriesPublisher;
  const displayCover = details?.thumbnailUrl ?? book.thumbnailUrl;

  return (
    <EdgeSwipeBack onBack={goBack} style={{ backgroundColor: colors.background }}>
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
      </ScrollView>
    </EdgeSwipeBack>
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
});

import { useScrollToTop } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BookCover } from '../../src/components/BookCover';
import { buildPurchaseUrl, searchSeriesCandidates, SeriesSearchCandidate } from '../../src/lib/bookApis';
import { normalizeSeriesKey } from '../../src/lib/series';
import { useAppSettings } from '../../src/store/AppSettingsContext';
import { useLibrary } from '../../src/store/LibraryContext';
import { useAppTheme } from '../../src/store/ThemeContext';
import { useWishlist, WishlistItem } from '../../src/store/WishlistContext';

const priorityOptions = [
  { key: 'high', label: '最優先', score: 95, icon: 'flame-outline' as const },
  { key: 'normal', label: '気になる', score: 75, icon: 'sparkles-outline' as const },
  { key: 'later', label: 'いつか', score: 50, icon: 'time-outline' as const },
];

function priorityLabel(score: number) {
  if (score >= 90) return '最優先';
  if (score >= 70) return '気になる';
  return 'いつか欲しい';
}

function normalizeTitleForCover(value?: string) {
  return value
    ?.normalize('NFKC')
    .toLowerCase()
    .replace(/[「」『』【】［］\[\]（）()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function WishlistScreen() {
  const { colors } = useAppTheme();
  const { openExternalPurchaseLinks } = useAppSettings();
  const { books } = useLibrary();
  const { addItem, deleteItem, items, updateItem } = useWishlist();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [candidates, setCandidates] = useState<SeriesSearchCandidate[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<SeriesSearchCandidate | null>(null);
  const [selectedPriority, setSelectedPriority] = useState(priorityOptions[1]);
  const [memoOpen, setMemoOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingNote, setEditingNote] = useState('');
  const [lastDeleted, setLastDeleted] = useState<WishlistItem | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editOrderIds, setEditOrderIds] = useState<string[]>([]);
  const [overviewHeight, setOverviewHeight] = useState(0);
  const [topSectionHeight, setTopSectionHeight] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(84);
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const headerTranslateY = useRef(new Animated.Value(0)).current;
  const headerVisibleRef = useRef(true);
  const lastScrollYRef = useRef(0);
  const directionDistanceRef = useRef(0);
  const lastDirectionRef = useRef<1 | -1>(1);
  const tabScrollToTopRef = useRef({
    scrollToTop: () => {},
  });

  const openPurchaseCandidate = async (item: WishlistItem) => {
    const purchaseUrl = item.purchaseUrl ?? buildPurchaseUrl(item.title);
    if (openExternalPurchaseLinks) {
      await Linking.openURL(purchaseUrl);
    } else {
      await WebBrowser.openBrowserAsync(purchaseUrl);
    }
  };

  const trimmedTitle = title.trim();
  const topItems = useMemo(() => items.slice(0, 5), [items]);
  const displayItems = useMemo(() => {
    if (!editMode) return items;
    const itemById = new Map(items.map((item) => [item.id, item]));
    const orderedItems = editOrderIds
      .map((id) => itemById.get(id))
      .filter((item): item is WishlistItem => !!item);
    const pinnedIds = new Set(editOrderIds);
    const newItems = items.filter((item) => !pinnedIds.has(item.id));
    return [...orderedItems, ...newItems];
  }, [editMode, editOrderIds, items]);
  const highPriorityCount = useMemo(() => items.filter((item) => item.score >= 90).length, [items]);
  const setHeaderVisible = useCallback(
    (visible: boolean) => {
      if (headerVisibleRef.current === visible) return;
      headerVisibleRef.current = visible;
      Animated.timing(headerTranslateY, {
        toValue: visible ? 0 : -headerHeight,
        duration: 180,
        useNativeDriver: true,
      }).start();
    },
    [headerHeight, headerTranslateY],
  );

  tabScrollToTopRef.current.scrollToTop = () => {
    setHeaderVisible(true);
    lastScrollYRef.current = 0;
    directionDistanceRef.current = 0;
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };
  useScrollToTop(tabScrollToTopRef);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nextY = Math.max(0, event.nativeEvent.contentOffset.y);
      scrollYRef.current = nextY;
      const delta = nextY - lastScrollYRef.current;
      lastScrollYRef.current = nextY;
      if (nextY < 8) {
        directionDistanceRef.current = 0;
        setHeaderVisible(true);
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
        setHeaderVisible(direction < 0);
        directionDistanceRef.current = 0;
      }
    },
    [setHeaderVisible],
  );
  const hiddenSummaryHeight = () => overviewHeight + (topItems.length > 0 ? topSectionHeight : 0) + 32;
  const adjustScrollAfterLayoutChange = (delta: number) => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        y: Math.max(0, scrollYRef.current + delta),
        animated: false,
      });
    });
  };
  const coverByTitle = useMemo(() => {
    const map = new Map<string, { coverUrl: string; rank: number }>();
    const sortedBooks = [...books].sort((left, right) => {
      const leftVolume = left.volumeNumber ?? Number.MAX_SAFE_INTEGER;
      const rightVolume = right.volumeNumber ?? Number.MAX_SAFE_INTEGER;
      return (
        leftVolume - rightVolume ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.title.localeCompare(right.title)
      );
    });

    for (const book of sortedBooks) {
      if (!book.thumbnailUrl) continue;
      const rank = book.volumeNumber === 1 ? 0 : book.volumeNumber ?? Number.MAX_SAFE_INTEGER;
      for (const key of [book.title, book.seriesTitle]) {
        const normalizedKey = normalizeTitleForCover(key);
        if (!normalizedKey) continue;
        const current = map.get(normalizedKey);
        if (!current || rank < current.rank) {
          map.set(normalizedKey, { coverUrl: book.thumbnailUrl, rank });
        }
      }
    }
    return map;
  }, [books]);

  const findCoverUrl = (value: string) => {
    const normalizedTitle = normalizeTitleForCover(value);
    if (!normalizedTitle) return undefined;
    const exactCover = coverByTitle.get(normalizedTitle)?.coverUrl;
    if (exactCover) return exactCover;
    return [...coverByTitle.entries()]
      .filter(([key]) => key.includes(normalizedTitle) || normalizedTitle.includes(key))
      .sort((left, right) => left[1].rank - right[1].rank)?.[0]?.[1].coverUrl;
  };

  const refineCandidates = (results: SeriesSearchCandidate[]) => {
    const queryKey = normalizeSeriesKey(trimmedTitle);
    const exactMatches = results.filter((candidate) => normalizeSeriesKey(candidate.seriesTitle) === queryKey);
    if (exactMatches.length > 0) return [exactMatches[0]];

    const containedMatches = results.filter((candidate) => {
      const candidateKey = normalizeSeriesKey(candidate.seriesTitle);
      return candidateKey.includes(queryKey) || queryKey.includes(candidateKey);
    });
    if (containedMatches.length === 1) return containedMatches;

    return results.slice(0, 5);
  };

  const searchCandidates = async () => {
    if (!trimmedTitle) {
      Alert.alert('蒐集架', 'タイトルまたはシリーズ名を入力してください。');
      return;
    }
    setCandidateLoading(true);
    setSelectedCandidate(null);
    try {
      const results = refineCandidates(await searchSeriesCandidates(trimmedTitle));
      setCandidates(results);
      setSelectedCandidate(results.length === 1 ? results[0] : null);
      if (results.length === 0) {
        Alert.alert('候補が見つかりませんでした', '入力したシリーズ名のまま追加できます。');
      }
    } catch (error) {
      Alert.alert('検索に失敗しました', error instanceof Error ? error.message : '通信状態を確認してもう一度お試しください。');
    } finally {
      setCandidateLoading(false);
    }
  };

  const submit = () => {
    if (!trimmedTitle) {
      Alert.alert('蒐集架', '欲しい漫画のタイトルを入力してください。');
      return;
    }
    if (candidates.length > 1 && !selectedCandidate) {
      Alert.alert('候補を選択してください', '複数のシリーズ候補から追加するものを選んでください。');
      return;
    }
    const addTitle = selectedCandidate?.seriesTitle ?? trimmedTitle;
    const addCoverUrl = selectedCandidate?.coverUrl ?? findCoverUrl(addTitle);
    addItem({
      title: addTitle,
      score: selectedPriority.score,
      coverUrl: addCoverUrl,
      note,
      purchaseUrl: buildPurchaseUrl(addTitle),
    });
    setTitle('');
    setNote('');
    setCandidates([]);
    setSelectedCandidate(null);
    setMemoOpen(false);
    setSelectedPriority(priorityOptions[1]);
  };

  const startEditing = (item: WishlistItem) => {
    if (!editMode) {
      setEditOrderIds(items.map((currentItem) => currentItem.id));
      adjustScrollAfterLayoutChange(-hiddenSummaryHeight());
    }
    setEditMode(true);
    setEditingId(item.id);
    setEditingTitle(item.title);
    setEditingNote(item.note ?? '');
  };

  const submitEdit = (item: WishlistItem) => {
    updateItem(item.id, {
      title: editingTitle,
      note: editingNote,
    });
    setEditingId(null);
    setEditingTitle('');
    setEditingNote('');
  };

  const removeItem = (item: WishlistItem) => {
    deleteItem(item.id);
    setLastDeleted(item);
  };

  const undoDelete = () => {
    if (!lastDeleted) return;
    addItem({
      title: lastDeleted.title,
      score: lastDeleted.score,
      coverUrl: lastDeleted.coverUrl,
      note: lastDeleted.note,
      purchaseUrl: lastDeleted.purchaseUrl,
    });
    setLastDeleted(null);
  };

  const toggleEditMode = () => {
    if (editMode) {
      const restoreHeight = hiddenSummaryHeight();
      setEditOrderIds([]);
      setEditingId(null);
      setEditingTitle('');
      setEditingNote('');
      setMemoOpen(false);
      setEditMode(false);
      adjustScrollAfterLayoutChange(restoreHeight);
      return;
    }

    setEditOrderIds(items.map((item) => item.id));
    setEditMode(true);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Animated.View
        onLayout={(event) => {
          const nextHeight = Math.ceil(event.nativeEvent.layout.height);
          if (nextHeight === headerHeight) return;
          setHeaderHeight(nextHeight);
          if (!headerVisibleRef.current) headerTranslateY.setValue(-nextHeight);
        }}
        style={[
          styles.headerShell,
          {
            backgroundColor: colors.background,
            transform: [{ translateY: headerTranslateY }],
          },
        ]}
      >
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Text style={[styles.title, { color: colors.text }]}>欲しい漫画</Text>
              <Pressable
                accessibilityLabel={editMode ? '編集モードを終了' : '編集モードを開始'}
                onPress={toggleEditMode}
                style={[
                  styles.headerEditButton,
                  {
                    backgroundColor: editMode ? colors.text : colors.surface,
                    borderColor: editMode ? colors.text : colors.border,
                  },
                ]}
              >
                <Ionicons
                  color={editMode ? colors.background : colors.text}
                  name={editMode ? 'checkmark' : 'create-outline'}
                  size={17}
                />
                <Text style={[styles.editModeText, { color: editMode ? colors.background : colors.text }]}>
                  {editMode ? '完了' : '編集'}
                </Text>
              </Pressable>
            </View>
            <Text style={[styles.copy, { color: colors.muted }]}>
              {editMode
                ? 'リスト内の編集、削除、スコア調整に集中できます。'
                : '購入候補を眺めながら、思いついた作品をすぐ追加できます。'}
            </Text>
          </View>
      </Animated.View>

      <ScrollView
        ref={scrollRef}
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingTop: headerHeight + 12 }]}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >

      <View style={[styles.quickAdd, { backgroundColor: colors.elevated }]}>
        <View style={styles.inputRow}>
          <TextInput
            onChangeText={(value) => {
              setTitle(value);
              setCandidates([]);
              setSelectedCandidate(null);
            }}
            placeholder="作品名、シリーズ名"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            style={[styles.titleInput, { backgroundColor: colors.input, color: colors.text }]}
            value={title}
            onSubmitEditing={() => void searchCandidates()}
          />
          <Pressable
            accessibilityLabel="シリーズ候補を検索"
            disabled={!trimmedTitle || candidateLoading}
            onPress={() => void searchCandidates()}
            style={[
              styles.addButton,
              { backgroundColor: colors.text },
              (!trimmedTitle || candidateLoading) && styles.disabledButton,
            ]}
          >
            <Ionicons color={colors.background} name={candidateLoading ? 'hourglass-outline' : 'search'} size={21} />
          </Pressable>
        </View>

        {candidateLoading ? (
          <View style={styles.searchStatus}>
            <Ionicons color={colors.muted} name="sync-outline" size={16} />
            <Text style={[styles.copyStrong, { color: colors.muted }]}>候補を検索中...</Text>
          </View>
        ) : null}

        {candidates.length > 0 ? (
          <View style={styles.candidateList}>
            {candidates.map((candidate) => {
              const selected =
                selectedCandidate &&
                normalizeSeriesKey(selectedCandidate.seriesTitle) === normalizeSeriesKey(candidate.seriesTitle);
              return (
                <Pressable
                  key={`${candidate.source}-${candidate.seriesTitle}`}
                  onPress={() => setSelectedCandidate(candidate)}
                  style={[
                    styles.candidateCard,
                    {
                      backgroundColor: selected ? colors.surface : colors.input,
                      borderColor: selected ? colors.text : colors.border,
                    },
                  ]}
                >
                  <BookCover
                    placeholderText="No Cover"
                    style={styles.candidateCover}
                    thumbnailUrl={candidate.coverUrl}
                  />
                  <View style={styles.candidateBody}>
                    <Text numberOfLines={1} style={[styles.candidateTitle, { color: colors.text }]}>
                      {candidate.seriesTitle}
                    </Text>
                    <Text numberOfLines={1} style={[styles.candidateMeta, { color: colors.muted }]}>
                      {[candidate.author, candidate.publisher, candidate.source].filter(Boolean).join(' / ')}
                    </Text>
                    <Text numberOfLines={1} style={[styles.candidateSample, { color: colors.muted }]}>
                      {candidate.sampleTitle}
                    </Text>
                  </View>
                  <Ionicons
                    color={selected ? colors.text : colors.muted}
                    name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                  />
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View style={styles.priorityRow}>
          {priorityOptions.map((option) => {
            const selected = option.key === selectedPriority.key;
            return (
              <Pressable
                key={option.key}
                onPress={() => setSelectedPriority(option)}
                style={[
                  styles.priorityChip,
                  { borderColor: selected ? colors.text : colors.border },
                  selected && { backgroundColor: colors.text },
                ]}
              >
                <Ionicons color={selected ? colors.background : colors.text} name={option.icon} size={16} />
                <Text style={[styles.priorityText, { color: selected ? colors.background : colors.text }]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable onPress={() => setMemoOpen((current) => !current)} style={styles.memoToggle}>
          <Ionicons color={colors.muted} name={memoOpen ? 'chevron-up' : 'create-outline'} size={16} />
          <Text style={[styles.copyStrong, { color: colors.muted }]}>
            {memoOpen ? 'メモを閉じる' : 'メモを追加'}
          </Text>
        </Pressable>

        {memoOpen ? (
          <TextInput
            multiline
            onChangeText={setNote}
            placeholder="例: セール時に買う、紙で集めたい"
            placeholderTextColor={colors.muted}
            style={[styles.noteInput, { backgroundColor: colors.input, color: colors.text }]}
            value={note}
          />
        ) : null}

        <Pressable
          accessibilityLabel="欲しい漫画に追加"
          disabled={!trimmedTitle || (candidates.length > 1 && !selectedCandidate)}
          onPress={submit}
          style={[
            styles.primaryAddButton,
            { backgroundColor: colors.text },
            (!trimmedTitle || (candidates.length > 1 && !selectedCandidate)) && styles.disabledButton,
          ]}
        >
          <Ionicons color={colors.background} name="add-circle-outline" size={18} />
          <Text style={[styles.primaryAddText, { color: colors.background }]}>
            {selectedCandidate ? '選択したシリーズを追加' : '入力したシリーズを追加'}
          </Text>
        </Pressable>
      </View>

      {!editMode ? (
        <View
          onLayout={(event) => setOverviewHeight(event.nativeEvent.layout.height)}
          style={[styles.overview, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={styles.overviewMain}>
            <View style={[styles.overviewIcon, { backgroundColor: colors.text }]}>
              <Ionicons color={colors.background} name="cart-outline" size={22} />
            </View>
            <View style={styles.overviewText}>
              <Text style={[styles.overviewTitle, { color: colors.text }]}>次に買いたい本を整理</Text>
              <Text style={[styles.copy, { color: colors.muted }]}>
                優先度を付けておくと、セールや書店で迷いにくくなります。
              </Text>
            </View>
          </View>
          <View style={styles.statRow}>
            <StatBox label="候補" value={`${items.length}`} />
            <StatBox label="最優先" value={`${highPriorityCount}`} />
          </View>
        </View>
      ) : null}

      {editMode && lastDeleted ? (
        <View style={[styles.undoBar, { backgroundColor: colors.elevated, borderColor: colors.border }]}>
          <Text style={[styles.copyStrong, { color: colors.text }]} numberOfLines={1}>
            {lastDeleted.title}を削除しました
          </Text>
          <Pressable onPress={undoDelete} style={[styles.undoButton, { borderColor: colors.border }]}>
            <Text style={[styles.smallButtonText, { color: colors.text }]}>元に戻す</Text>
          </Pressable>
        </View>
      ) : null}

      {!editMode && topItems.length > 0 ? (
        <View onLayout={(event) => setTopSectionHeight(event.nativeEvent.layout.height)} style={styles.topSection}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.summaryTitle, { color: colors.text }]}>今の上位候補</Text>
            <Text style={[styles.copyStrong, { color: colors.muted }]}>上位{topItems.length}件</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.topCandidateList}
          >
            {topItems.map((item, index) => (
              <View key={item.id} style={[styles.topCandidateCard, { borderColor: colors.border }]}>
                <View style={styles.topCoverWrap}>
                  <BookCover
                    thumbnailUrl={findCoverUrl(item.title) ?? item.coverUrl}
                    style={styles.topCover}
                    placeholderText="No Cover"
                  />
                  <View style={[styles.topRankBadge, { backgroundColor: colors.text }]}>
                    <Text style={[styles.topRankText, { color: colors.background }]}>#{index + 1}</Text>
                  </View>
                </View>
                <Text style={[styles.topCandidateTitle, { color: colors.text }]} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={[styles.copyStrong, { color: colors.muted }]}>{item.score}点</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {items.length === 0 ? (
        <View style={[styles.emptyBox, { borderColor: colors.border }]}>
          <Ionicons color={colors.muted} name="cart-outline" size={30} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>購入候補はまだありません</Text>
          <Text style={[styles.copy, { color: colors.muted }]}>
            気になった作品をここに置いておくと、あとで優先順位と購入先をすぐ確認できます。
          </Text>
          <View style={styles.emptyHints}>
            <View style={[styles.emptyHint, { backgroundColor: colors.elevated }]}>
              <Ionicons color={colors.text} name="add-circle-outline" size={16} />
              <Text style={[styles.copyStrong, { color: colors.text }]}>タイトルを入力</Text>
            </View>
            <View style={[styles.emptyHint, { backgroundColor: colors.elevated }]}>
              <Ionicons color={colors.text} name="star-outline" size={16} />
              <Text style={[styles.copyStrong, { color: colors.text }]}>優先度を選択</Text>
            </View>
            <View style={[styles.emptyHint, { backgroundColor: colors.elevated }]}>
              <Ionicons color={colors.text} name="open-outline" size={16} />
              <Text style={[styles.copyStrong, { color: colors.text }]}>購入候補へ</Text>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.list}>
          {displayItems.map((item, index) => (
            <Pressable
              accessibilityLabel={`${item.title}を長押しして編集`}
              key={item.id}
              onLongPress={() => startEditing(item)}
              style={[styles.card, { borderColor: colors.border }]}
            >
              <View style={styles.cardHeader}>
                <Text style={[styles.rankText, { color: colors.text }]}>#{index + 1}</Text>
                <BookCover
                  thumbnailUrl={findCoverUrl(item.title) ?? item.coverUrl}
                  style={styles.cover}
                  placeholderText="No Cover"
                />
                <View style={styles.cardBody}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>{item.title}</Text>
                  <View style={styles.metaRow}>
                    <Text style={[styles.scorePill, { backgroundColor: colors.elevated, color: colors.text }]}>
                      {priorityLabel(item.score)}
                    </Text>
                    <Text style={[styles.copy, { color: colors.muted }]}>{item.score}点</Text>
                  </View>
                  {item.note ? <Text style={[styles.copy, { color: colors.muted }]}>{item.note}</Text> : null}
                </View>
              </View>

              {editMode && editingId === item.id ? (
                <View style={styles.editBox}>
                  <TextInput
                    onChangeText={setEditingTitle}
                    placeholder="作品名"
                    placeholderTextColor={colors.muted}
                    style={[styles.editInput, { backgroundColor: colors.input, color: colors.text }]}
                    value={editingTitle}
                  />
                  <TextInput
                    multiline
                    onChangeText={setEditingNote}
                    placeholder="メモ"
                    placeholderTextColor={colors.muted}
                    style={[styles.editNoteInput, { backgroundColor: colors.input, color: colors.text }]}
                    value={editingNote}
                  />
                  <View style={styles.editActions}>
                    <Pressable
                      onPress={() => setEditingId(null)}
                      style={[styles.smallButton, { borderColor: colors.border }]}
                    >
                      <Text style={[styles.smallButtonText, { color: colors.text }]}>キャンセル</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => submitEdit(item)}
                      style={[styles.smallButton, { backgroundColor: colors.text, borderColor: colors.text }]}
                    >
                      <Text style={[styles.smallButtonText, { color: colors.background }]}>保存</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              <View style={styles.actions}>
                <Pressable
                  onPress={() => void openPurchaseCandidate(item)}
                  style={[styles.smallButton, { borderColor: colors.border }]}
                >
                  <Ionicons color={colors.text} name="open-outline" size={16} />
                  <Text style={[styles.smallButtonText, { color: colors.text }]}>購入候補</Text>
                </Pressable>
                {editMode ? (
                  <>
                    <Pressable
                      accessibilityLabel={`${item.title}を編集`}
                      onPress={() => startEditing(item)}
                      style={[styles.iconButton, { borderColor: colors.border }]}
                    >
                      <Ionicons color={colors.text} name="create-outline" size={16} />
                    </Pressable>
                    <View style={styles.scoreButtons}>
                      <Pressable
                        accessibilityLabel={`${item.title}の優先度を上げる`}
                        onPress={() => updateItem(item.id, { score: item.score + 5 })}
                        style={[styles.iconButton, { borderColor: colors.border }]}
                      >
                        <Ionicons color={colors.text} name="arrow-up" size={16} />
                      </Pressable>
                      <Pressable
                        accessibilityLabel={`${item.title}の優先度を下げる`}
                        onPress={() => updateItem(item.id, { score: item.score - 5 })}
                        style={[styles.iconButton, { borderColor: colors.border }]}
                      >
                        <Ionicons color={colors.text} name="arrow-down" size={16} />
                      </Pressable>
                    </View>
                    <Pressable
                      accessibilityLabel={`${item.title}を削除`}
                      onPress={() => removeItem(item)}
                      style={[styles.iconButton, { borderColor: colors.danger }]}
                    >
                      <Ionicons color={colors.danger} name="trash-outline" size={16} />
                    </Pressable>
                  </>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      )}
      </ScrollView>

    </View>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();

  return (
    <View style={[styles.statBox, { backgroundColor: colors.elevated }]}>
      <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 16, padding: 18, paddingBottom: 40, paddingTop: 24 },
  headerShell: { left: 0, paddingHorizontal: 18, paddingTop: 24, position: 'absolute', right: 0, top: 0, zIndex: 10 },
  header: { gap: 2, paddingBottom: 8 },
  headerTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  title: { fontSize: 20, fontWeight: '900' },
  headerEditButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 9,
  },
  editModeText: { fontSize: 12, fontWeight: '900' },
  copy: { fontSize: 12, lineHeight: 16 },
  copyStrong: { fontSize: 13, fontWeight: '800', lineHeight: 18 },
  overview: { borderRadius: 8, borderWidth: 1, gap: 14, padding: 14 },
  overviewMain: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  overviewIcon: {
    alignItems: 'center',
    borderRadius: 8,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  overviewText: { flex: 1, gap: 3 },
  overviewTitle: { fontSize: 16, fontWeight: '900' },
  statRow: { flexDirection: 'row', gap: 8 },
  statBox: { alignItems: 'center', borderRadius: 8, flex: 1, gap: 2, minHeight: 56, justifyContent: 'center' },
  statValue: { fontSize: 17, fontWeight: '900' },
  statLabel: { fontSize: 11, fontWeight: '800' },
  quickAdd: { borderRadius: 8, gap: 12, padding: 12 },
  inputRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  titleInput: { borderRadius: 8, flex: 1, fontSize: 16, height: 46, paddingHorizontal: 12 },
  addButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 46,
    justifyContent: 'center',
    width: 48,
  },
  disabledButton: { opacity: 0.45 },
  searchStatus: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  candidateList: { gap: 8 },
  candidateCard: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 76,
    padding: 8,
  },
  candidateCover: { borderRadius: 5, height: 58, width: 40 },
  candidateBody: { flex: 1, gap: 3 },
  candidateTitle: { fontSize: 14, fontWeight: '900' },
  candidateMeta: { fontSize: 12, fontWeight: '700' },
  candidateSample: { fontSize: 12, lineHeight: 16 },
  primaryAddButton: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 6,
    height: 42,
    justifyContent: 'center',
  },
  primaryAddText: { fontSize: 14, fontWeight: '900' },
  priorityRow: { flexDirection: 'row', gap: 8 },
  priorityChip: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    height: 38,
    justifyContent: 'center',
  },
  priorityText: { fontSize: 13, fontWeight: '800' },
  memoToggle: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  noteInput: {
    borderRadius: 8,
    fontSize: 14,
    minHeight: 64,
    paddingHorizontal: 12,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  topSection: { gap: 10 },
  sectionTitleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  summaryTitle: { fontSize: 15, fontWeight: '900' },
  topCandidateList: { gap: 10, paddingRight: 8 },
  topCandidateCard: { borderRadius: 8, borderWidth: 1, gap: 7, padding: 10, width: 124 },
  topCoverWrap: { alignItems: 'center' },
  topCover: { borderRadius: 6, height: 132, width: 90 },
  topRankBadge: {
    alignItems: 'center',
    borderRadius: 999,
    bottom: 6,
    height: 26,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    width: 42,
  },
  topRankText: { fontSize: 12, fontWeight: '900' },
  topCandidateTitle: { fontSize: 13, fontWeight: '900', lineHeight: 18, minHeight: 36 },
  emptyBox: { alignItems: 'center', borderRadius: 8, borderWidth: 1, gap: 6, padding: 18 },
  emptyTitle: { fontSize: 16, fontWeight: '800' },
  emptyHints: { alignSelf: 'stretch', gap: 8, marginTop: 8 },
  emptyHint: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 12,
  },
  list: { gap: 10 },
  card: { borderRadius: 8, borderWidth: 1, gap: 10, padding: 12 },
  cardHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  rankText: { fontSize: 14, fontWeight: '900', minWidth: 34, paddingTop: 2 },
  cover: { borderRadius: 6, height: 84, width: 58 },
  cardBody: { flex: 1, gap: 5 },
  cardTitle: { fontSize: 16, fontWeight: '900' },
  metaRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  scorePill: {
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  undoBar: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  undoButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  editBox: { gap: 8, marginLeft: 116 },
  editInput: { borderRadius: 8, fontSize: 15, height: 42, paddingHorizontal: 12 },
  editNoteInput: {
    borderRadius: 8,
    fontSize: 14,
    minHeight: 58,
    paddingHorizontal: 12,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  editActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  actions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginLeft: 116 },
  scoreButtons: { flexDirection: 'row', gap: 8 },
  smallButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    height: 36,
    paddingHorizontal: 10,
  },
  smallButtonText: { fontSize: 13, fontWeight: '800' },
  iconButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
});

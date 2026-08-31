import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAppTheme } from '../../store/ThemeContext';

type SeriesDisplayMode = 'detail' | 'cover' | 'title';

type HomeToolbarProps = {
  translateY: Animated.Value;
  viewMode: 'series' | 'books';
  seriesDisplayMode: SeriesDisplayMode;
  visibleCount: number;
  totalCount: number;
  requiresAuth: boolean;
  loading: boolean;
  error: string | null;
  query: string;
  filterActive: boolean;
  myPageHasNotification: boolean;
  filterLabel: string;
  sortLabel: string;
  onHeightChange: (height: number) => void;
  onQueryChange: (query: string) => void;
  onSeriesDisplayModeChange: () => void;
  onViewModeChange: (mode: 'series' | 'books') => void;
  onOpenMyPage: () => void;
  onOpenFilter: () => void;
  onOpenSort: () => void;
  onRetry: () => void;
};

export function HomeToolbar({
  translateY,
  viewMode,
  seriesDisplayMode,
  visibleCount,
  totalCount,
  requiresAuth,
  loading,
  error,
  query,
  filterActive,
  myPageHasNotification,
  filterLabel,
  sortLabel,
  onHeightChange,
  onQueryChange,
  onSeriesDisplayModeChange,
  onViewModeChange,
  onOpenMyPage,
  onOpenFilter,
  onOpenSort,
  onRetry,
}: HomeToolbarProps) {
  const { colors } = useAppTheme();
  const countLabel = requiresAuth
    ? '設定からログインしてください'
    : visibleCount === totalCount
      ? viewMode === 'series'
        ? `全${totalCount}シリーズ`
        : `全${totalCount}冊`
      : viewMode === 'series'
        ? `${visibleCount}シリーズを表示`
        : `${visibleCount}冊を表示`;
  const displayIcon =
    seriesDisplayMode === 'cover' ? 'grid-outline' : seriesDisplayMode === 'title' ? 'list-outline' : 'albums-outline';

  return (
    <Animated.View
      onLayout={(event) => onHeightChange(Math.ceil(event.nativeEvent.layout.height))}
      style={[
        styles.toolbar,
        {
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={styles.titleRow}>
        <View style={styles.titleBlock}>
          <Text adjustsFontSizeToFit minimumFontScale={0.82} numberOfLines={1} style={[styles.title, { color: colors.text }]}>本の間</Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: colors.muted }]}>{countLabel}</Text>
        </View>
        <Pressable
          accessibilityLabel={myPageHasNotification ? "マイページを開く。未確認の新刊通知があります" : "マイページを開く"}
          onPress={onOpenMyPage}
          style={[styles.accountButton, { borderColor: colors.border }]}
        >
          <Ionicons color={colors.text} name="person-circle-outline" size={24} />
          {myPageHasNotification ? <View style={[styles.activeDot, { backgroundColor: colors.primary }]} /> : null}
        </Pressable>
      </View>

      {loading && (
        <View style={[styles.notice, styles.loadingNotice, { backgroundColor: colors.elevated }]}>
          <ActivityIndicator color={colors.text} size="small" />
          <Text style={[styles.noticeText, { color: colors.text }]}>蔵書を読み込んでいます</Text>
        </View>
      )}

      {!!error && (
        <View style={[styles.notice, styles.errorNotice, { backgroundColor: '#ffeceb' }]}>
          <Text style={[styles.noticeText, styles.errorNoticeText, { color: colors.danger }]}>{error}</Text>
          <Pressable accessibilityLabel="蔵書を再読み込み" onPress={onRetry} style={[styles.retryPill, { borderColor: colors.danger }]}
          >
            <Ionicons color={colors.danger} name="refresh" size={13} />
            <Text style={[styles.retryPillText, { color: colors.danger }]}>再試行</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder="本棚を検索"
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          style={[styles.search, { backgroundColor: colors.input, color: colors.text }]}
        />
        {viewMode === 'series' && (
          <Pressable
            accessibilityLabel="シリーズの表示方法を変更"
            onPress={onSeriesDisplayModeChange}
            style={[styles.iconButton, { borderColor: colors.border }]}
          >
            <Ionicons color={colors.text} name={displayIcon} size={18} />
          </Pressable>
        )}
        <Pressable
          accessibilityLabel={`表示条件を開く。現在: ${filterLabel}`}
          onPress={onOpenFilter}
          style={[
            styles.iconButton,
            { borderColor: filterActive ? colors.primary : colors.border },
            filterActive && { backgroundColor: colors.elevated },
          ]}
        >
          <Ionicons color={filterActive ? colors.primary : colors.text} name="filter" size={18} />
          {filterActive ? <View style={[styles.activeDot, { backgroundColor: colors.primary }]} /> : null}
        </Pressable>
        <Pressable
          accessibilityLabel={`並び替えを開く。現在: ${sortLabel}`}
          onPress={onOpenSort}
          style={[styles.iconButton, { borderColor: colors.border }]}
        >
          <Ionicons color={colors.text} name="swap-vertical" size={18} />
        </Pressable>
      </View>

      <View style={[styles.modeSwitch, { backgroundColor: colors.elevated }]}>
        {([
          ['series', 'シリーズ'],
          ['books', '全冊'],
        ] as const).map(([value, label]) => (
          <Pressable
            accessibilityLabel={`${label}表示に切り替え`}
            key={value}
            onPress={() => onViewModeChange(value)}
            style={[styles.modeButton, viewMode === value && { backgroundColor: colors.text }]}
          >
            <Text
              style={[
                styles.modeText,
                { color: viewMode === value ? colors.background : colors.muted },
              ]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    borderBottomWidth: 1,
    left: 0,
    paddingBottom: 10,
    paddingHorizontal: 18,
    paddingTop: 12,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 20,
  },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  titleBlock: { flex: 1 },
  title: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0,
  },
  subtitle: { alignSelf: 'flex-start', fontSize: 11, marginTop: 4, opacity: 0.68 },
  accountButton: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  notice: {
    borderRadius: 8,
    justifyContent: 'center',
    marginTop: 8,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  loadingNotice: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  noticeText: { fontSize: 13, fontWeight: '700' },
  errorNotice: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
  errorNoticeText: { flex: 1, lineHeight: 18 },
  retryPill: { alignItems: 'center', borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 4, height: 28, justifyContent: 'center', paddingHorizontal: 10 },
  retryPillText: { fontSize: 12, fontWeight: '900' },
  searchRow: { alignItems: 'center', flexDirection: 'row', gap: 6, marginTop: 8 },
  search: {
    borderRadius: 8,
    flex: 1,
    fontSize: 14,
    height: 38,
    paddingHorizontal: 12,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 42,
  },
  activeDot: {
    borderRadius: 4,
    height: 6,
    position: 'absolute',
    right: 8,
    top: 7,
    width: 6,
  },
  modeSwitch: {
    borderRadius: 8,
    flexDirection: 'row',
    marginTop: 8,
    padding: 3,
  },
  modeButton: {
    alignItems: 'center',
    borderRadius: 6,
    flex: 1,
    height: 32,
    justifyContent: 'center',
  },
  modeText: { fontSize: 12, fontWeight: '800' },
});

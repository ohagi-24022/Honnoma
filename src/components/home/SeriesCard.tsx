import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { SeriesPublicationInfo } from '../../lib/bookApis';
import { SeriesGroup } from '../../lib/seriesSelectors';
import { useAppTheme } from '../../store/ThemeContext';
import { BookCover } from '../BookCover';

const NOTIFICATION_ACTIVE_COLOR = '#ffcc00';

type SeriesCardProps = {
  group: SeriesGroup;
  missingVolumes: number[];
  unownedVolumes: number[];
  completionRate: number;
  favorite: boolean;
  showPublishedLatestVolume: boolean;
  publicationInfo?: SeriesPublicationInfo;
  seriesCoverUrl?: string;
  publisherOverride?: string;
  refreshing: boolean;
  refreshDisabled: boolean;
  notificationAvailable: boolean;
  notificationEnabled: boolean;
  notificationUpdating: boolean;
  onToggleFavorite: () => void;
  onToggleNotification: () => void;
  onRefresh: () => void;
  onReport: () => void;
};

function formatVolumeList(label: string, volumes: number[]) {
  const visible = volumes.slice(0, 5);
  const remainder = volumes.length - visible.length;
  return `${label}: ${visible.join(', ')}巻${remainder > 0 ? ` ほか${remainder}巻` : ''}`;
}

export function SeriesCard({
  group,
  missingVolumes,
  unownedVolumes,
  completionRate,
  favorite,
  showPublishedLatestVolume,
  publicationInfo,
  seriesCoverUrl,
  publisherOverride,
  refreshing,
  refreshDisabled,
  notificationAvailable,
  notificationEnabled,
  notificationUpdating,
  onToggleFavorite,
  onToggleNotification,
  onRefresh,
  onReport,
}: SeriesCardProps) {
  const { colors } = useAppTheme();
  const router = useRouter();
  const isAllRead = group.ownedCount > 0 && group.readCount === group.ownedCount;
  const publicationSuffix = publicationInfo?.isCompleted ? ' / 完結' : publicationInfo ? ' / 未完結' : '';
  const publisherText = publisherOverride ?? group.publishers.join(', ');
  const latestLabel = showPublishedLatestVolume
    ? publicationInfo
      ? ` / 刊行 ${publicationInfo.latestVolume}巻まで${publicationSuffix}`
      : ' / 刊行巻数 未取得'
    : group.latestVolume
      ? ` / ${group.latestVolume}巻まで`
      : '';
  const hasTopBadges =
    group.unreadCount > 0 ||
    isAllRead ||
    missingVolumes.length > 0 ||
    unownedVolumes.length > 0 ||
    publicationInfo?.isCompleted;

  const openSeries = () => router.navigate(`/series/${encodeURIComponent(group.title)}`);

  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <TouchableOpacity
        accessibilityLabel={`${group.title}\u306e\u60c5\u5831\u3092\u5831\u544a`}
        activeOpacity={0.7}
        hitSlop={10}
        onPress={onReport}
        style={styles.reportButton}
      >
        <Ionicons color={colors.muted} name="flag-outline" size={15} />
      </TouchableOpacity>
      <Pressable accessibilityLabel={`${group.title}の詳細を開く`} onPress={openSeries} style={styles.coverPress}>
        <BookCover
          thumbnailUrl={seriesCoverUrl ?? group.representative.thumbnailUrl}
          isbn={group.representative.isbn}
          style={styles.cover}
        />
      </Pressable>
      <View style={styles.body}>
        <Pressable accessibilityLabel={`${group.title}の詳細を開く`} onPress={openSeries}>
          {hasTopBadges ? (
            <View style={styles.topBadgeRow}>
              {group.unreadCount > 0 && <Text style={styles.unreadBadge}>未読 {group.unreadCount}</Text>}
              {isAllRead && <Text style={styles.readBadge}>読了</Text>}
              {missingVolumes.length > 0 && (
                <Text style={styles.missingBadge}>{formatVolumeList('不足', missingVolumes)}</Text>
              )}
              {unownedVolumes.length > 0 && (
                <Text style={styles.unownedBadge}>{formatVolumeList('未所持', unownedVolumes)}</Text>
              )}
              {publicationInfo?.isCompleted && <Text style={styles.completedBadge}>完結</Text>}
            </View>
          ) : null}
        </Pressable>

        <View style={styles.headingRow}>
          <Pressable accessibilityLabel={`${group.title}の詳細を開く`} onPress={openSeries} style={styles.titlePress}>
            <Text numberOfLines={2} style={[styles.title, { color: colors.text }]}>
              {group.title}
            </Text>
          </Pressable>
          <View style={styles.actions}>
            <TouchableOpacity
              accessibilityLabel={
                favorite ? `${group.title}のお気に入りを解除` : `${group.title}をお気に入りに追加`
              }
              activeOpacity={0.75}
              onPress={onToggleFavorite}
              style={[styles.iconButton, { borderColor: colors.border }]}
            >
              <Ionicons
                color={favorite ? colors.primary : colors.muted}
                name={favorite ? 'bookmark' : 'bookmark-outline'}
                size={18}
              />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityLabel={
                notificationEnabled ? `${group.title}の新刊通知を解除` : `${group.title}の新刊通知を有効化`
              }
              activeOpacity={0.75}
              disabled={notificationUpdating}
              onPress={onToggleNotification}
              style={[
                styles.iconButton,
                { borderColor: colors.border },
                !notificationAvailable && styles.inactiveAction,
                notificationUpdating && styles.disabled,
              ]}
            >
              <Ionicons
                color={notificationEnabled ? NOTIFICATION_ACTIVE_COLOR : colors.muted}
                name={notificationEnabled ? 'notifications' : 'notifications-outline'}
                size={18}
              />
            </TouchableOpacity>
            <TouchableOpacity
                accessibilityLabel={`${group.title}の刊行情報を更新`}
                activeOpacity={0.75}
                disabled={refreshDisabled}
                onPress={onRefresh}
                style={[
                  styles.iconButton,
                  { borderColor: colors.border },
                  refreshDisabled && styles.disabled,
                ]}
              >
                {refreshing ? (
                  <ActivityIndicator color={colors.text} size="small" />
                ) : (
                  <Ionicons color={colors.text} name="refresh" size={17} />
                )}
            </TouchableOpacity>
          </View>
        </View>

        <Pressable accessibilityLabel={`${group.title}の詳細を開く`} onPress={openSeries}>
          <Text style={[styles.meta, { color: colors.muted }]}>
            {group.ownedCount}冊所持{latestLabel}
          </Text>
          {(group.authors.length > 0 || publisherText) && (
            <Text numberOfLines={2} style={[styles.credits, { color: colors.muted }]}>
              {[group.authors.join(', '), publisherText].filter(Boolean).join(' / ')}
            </Text>
          )}
          <View style={[styles.progressTrack, { backgroundColor: colors.elevated }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: missingVolumes.length > 0 || unownedVolumes.length > 0 ? '#765100' : colors.success,
                  width: `${Math.min(completionRate, 100)}%`,
                },
              ]}
            />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
    minHeight: 144,
    padding: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  coverPress: { borderRadius: 4 },
  cover: { borderRadius: 4, height: 120, width: 82 },
  body: { flex: 1, minWidth: 0, paddingBottom: 4 },
  topBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  headingRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 8 },
  titlePress: { flex: 1 },
  title: { fontSize: 15, fontWeight: '800', lineHeight: 19 },
  actions: { alignItems: 'center', flexDirection: 'row', gap: 6, zIndex: 2 },
  reportButton: {
    alignItems: 'center',
    height: 26,
    justifyContent: 'center',
    position: 'absolute',
    right: 6,
    top: 6,
    width: 26,
    zIndex: 3,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 34,
  },
  disabled: { opacity: 0.4 },
  inactiveAction: { opacity: 0.55 },
  meta: { fontSize: 12, marginTop: 6 },
  credits: { fontSize: 11, lineHeight: 16, marginTop: 4 },
  progressTrack: {
    alignSelf: 'stretch',
    borderRadius: 999,
    height: 5,
    marginTop: 10,
    marginBottom: 2,
    overflow: 'hidden',
  },
  progressFill: { height: '100%' },
  unreadBadge: {
    backgroundColor: '#f5f5f5',
    borderRadius: 6,
    color: '#333333',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  readBadge: {
    backgroundColor: '#e8f7ee',
    borderRadius: 6,
    color: '#128a3f',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  missingBadge: {
    backgroundColor: '#fff7df',
    borderRadius: 6,
    color: '#765100',
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  unownedBadge: {
    backgroundColor: '#eef5ff',
    borderRadius: 6,
    color: '#1f5f9e',
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  completedBadge: {
    backgroundColor: '#eeeeee',
    borderRadius: 6,
    color: '#222222',
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
});

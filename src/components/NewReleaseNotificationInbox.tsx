import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { archiveNewReleaseNotifications, getNewReleaseNotificationLogs, markNewReleaseNotificationsSeen, NewReleaseNotificationLog } from '../lib/newReleaseNotifications';
import { useAppTheme } from '../store/ThemeContext';

export function useNewReleaseNotificationInbox(userId?: string) {
  const [view, setView] = useState<'new' | 'history'>('new');
  const [logs, setLogs] = useState<NewReleaseNotificationLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const request = ++generation.current;
    if (!userId) {
      setLogs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextLogs = await getNewReleaseNotificationLogs(userId, 80, view);
      if (request !== generation.current) return;
      setLogs(nextLogs);
      if (view === 'new' && nextLogs.length > 0) {
        // Keep this visit's contents visible. Only the fetched IDs move to history;
        // notifications arriving during this request remain new.
        await archiveNewReleaseNotifications(userId, nextLogs.flatMap(log => log.id ? [log.id] : []));
        await markNewReleaseNotificationsSeen(userId, nextLogs[0].createdAt);
      }
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : '通知を取得できませんでした。');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [userId, view]);

  useFocusEffect(useCallback(() => {
    setLogs([]);
    void load();
    return () => { generation.current += 1; };
  }, [load]));

  const changeView = (nextView: 'new' | 'history') => {
    if (nextView === view) return;
    setLogs([]);
    setView(nextView);
  };
  return { view, changeView, logs, loading, error, load };
}

export function NewReleaseNotificationInbox({ inbox }: { inbox: ReturnType<typeof useNewReleaseNotificationInbox> }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <Text style={[styles.title, { color: colors.text }]}>新刊通知</Text>
        <Pressable accessibilityLabel="新刊通知を更新" accessibilityRole="button" disabled={inbox.loading}
          onPress={() => void inbox.load()} style={[styles.refresh, { borderColor: colors.border }]}>
          {inbox.loading ? <ActivityIndicator color={colors.text} /> : <Ionicons name="refresh" color={colors.text} size={18} />}
        </Pressable>
      </View>
      <View style={[styles.tabs, { backgroundColor: colors.elevated }]}>
        {(['new', 'history'] as const).map(view => (
          <Pressable key={view} accessibilityRole="button" accessibilityState={{ selected: inbox.view === view }}
            onPress={() => inbox.changeView(view)} style={[styles.tab, inbox.view === view && { backgroundColor: colors.text }]}>
            <Text style={[styles.tabText, { color: inbox.view === view ? colors.background : colors.muted }]}>
              {view === 'new' ? '新着' : '履歴'}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={[styles.copy, { color: colors.muted }]}>
        {inbox.view === 'new' ? '表示した通知は次回から履歴に移ります。あとから履歴で確認できます。' : '確認した新刊通知を表示しています。'}
      </Text>
      {inbox.error ? <Text style={[styles.copy, { color: colors.danger }]}>{inbox.error}</Text> : null}
      {inbox.loading && inbox.logs.length === 0 ? <ActivityIndicator color={colors.text} /> : null}
      {!inbox.error && !inbox.loading && inbox.logs.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="notifications-outline" color={colors.muted} size={28} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>{inbox.view === 'new' ? '新しい通知はありません' : '通知履歴はまだありません'}</Text>
        </View>
      ) : null}
      {inbox.logs.map(log => (
        <View key={log.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.background }]}>
          <Ionicons name="notifications" color="#facc15" size={18} />
          <View style={styles.body}>
            <Text style={[styles.logTitle, { color: colors.text }]}>{log.seriesTitle}</Text>
            <Text style={[styles.copy, { color: colors.muted }]}>{log.volumeNumber ? `${log.volumeNumber}巻の新刊候補` : '新刊候補'}</Text>
            <Text style={[styles.meta, { color: colors.muted }]}>{formatDate(log.createdAt)} / {formatStatus(log.status)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function formatStatus(status: string) {
  if (status === 'sent') return '通知済み';
  if (status === 'pending') return '通知待ち';
  if (status === 'error' || status === 'failed') return '通知失敗';
  return status;
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}
const styles = StyleSheet.create({
  container: { gap: 12 }, heading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  title: { fontSize: 20, fontWeight: '900' }, refresh: { alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderWidth: 1, borderRadius: 8 },
  tabs: { flexDirection: 'row', padding: 4, borderRadius: 8 }, tab: { flex: 1, alignItems: 'center', padding: 10, borderRadius: 6 },
  tabText: { fontSize: 14, fontWeight: '800' }, copy: { fontSize: 13, lineHeight: 18 }, empty: { alignItems: 'center', gap: 8, padding: 18 },
  emptyTitle: { fontSize: 16, fontWeight: '800' }, card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 8, padding: 12 },
  body: { flex: 1, gap: 4 }, logTitle: { fontSize: 15, fontWeight: '800' }, meta: { fontSize: 12, lineHeight: 16 },
});

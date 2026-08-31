import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, router, useNavigation } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { HeaderBackButton } from '../src/components/HeaderBackButton';
import {
  getNewReleaseNotificationLogs,
  markNewReleaseNotificationsSeen,
  NewReleaseNotificationLog,
} from '../src/lib/newReleaseNotifications';
import { useAuth } from '../src/store/AuthContext';
import { useAppTheme } from '../src/store/ThemeContext';

export default function NotificationsScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { colors } = useAppTheme();
  const [logs, setLogs] = useState<NewReleaseNotificationLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const goBack = useCallback(() => {
    router.replace('/(tabs)/settings');
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => <HeaderBackButton accessibilityLabel="設定に戻る" onPress={goBack} />,
    });
  }, [goBack, navigation]);

  const loadLogs = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const nextLogs = await getNewReleaseNotificationLogs(user.id, 80);
      setLogs(nextLogs);
      await markNewReleaseNotificationsSeen(user.id);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '通知履歴を取得できませんでした。');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  if (!user) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={[styles.centerScreen, { backgroundColor: colors.background }]}>
          <Ionicons color={colors.muted} name="notifications-outline" size={42} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>ログインが必要です</Text>
          <Text style={[styles.emptyCopy, { color: colors.muted }]}>
            新刊通知の詳細はログイン後に確認できます。
          </Text>
          <Link href="/(tabs)/settings" asChild>
            <Pressable style={[styles.button, { borderColor: colors.border }]}>
              <Text style={[styles.buttonText, { color: colors.text }]}>設定へ移動</Text>
            </Pressable>
          </Link>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void loadLogs()} />}
        style={[styles.screen, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: colors.text }]}>新刊通知</Text>
            <Text style={[styles.copy, { color: colors.muted }]}>
              通知本文では伏せているシリーズ名と巻数をここで確認できます。
            </Text>
          </View>
          <Pressable
            accessibilityLabel="通知履歴を更新"
            onPress={() => void loadLogs()}
            style={[styles.iconButton, { borderColor: colors.border }]}
          >
            {loading ? (
              <ActivityIndicator color={colors.text} size="small" />
            ) : (
              <Ionicons color={colors.text} name="refresh" size={17} />
            )}
          </Pressable>
        </View>
      </View>

      {error ? <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text> : null}

      {logs.length === 0 && !loading ? (
        <View style={[styles.emptyBox, { backgroundColor: colors.elevated }]}>
          <Ionicons color={colors.muted} name="notifications-outline" size={28} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>通知はまだありません</Text>
          <Text style={[styles.emptyCopy, { color: colors.muted }]}>
            通知ONのシリーズに新刊候補が見つかると、ここに詳細が表示されます。
          </Text>
        </View>
      ) : (
        <View style={styles.logList}>
          {logs.map((log) => (
            <View key={log.id ?? `${log.seriesTitle}-${log.volumeNumber}-${log.createdAt}`} style={[styles.logCard, { borderColor: colors.border }]}>
              <View style={[styles.logIcon, { backgroundColor: colors.elevated }]}>
                <Ionicons color="#facc15" name="notifications" size={18} />
              </View>
              <View style={styles.logBody}>
                <Text style={[styles.logTitle, { color: colors.text }]}>{log.seriesTitle}</Text>
                <Text style={[styles.copy, { color: colors.muted }]}>
                  {log.volumeNumber ? `${log.volumeNumber}巻の新刊候補` : '新刊候補'}
                </Text>
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {formatDate(log.createdAt)} / {formatStatus(log.status)}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
      </ScrollView>
    </View>
  );
}

function formatStatus(status: string) {
  if (status === 'sent') return '通知済み';
  if (status === 'pending') return '通知待ち';
  if (status === 'error') return '通知失敗';
  return status;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 18, padding: 18, paddingBottom: 40 },
  centerScreen: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  header: { gap: 4 },
  headerRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  headerText: { flex: 1 },
  title: { fontSize: 24, fontWeight: '900' },
  copy: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  iconButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  button: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    marginTop: 16,
    paddingHorizontal: 18,
  },
  buttonText: { fontSize: 14, fontWeight: '800' },
  errorText: { fontSize: 13, lineHeight: 18 },
  emptyBox: { alignItems: 'center', borderRadius: 8, gap: 6, padding: 18 },
  emptyTitle: { fontSize: 16, fontWeight: '800', marginTop: 8, textAlign: 'center' },
  emptyCopy: { fontSize: 13, lineHeight: 18, marginTop: 4, textAlign: 'center' },
  logList: { gap: 10 },
  logCard: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  logIcon: { alignItems: 'center', borderRadius: 8, height: 34, justifyContent: 'center', width: 34 },
  logBody: { flex: 1 },
  logTitle: { fontSize: 15, fontWeight: '800' },
  meta: { fontSize: 12, lineHeight: 16, marginTop: 6 },
});

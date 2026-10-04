import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, router, useNavigation } from 'expo-router';
import { useCallback, useLayoutEffect } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { HeaderBackButton } from '../src/components/HeaderBackButton';
import { NewReleaseNotificationInbox, useNewReleaseNotificationInbox } from '../src/components/NewReleaseNotificationInbox';
import { useAuth } from '../src/store/AuthContext';
import { useAppTheme } from '../src/store/ThemeContext';

export default function NotificationsScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { colors } = useAppTheme();
  const inbox = useNewReleaseNotificationInbox(user?.id);
  const goBack = useCallback(() => {
    router.replace('/(tabs)/settings');
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => <HeaderBackButton accessibilityLabel="設定に戻る" onPress={goBack} />,
    });
  }, [goBack, navigation]);

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
            <Pressable style={StyleSheet.flatten([styles.button, { borderColor: colors.border }])}>
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
        refreshControl={<RefreshControl refreshing={inbox.loading} onRefresh={() => void inbox.load()} />}
        style={[styles.screen, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
        <NewReleaseNotificationInbox inbox={inbox} />
      </ScrollView>
    </View>
  );
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

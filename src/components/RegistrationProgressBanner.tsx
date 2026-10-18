import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRegistrationProgress } from '../store/RegistrationProgressContext';
import { useAppTheme } from '../store/ThemeContext';

export function RegistrationProgressBanner() {
  const { job, dismiss } = useRegistrationProgress();
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  if (!job) return null;
  const running = job.status === 'running';
  const title = running ? `一括登録中 ${job.completed}／${job.total}冊 完了` : `${job.added}冊を追加しました`;
  return <View pointerEvents="box-none" style={[styles.position, { bottom: insets.bottom + 88 }]}>
    <View accessibilityLiveRegion="polite" style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.row}>
        {running && <ActivityIndicator size="small" color={colors.primary} />}
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Text numberOfLines={1} style={{ color: colors.muted }}>{running
            ? `${job.currentTitle || job.seriesTitle} の情報を取得・登録しています`
            : `${job.seriesTitle} ／ 登録済み ${job.skipped}冊・追加できなかった本 ${job.failures.length}冊`}</Text>
        </View>
        {!running && <Pressable accessibilityRole="button" accessibilityLabel="一括登録の結果を閉じる" onPress={dismiss} style={styles.button}>
          <Text style={{ color: colors.primary }}>閉じる</Text>
        </Pressable>}
      </View>
      {running && <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: job.total, now: job.completed }} style={[styles.track, { backgroundColor: colors.elevated }]}>
        <View style={{ height: 3, width: `${job.total ? job.completed / job.total * 100 : 0}%`, backgroundColor: colors.primary }} />
      </View>}
      {!running && job.failures.length > 0 && <Pressable accessibilityRole="button" onPress={() => Alert.alert('追加できなかった本', job.failures.map((failure) => `${failure.title}: ${failure.message}`).join('\n'))} style={styles.button}>
        <Text style={{ color: colors.primary }}>追加できなかった本を確認</Text>
      </Pressable>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  position: { position: 'absolute', left: 12, right: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  copy: { flex: 1, gap: 3 },
  title: { fontSize: 14, fontWeight: '700' },
  button: { padding: 8 },
  track: { height: 3, borderRadius: 2, overflow: 'hidden' },
});

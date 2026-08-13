import Ionicons from '@expo/vector-icons/Ionicons';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useLayoutEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../src/store/ThemeContext';

const REPORT_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdKp8lpTAanF885CYChSQUafiQhV-YWXgQmeVTUxFu1612s3Q/viewform';

const reportReasonLabels = {
  cover: '表紙が違う',
  publication: '刊行巻数・完結情報が違う',
  publisher: '出版社・作者が違う',
  title: 'タイトル・シリーズ分けが違う',
  other: 'その他の情報が違う',
} as const;

type ReportReason = keyof typeof reportReasonLabels;

function getReasonLabel(reason?: string | string[]) {
  const value = Array.isArray(reason) ? reason[0] : reason;
  if (value && value in reportReasonLabels) return reportReasonLabels[value as ReportReason];
  return reportReasonLabels.other;
}

export default function ReportScreen() {
  const { colors } = useAppTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ series?: string; reason?: string; from?: string }>();
  const seriesTitle = useMemo(() => decodeURIComponent(params.series ?? ''), [params.series]);
  const reasonLabel = getReasonLabel(params.reason);

  const goBack = () => {
    if (navigation.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)');
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: '情報の報告',
      headerLeft: () => (
        <Pressable accessibilityLabel="前の画面に戻る" hitSlop={10} onPress={goBack} style={styles.headerBackButton}>
          <Ionicons color={colors.text} name="chevron-back" size={24} />
          <Text style={[styles.headerBackText, { color: colors.text }]}>戻る</Text>
        </Pressable>
      ),
    });
  }, [colors.text, navigation, router]);

  const openForm = async () => {
    await WebBrowser.openBrowserAsync(REPORT_FORM_URL);
  };

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
        <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.heroIcon, { backgroundColor: colors.elevated }]}>
            <Ionicons color={colors.text} name="flag-outline" size={24} />
          </View>
          <View style={styles.heroTextWrap}>
            <Text style={[styles.title, { color: colors.text }]}>書籍情報を報告</Text>
            <Text style={[styles.copy, { color: colors.muted }]}>表紙、刊行巻数、完結情報などが違う場合に送信できます。報告内容を確認したうえで、開発側で補正します。</Text>
          </View>
        </View>

        <View style={[styles.section, { borderColor: colors.border }]}>
          <InfoRow label="対象" value={seriesTitle || 'シリーズ未指定'} />
          <InfoRow label="報告内容" value={reasonLabel} />
        </View>

        <View style={[styles.note, { backgroundColor: colors.elevated }]}>
          <Text style={[styles.noteText, { color: colors.muted }]}>フォームが開いたら、対象シリーズ名と正しい情報を入力してください。アプリ内の情報は、報告確認後に開発側で補正します。</Text>
        </View>

        <Pressable accessibilityLabel="報告フォームを開く" onPress={openForm} style={[styles.primaryButton, { backgroundColor: colors.text }]}>
          <Ionicons color={colors.background} name="open-outline" size={18} />
          <Text style={[styles.primaryButtonText, { color: colors.background }]}>報告フォームを開く</Text>
        </Pressable>
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.muted }]}>{label}</Text>
      <Text selectable style={[styles.infoValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 14, padding: 16, paddingBottom: 32 },
  headerBackButton: { alignItems: 'center', flexDirection: 'row', gap: 2, minHeight: 36, paddingRight: 8 },
  headerBackText: { fontSize: 15, fontWeight: '800' },
  hero: { alignItems: 'flex-start', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 14 },
  heroIcon: { alignItems: 'center', borderRadius: 8, height: 44, justifyContent: 'center', width: 44 },
  heroTextWrap: { flex: 1, gap: 5 },
  title: { fontSize: 18, fontWeight: '900' },
  copy: { fontSize: 13, lineHeight: 19 },
  section: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 14 },
  infoRow: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#d5d5d5', gap: 5, paddingVertical: 13 },
  infoLabel: { fontSize: 12, fontWeight: '800' },
  infoValue: { flexShrink: 1, fontSize: 15, fontWeight: '800', lineHeight: 21 },
  note: { borderRadius: 8, padding: 13 },
  noteText: { fontSize: 12, fontWeight: '700', lineHeight: 18 },
  primaryButton: { alignItems: 'center', borderRadius: 8, flexDirection: 'row', gap: 8, height: 48, justifyContent: 'center' },
  primaryButtonText: { fontSize: 14, fontWeight: '900' },
});

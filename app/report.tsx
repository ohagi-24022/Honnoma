import Ionicons from '@expo/vector-icons/Ionicons';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useLayoutEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../src/store/ThemeContext';

const REPORT_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdKp8lpTAanF885CYChSQUafiQhV-YWXgQmeVTUxFu1612s3Q/viewform';

const t = {
  back: '\u623b\u308b',
  backAccessibility: '\u524d\u306e\u753b\u9762\u306b\u623b\u308b',
  reportTitle: '\u60c5\u5831\u306e\u5831\u544a',
  fromSuffix: '\u304b\u3089\u5831\u544a',
  bookReportCopy: '\u3053\u306e\u5dfb\u306e\u8868\u7d19\u3001\u30bf\u30a4\u30c8\u30eb\u3001\u7d39\u4ecb\u6587\u3001\u51fa\u7248\u793e\u306a\u3069\u304c\u9055\u3046\u5834\u5408\u306b\u5831\u544a\u3067\u304d\u307e\u3059\u3002',
  seriesReportCopy: '\u30b7\u30ea\u30fc\u30ba\u5206\u3051\u3001\u520a\u884c\u5dfb\u6570\u3001\u5b8c\u7d50\u60c5\u5831\u3001\u4ee3\u8868\u8868\u7d19\u306a\u3069\u304c\u9055\u3046\u5834\u5408\u306b\u5831\u544a\u3067\u304d\u307e\u3059\u3002',
  source: '\u5831\u544a\u5143',
  series: '\u30b7\u30ea\u30fc\u30ba',
  targetSeries: '\u5bfe\u8c61\u30b7\u30ea\u30fc\u30ba',
  targetBook: '\u5bfe\u8c61\u5dfb',
  bookTitle: '\u5dfb\u30bf\u30a4\u30c8\u30eb',
  volume: '\u5dfb\u6570',
  reason: '\u5185\u5bb9',
  requestedCheck: '\u78ba\u8a8d\u3057\u3066\u307b\u3057\u3044\u5185\u5bb9',
  noSeries: '\u30b7\u30ea\u30fc\u30ba\u672a\u6307\u5b9a',
  memoTitle: '\u30d5\u30a9\u30fc\u30e0\u306b\u8cbc\u308a\u4ed8\u3051\u308b\u30e1\u30e2',
  openForm: '\u5831\u544a\u30d5\u30a9\u30fc\u30e0\u3092\u958b\u304f',
};

const reportReasonLabels = {
  cover: '\u8868\u7d19\u304c\u9055\u3046',
  publication: '\u520a\u884c\u5dfb\u6570\u30fb\u5b8c\u7d50\u60c5\u5831\u304c\u9055\u3046',
  publisher: '\u51fa\u7248\u793e\u30fb\u4f5c\u8005\u304c\u9055\u3046',
  title: '\u30bf\u30a4\u30c8\u30eb\u30fb\u30b7\u30ea\u30fc\u30ba\u5206\u3051\u304c\u9055\u3046',
  book: '\u5dfb\u3054\u3068\u306e\u60c5\u5831\u304c\u9055\u3046',
  other: '\u305d\u306e\u4ed6\u306e\u60c5\u5831\u304c\u9055\u3046',
} as const;

const reportSourceLabels = {
  home: '\u672c\u68da\u306e\u30b7\u30ea\u30fc\u30ba\u30ab\u30fc\u30c9',
  series: '\u30b7\u30ea\u30fc\u30ba\u8a73\u7d30',
  book: '\u5dfb\u306e\u8a73\u7d30',
  ranking: '\u30e9\u30f3\u30ad\u30f3\u30b0',
  wishlist: '\u6b32\u3057\u3044\u30ea\u30b9\u30c8',
  unknown: '\u30a2\u30d7\u30ea\u5185',
} as const;

type ReportReason = keyof typeof reportReasonLabels;
type ReportSource = keyof typeof reportSourceLabels;

type ReportParams = {
  series?: string;
  title?: string;
  volume?: string;
  isbn?: string;
  reason?: string;
  from?: string;
};

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function getReasonLabel(reason?: string | string[]) {
  const value = firstParam(reason);
  if (value && value in reportReasonLabels) return reportReasonLabels[value as ReportReason];
  return reportReasonLabels.other;
}

function getSourceLabel(source?: string | string[]) {
  const value = firstParam(source);
  if (value && value in reportSourceLabels) return reportSourceLabels[value as ReportSource];
  return reportSourceLabels.unknown;
}

function decodeParam(value?: string | string[]) {
  const raw = firstParam(value) ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default function ReportScreen() {
  const { colors } = useAppTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<ReportParams>();
  const seriesTitle = useMemo(() => decodeParam(params.series), [params.series]);
  const bookTitle = useMemo(() => decodeParam(params.title), [params.title]);
  const volume = useMemo(() => decodeParam(params.volume), [params.volume]);
  const isbn = useMemo(() => decodeParam(params.isbn), [params.isbn]);
  const reasonLabel = getReasonLabel(params.reason);
  const sourceLabel = getSourceLabel(params.from);
  const isBookReport = firstParam(params.from) === 'book';

  const reportMemo = useMemo(() => {
    return [
      `${t.source}: ${sourceLabel}`,
      seriesTitle ? `${t.series}: ${seriesTitle}` : null,
      bookTitle ? `${t.bookTitle}: ${bookTitle}` : null,
      volume ? `${t.volume}: ${volume}` : null,
      isbn ? `ISBN: ${isbn}` : null,
      `${t.reason}: ${reasonLabel}`,
    ]
      .filter(Boolean)
      .join('\n');
  }, [bookTitle, isbn, reasonLabel, seriesTitle, sourceLabel, volume]);

  const goBack = () => {
    if (navigation.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)');
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t.reportTitle,
      headerLeft: () => (
        <Pressable accessibilityLabel={t.backAccessibility} hitSlop={10} onPress={goBack} style={styles.headerBackButton}>
          <Ionicons color={colors.text} name="chevron-back" size={24} />
          <Text style={[styles.headerBackText, { color: colors.text }]}>{t.back}</Text>
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
          <Text style={[styles.title, { color: colors.text }]}>{sourceLabel}{t.fromSuffix}</Text>
          <Text style={[styles.copy, { color: colors.muted }]}>
            {isBookReport
              ? t.bookReportCopy
              : t.seriesReportCopy}
          </Text>
        </View>
      </View>

      <View style={[styles.section, { borderColor: colors.border }]}>
        <InfoRow label={t.source} value={sourceLabel} />
        <InfoRow label={t.targetSeries} value={seriesTitle || t.noSeries} />
        {bookTitle ? <InfoRow label={t.targetBook} value={bookTitle} /> : null}
        {volume ? <InfoRow label={t.volume} value={volume} /> : null}
        {isbn ? <InfoRow label="ISBN" value={isbn} /> : null}
        <InfoRow label={t.requestedCheck} value={reasonLabel} />
      </View>

      <View style={[styles.note, { backgroundColor: colors.elevated }]}>
        <Text style={[styles.noteTitle, { color: colors.text }]}>{t.memoTitle}</Text>
        <Text selectable style={[styles.noteText, { color: colors.muted }]}>{reportMemo}</Text>
      </View>

      <Pressable accessibilityLabel={t.openForm} onPress={openForm} style={[styles.primaryButton, { backgroundColor: colors.text }]}>
        <Ionicons color={colors.background} name="open-outline" size={18} />
        <Text style={[styles.primaryButtonText, { color: colors.background }]}>{t.openForm}</Text>
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
  infoRow: { borderBottomColor: '#d5d5d5', borderBottomWidth: StyleSheet.hairlineWidth, gap: 5, paddingVertical: 13 },
  infoLabel: { fontSize: 12, fontWeight: '800' },
  infoValue: { flexShrink: 1, fontSize: 15, fontWeight: '800', lineHeight: 21 },
  note: { borderRadius: 8, gap: 8, padding: 13 },
  noteTitle: { fontSize: 13, fontWeight: '900' },
  noteText: { fontSize: 12, fontWeight: '700', lineHeight: 18 },
  primaryButton: { alignItems: 'center', borderRadius: 8, flexDirection: 'row', gap: 8, height: 48, justifyContent: 'center' },
  primaryButtonText: { fontSize: 14, fontWeight: '900' },
});

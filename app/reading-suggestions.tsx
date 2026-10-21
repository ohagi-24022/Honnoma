import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { normalizeKanaReading } from '../src/lib/kana';
import { loadSeriesReadingCorrections, SeriesReadingCorrection } from '../src/lib/seriesReadingCorrections';
import { getKnownSeriesReading, normalizeSeriesKey } from '../src/lib/series';
import { submitSeriesReadingSuggestion } from '../src/lib/seriesReadingSuggestions';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/store/AuthContext';
import { useLibrary } from '../src/store/LibraryContext';
import { useAppTheme } from '../src/store/ThemeContext';

type ReadingTarget = {
  key: string;
  source: 'library' | 'global';
  title: string;
};

function normalizeReading(value?: string | null) {
  return normalizeKanaReading(value) ?? '';
}

export default function ReadingSuggestionsScreen() {
  const { colors } = useAppTheme();
  const { user } = useAuth();
  const { books, seriesGroups, updateBook } = useLibrary();
  const router = useRouter();
  const navigation = useNavigation();
  const [selectedSeriesKey, setSelectedSeriesKey] = useState('');
  const [targetMode, setTargetMode] = useState<'library' | 'global'>('library');
  const [suggestedReading, setSuggestedReading] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [globalTargets, setGlobalTargets] = useState<ReadingTarget[]>([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [readingCorrections, setReadingCorrections] = useState(new Map<string, SeriesReadingCorrection>());

  const libraryTargets = useMemo<ReadingTarget[]>(
    () =>
      seriesGroups.map((group) => ({
        key: normalizeSeriesKey(group.title),
        source: 'library',
        title: group.title,
      })),
    [seriesGroups],
  );
  const globalRequest = useRef(0);
  const globalMounted = useRef(true);
  useEffect(() => { globalMounted.current = true; return () => { globalMounted.current = false; globalRequest.current++; }; }, []);
  const activeTargets = targetMode === 'library' ? libraryTargets : globalTargets;
  const selectedTarget = useMemo(
    () => activeTargets.find((target) => target.key === selectedSeriesKey) ?? activeTargets[0],
    [activeTargets, selectedSeriesKey],
  );
  const filteredLibraryTargets = useMemo(() => {
    const query = libraryQuery.normalize('NFKC').trim().toLowerCase();
    const targets = query
      ? libraryTargets.filter((target) => target.title.normalize('NFKC').toLowerCase().includes(query))
      : libraryTargets;
    return targets;
  }, [libraryQuery, libraryTargets]);

  const currentReading = useMemo(() => {
    if (!selectedTarget) return '';
    const knownReading = normalizeReading(getKnownSeriesReading(selectedTarget.title));
    if (knownReading) return knownReading;
    const correctedReading = normalizeReading(readingCorrections.get(selectedTarget.key)?.correctedReading);
    if (correctedReading) return correctedReading;
    const candidate = books.find(
      (book) => normalizeSeriesKey(book.seriesTitle) === selectedTarget.key && (book.seriesReading || book.titleReading),
    );
    return normalizeReading(candidate?.seriesReading) || normalizeReading(candidate?.titleReading);
  }, [books, readingCorrections, selectedTarget]);

  const loadGlobalTargets = async () => {
    if (!user) { setGlobalTargets([]); setGlobalError('全体の候補はログイン後に利用できます。'); return; }
    if (!supabase) {
      setGlobalTargets([]);
      setGlobalError('現在みんなの候補を取得できません。しばらくしてからもう一度お試しください。');
      return;
    }
    if (globalLoading) return;
    const request = ++globalRequest.current;
    setGlobalLoading(true);
    setGlobalError(null);
    try {
      const { data, error } = await supabase.rpc('get_series_reading_report_candidates', { limit_count: 4 });
      if (error) throw error;
      if (!globalMounted.current || request !== globalRequest.current) return;
      const targets = ((data ?? []) as { series_title: string }[])
        .map((row) => ({ key: normalizeSeriesKey(row.series_title), source: 'global' as const, title: row.series_title }));
      setGlobalTargets(targets);
      setSelectedSeriesKey(targets[0]?.key ?? '');
    } catch (error) {
      if (!globalMounted.current || request !== globalRequest.current) return;
      setGlobalTargets([]);
      setGlobalError(error instanceof Error ? error.message : 'みんなの候補を取得できませんでした。');
    } finally {
      if (globalMounted.current && request === globalRequest.current) setGlobalLoading(false);
    }
  };

  useEffect(() => {
    navigation.setOptions({ title: '読み方の報告' });
  }, [navigation]);


  useEffect(() => {
    let mounted = true;
    loadSeriesReadingCorrections()
      .then((corrections) => {
        if (mounted) setReadingCorrections(corrections);
      })
      .catch((correctionError) => {
        console.warn('Failed to load series reading corrections', correctionError);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedSeriesKey && selectedTarget) {
      setSelectedSeriesKey(selectedTarget.key);
    }
  }, [selectedSeriesKey, selectedTarget]);

  useEffect(() => { setSuggestedReading(''); setNote(''); }, [selectedTarget?.key, targetMode]);


  const submit = async () => {
    if (!user) {
      Alert.alert('ログインが必要です', '読み方の報告は、重複投稿を抑えるためログイン後に利用できます。');
      return;
    }
    if (!selectedTarget) {
      Alert.alert('シリーズを選択してください', '対象シリーズを選んでから報告できます。');
      return;
    }
    const cleanedReading = normalizeKanaReading(suggestedReading);
    if (!cleanedReading) {
      Alert.alert('読み方を入力してください', `「${selectedTarget.title}」の読み方をひらがなで入力してください。`);
      return;
    }

    setSubmitting(true);
    try {
      await submitSeriesReadingSuggestion({
        userId: user.id,
        seriesTitle: selectedTarget.title,
        currentReading,
        suggestedReading: cleanedReading,
        note,
      });
      const localTargets = books.filter((book) => normalizeSeriesKey(book.seriesTitle) === selectedTarget.key);
      if (localTargets.length > 0) {
        await Promise.all(localTargets.map((book) => updateBook(book.id, { seriesReading: cleanedReading })));
      }
      setSuggestedReading('');
      setNote('');
      if (targetMode === 'global') void loadGlobalTargets();
      Alert.alert(
        '報告しました',
        localTargets.length > 0
          ? 'この本棚の読み方にも反映しました。投稿内容は集計し、今後の補正候補として確認します。'
          : '投稿された読み方は集計し、今後の並び替えや補正候補として確認します。',
      );
    } catch (error) {
      Alert.alert('報告できませんでした', error instanceof Error ? error.message : 'もう一度お試しください。');
    } finally {
      setSubmitting(false);
    }
  };

  const renderTarget = (target: ReadingTarget) => {
    const selected = target.key === selectedTarget?.key;
    return (
      <Pressable
        accessibilityLabel={`${target.title}を読み方報告の対象にする`}
        key={`${target.source}-${target.key}`}
        onPress={() => setSelectedSeriesKey(target.key)}
        style={[
          styles.seriesRow,
          { backgroundColor: selected ? colors.text : colors.surface, borderColor: colors.border },
        ]}
      >
        <Text numberOfLines={1} style={[styles.seriesTitle, { color: selected ? colors.background : colors.text }]}>
          {target.title}
        </Text>
        {selected ? <Ionicons color={colors.background} name="checkmark" size={18} /> : null}
      </Pressable>
    );
  };

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      <View style={styles.compactHero}>
        <Text style={[styles.title, { color: colors.text }]}>シリーズ名の読み方を報告</Text>
        <Text style={[styles.copy, { color: colors.muted }]}>五十音順や補正候補に使う読み方を送れます。</Text>
      </View>

      {!user ? (
        <View style={[styles.notice, { backgroundColor: colors.elevated }]}>
          <Text style={[styles.noticeTitle, { color: colors.text }]}>ログイン後に利用できます</Text>
          <Text style={[styles.copy, { color: colors.muted }]}>同じシリーズへの重複投稿を防ぐため、アカウント単位で報告を保存します。</Text>
        </View>
      ) : null}

      <View style={[styles.picker, { borderColor: colors.border }]}>
        <View style={[styles.modeSwitch, { backgroundColor: colors.elevated }]}>
          <Pressable
            accessibilityLabel="自分の本棚から選ぶ"
            onPress={() => { setTargetMode('library'); setSelectedSeriesKey(libraryTargets[0]?.key ?? ''); }}
            style={[styles.modeButton, targetMode === 'library' && { backgroundColor: colors.text }]}
          >
            <Ionicons color={targetMode === 'library' ? colors.background : colors.text} name="library-outline" size={16} />
            <Text style={[styles.modeButtonText, { color: targetMode === 'library' ? colors.background : colors.text }]}>本棚</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="みんなの候補から選ぶ"
            onPress={() => { setTargetMode('global'); setSelectedSeriesKey(globalTargets[0]?.key ?? ''); if (!globalTargets.length) void loadGlobalTargets(); }}
            style={[styles.modeButton, targetMode === 'global' && { backgroundColor: colors.text }]}
          >
            <Ionicons color={targetMode === 'global' ? colors.background : colors.text} name="earth-outline" size={16} />
            <Text style={[styles.modeButtonText, { color: targetMode === 'global' ? colors.background : colors.text }]}>全体</Text>
          </Pressable>
        </View>

        {targetMode === 'library' ? (
          <View style={styles.compactSection}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>自分の本棚</Text>
              <Text style={[styles.sectionMeta, { color: colors.muted }]}>{libraryTargets.length}件</Text>
            </View>
            <View style={[styles.searchBox, { backgroundColor: colors.input }]}>
              <Ionicons color={colors.muted} name="search-outline" size={18} />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={setLibraryQuery}
                placeholder="シリーズ名で絞り込み"
                placeholderTextColor={colors.muted}
                style={[styles.searchInput, { color: colors.text }]}
                value={libraryQuery}
              />
            </View>
            {libraryTargets.length === 0 ? <Text style={[styles.copy, { color: colors.muted }]}>本棚にシリーズがありません。</Text> : null}
            {libraryTargets.length > 0 && filteredLibraryTargets.length === 0 ? (
              <Text style={[styles.copy, { color: colors.muted }]}>一致するシリーズがありません。</Text>
            ) : null}
            <ScrollView nestedScrollEnabled persistentScrollbar showsVerticalScrollIndicator style={styles.librarySeriesScroll} contentContainerStyle={styles.seriesList}>
              {filteredLibraryTargets.map(renderTarget)}
            </ScrollView>
          </View>
        ) : (
          <View style={styles.compactSection}>
            <View style={styles.sectionHeader}>
              <View style={styles.headerTextBlock}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>みんなの候補</Text>
                <Text style={[styles.copy, { color: colors.muted }]}>報告の少ない作品からランダムに表示します。</Text>
              </View>
              <Pressable accessibilityLabel="みんなの候補を見る" disabled={globalLoading || submitting} onPress={() => void loadGlobalTargets()} style={styles.textButton}>
                <Ionicons color={colors.text} name="refresh-outline" size={16} />
                <Text style={[styles.textButtonLabel, { color: colors.text }]}>{globalLoading ? '取得中' : '候補を見る'}</Text>
              </Pressable>
            </View>
            <View style={styles.seriesList}>
              {globalError ? <Text style={[styles.copy, { color: colors.muted }]}>{globalError}</Text> : null}
              {!globalError && globalTargets.length === 0 ? (
                <Text style={[styles.copy, { color: colors.muted }]}>{globalLoading ? '候補を探しています。' : '現在、報告できる候補がありません。'}</Text>
              ) : null}
              {globalTargets.map(renderTarget)}
            </View>
          </View>
        )}
      </View>

      <View style={[styles.form, { borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.muted }]}>選択中</Text>
        <Text style={[styles.currentTitle, { color: colors.text }]}>{selectedTarget?.title ?? '未選択'}</Text>
        <Text style={[styles.label, { color: colors.muted }]}>現在の読み方</Text>
        <Text style={[styles.currentReading, { color: colors.text }]}>{currentReading || '未取得'}</Text>
        <Text style={[styles.label, { color: colors.muted }]}>正しいと思う読み方</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSuggestedReading}
          placeholder={currentReading ? `例: ${currentReading}` : selectedTarget ? `「${selectedTarget.title}」の読み方` : 'シリーズを選んでください'}
          placeholderTextColor={colors.muted}
          style={[styles.input, { backgroundColor: colors.input, color: colors.text }]}
          value={suggestedReading}
        />
        <Text style={[styles.label, { color: colors.muted }]}>補足</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          onChangeText={setNote}
          placeholder="表記ゆれや参考にした情報があれば入力できます"
          placeholderTextColor={colors.muted}
          style={[styles.textarea, { backgroundColor: colors.input, color: colors.text }]}
          value={note}
        />
        <Pressable
          accessibilityLabel="読み方を報告する"
          disabled={submitting || !selectedTarget}
          onPress={() => void submit()}
          style={[styles.primaryButton, { backgroundColor: colors.text }, (submitting || !selectedTarget) && styles.disabled]}
        >
          <Text style={[styles.primaryButtonText, { color: colors.background }]}>{submitting ? '送信中' : '報告する'}</Text>
        </Pressable>
      </View>

      <Pressable accessibilityLabel="前の画面に戻る" onPress={() => router.back()} style={[styles.secondaryButton, { borderColor: colors.border }]}>
        <Text style={[styles.secondaryButtonText, { color: colors.text }]}>戻る</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 12, padding: 16, paddingBottom: 28 },
  hero: { alignItems: 'flex-start', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 14 },
  heroIcon: { alignItems: 'center', borderRadius: 8, height: 44, justifyContent: 'center', width: 44 },
  heroText: { flex: 1, gap: 5 },
  compactHero: { gap: 3 },
  title: { fontSize: 17, fontWeight: '900' },
  copy: { fontSize: 12, lineHeight: 17 },
  notice: { borderRadius: 8, gap: 6, padding: 13 },
  noticeTitle: { fontSize: 14, fontWeight: '900' },
  section: { gap: 10 },
  picker: { borderRadius: 8, borderWidth: 1, gap: 8, padding: 10 },
  compactSection: { gap: 8 },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  headerTextBlock: { flex: 1, gap: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '900' },
  sectionMeta: { fontSize: 12, fontWeight: '800' },
  searchBox: { alignItems: 'center', borderRadius: 8, flexDirection: 'row', gap: 8, minHeight: 38, paddingHorizontal: 10 },
  searchInput: { flex: 1, fontSize: 14, minHeight: 38, paddingVertical: 0 },
  modeSwitch: { borderRadius: 8, flexDirection: 'row', gap: 4, padding: 4 },
  modeButton: { alignItems: 'center', borderRadius: 7, flex: 1, flexDirection: 'row', gap: 6, height: 34, justifyContent: 'center' },
  modeButtonText: { fontSize: 13, fontWeight: '900' },
  seriesList: { gap: 6 },
  librarySeriesScroll: { maxHeight: 166 },
  seriesRow: { alignItems: 'center', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 8, minHeight: 36, paddingHorizontal: 10 },
  seriesTitle: { flex: 1, fontSize: 14, fontWeight: '800' },
  textButton: { alignItems: 'center', flexDirection: 'row', gap: 4, minHeight: 36, paddingHorizontal: 4 },
  textButtonLabel: { fontSize: 13, fontWeight: '900' },
  form: { borderRadius: 8, borderWidth: 1, gap: 7, padding: 12 },
  label: { fontSize: 12, fontWeight: '800', marginTop: 4 },
  currentTitle: { fontSize: 15, fontWeight: '900', lineHeight: 21 },
  currentReading: { fontSize: 15, fontWeight: '800' },
  input: { borderRadius: 8, fontSize: 15, minHeight: 40, paddingHorizontal: 12 },
  textarea: { borderRadius: 8, fontSize: 14, minHeight: 64, padding: 10, textAlignVertical: 'top' },
  primaryButton: { alignItems: 'center', borderRadius: 8, height: 42, justifyContent: 'center', marginTop: 4 },
  primaryButtonText: { fontSize: 14, fontWeight: '900' },
  secondaryButton: { alignItems: 'center', borderRadius: 8, borderWidth: 1, height: 44, justifyContent: 'center' },
  secondaryButtonText: { fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.4 },
});

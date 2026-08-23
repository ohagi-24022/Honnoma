import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { normalizeSeriesKey } from '../src/lib/series';
import { submitSeriesReadingSuggestion } from '../src/lib/seriesReadingSuggestions';
import { useAuth } from '../src/store/AuthContext';
import { useLibrary } from '../src/store/LibraryContext';
import { useAppTheme } from '../src/store/ThemeContext';

function normalizeReading(value?: string | null) {
  const normalized = value?.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!normalized || /[\u3400-\u9fff]/.test(normalized)) return '';
  return normalized;
}

export default function ReadingSuggestionsScreen() {
  const { colors } = useAppTheme();
  const { user } = useAuth();
  const { books, seriesGroups } = useLibrary();
  const router = useRouter();
  const navigation = useNavigation();
  const [selectedSeriesKey, setSelectedSeriesKey] = useState(seriesGroups[0] ? normalizeSeriesKey(seriesGroups[0].title) : '');
  const [suggestedReading, setSuggestedReading] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selectedGroup = useMemo(
    () => seriesGroups.find((group) => normalizeSeriesKey(group.title) === selectedSeriesKey) ?? seriesGroups[0],
    [selectedSeriesKey, seriesGroups],
  );

  const currentReading = useMemo(() => {
    if (!selectedGroup) return '';
    const key = normalizeSeriesKey(selectedGroup.title);
    const candidate = books.find((book) => normalizeSeriesKey(book.seriesTitle) === key && (book.seriesReading || book.titleReading));
    return normalizeReading(candidate?.seriesReading) || normalizeReading(candidate?.titleReading);
  }, [books, selectedGroup]);

  useEffect(() => {
    navigation.setOptions({ title: '読み方の報告' });
  }, [navigation]);

  useEffect(() => {
    if (!selectedSeriesKey && seriesGroups[0]) {
      setSelectedSeriesKey(normalizeSeriesKey(seriesGroups[0].title));
    }
  }, [selectedSeriesKey, seriesGroups]);

  const submit = async () => {
    if (!user) {
      Alert.alert('ログインが必要です', '読み方の報告は、重複投稿を抑えるためログイン後に利用できます。');
      return;
    }
    if (!selectedGroup) {
      Alert.alert('シリーズがありません', '本棚にシリーズを登録してから報告できます。');
      return;
    }
    if (!suggestedReading.trim()) {
      Alert.alert('読み方を入力してください', '例: とにかくかわいい');
      return;
    }

    setSubmitting(true);
    try {
      await submitSeriesReadingSuggestion({
        userId: user.id,
        seriesTitle: selectedGroup.title,
        currentReading,
        suggestedReading,
        note,
      });
      setSuggestedReading('');
      setNote('');
      Alert.alert('報告しました', '投稿された読み方は集計し、今後の並び替えや補正候補として確認します。');
    } catch (error) {
      Alert.alert('報告できませんでした', error instanceof Error ? error.message : 'もう一度お試しください。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={[styles.heroIcon, { backgroundColor: colors.elevated }]}>
          <Ionicons color={colors.text} name="text-outline" size={24} />
        </View>
        <View style={styles.heroText}>
          <Text style={[styles.title, { color: colors.text }]}>シリーズ名の読み方を報告</Text>
          <Text style={[styles.copy, { color: colors.muted }]}>
            読み方の候補を集計し、五十音順の並び替えやタイトル補正の精度改善に使います。
          </Text>
        </View>
      </View>

      {!user ? (
        <View style={[styles.notice, { backgroundColor: colors.elevated }]}>
          <Text style={[styles.noticeTitle, { color: colors.text }]}>ログイン後に利用できます</Text>
          <Text style={[styles.copy, { color: colors.muted }]}>
            同じシリーズへの重複投稿を防ぐため、アカウント単位で報告を保存します。
          </Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>対象シリーズ</Text>
        <View style={styles.seriesList}>
          {seriesGroups.length === 0 ? (
            <Text style={[styles.copy, { color: colors.muted }]}>本棚にシリーズがありません。</Text>
          ) : (
            seriesGroups.map((group) => {
              const key = normalizeSeriesKey(group.title);
              const selected = key === selectedSeriesKey;
              return (
                <Pressable
                  accessibilityLabel={`${group.title}を読み方報告の対象にする`}
                  key={key}
                  onPress={() => setSelectedSeriesKey(key)}
                  style={[
                    styles.seriesRow,
                    { backgroundColor: selected ? colors.text : colors.surface, borderColor: colors.border },
                  ]}
                >
                  <Text numberOfLines={1} style={[styles.seriesTitle, { color: selected ? colors.background : colors.text }]}>
                    {group.title}
                  </Text>
                  {selected ? <Ionicons color={colors.background} name="checkmark" size={18} /> : null}
                </Pressable>
              );
            })
          )}
        </View>
      </View>

      <View style={[styles.form, { borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.muted }]}>現在の読み方</Text>
        <Text style={[styles.currentReading, { color: colors.text }]}>{currentReading || '未取得'}</Text>
        <Text style={[styles.label, { color: colors.muted }]}>正しいと思う読み方</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSuggestedReading}
          placeholder="例: とにかくかわいい"
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
          disabled={submitting || !selectedGroup}
          onPress={() => void submit()}
          style={[styles.primaryButton, { backgroundColor: colors.text }, (submitting || !selectedGroup) && styles.disabled]}
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
  content: { gap: 16, padding: 16, paddingBottom: 36 },
  hero: { alignItems: 'flex-start', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 14 },
  heroIcon: { alignItems: 'center', borderRadius: 8, height: 44, justifyContent: 'center', width: 44 },
  heroText: { flex: 1, gap: 5 },
  title: { fontSize: 18, fontWeight: '900' },
  copy: { fontSize: 13, lineHeight: 19 },
  notice: { borderRadius: 8, gap: 6, padding: 13 },
  noticeTitle: { fontSize: 14, fontWeight: '900' },
  section: { gap: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '900' },
  seriesList: { gap: 8 },
  seriesRow: { alignItems: 'center', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 8, minHeight: 44, paddingHorizontal: 12 },
  seriesTitle: { flex: 1, fontSize: 14, fontWeight: '800' },
  form: { borderRadius: 8, borderWidth: 1, gap: 9, padding: 14 },
  label: { fontSize: 12, fontWeight: '800', marginTop: 4 },
  currentReading: { fontSize: 15, fontWeight: '800' },
  input: { borderRadius: 8, fontSize: 16, minHeight: 44, paddingHorizontal: 12 },
  textarea: { borderRadius: 8, fontSize: 15, minHeight: 86, padding: 12, textAlignVertical: 'top' },
  primaryButton: { alignItems: 'center', borderRadius: 8, height: 46, justifyContent: 'center', marginTop: 6 },
  primaryButtonText: { fontSize: 14, fontWeight: '900' },
  secondaryButton: { alignItems: 'center', borderRadius: 8, borderWidth: 1, height: 44, justifyContent: 'center' },
  secondaryButtonText: { fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.4 },
});

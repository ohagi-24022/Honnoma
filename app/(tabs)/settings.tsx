import { useScrollToTop } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  disableNewReleaseNotifications,
  enableNewReleaseNotifications,
  syncNewReleaseSubscriptions,
} from '../../src/lib/newReleaseNotifications';
import { useAppSettings } from '../../src/store/AppSettingsContext';
import { useAuth } from '../../src/store/AuthContext';
import { useLibrary } from '../../src/store/LibraryContext';
import { ThemeMode, useAppTheme } from '../../src/store/ThemeContext';

const themeOptions: Array<{ label: string; value: ThemeMode }> = [
  { label: 'システム', value: 'system' },
  { label: 'ライト', value: 'light' },
  { label: 'ダーク', value: 'dark' },
];

export default function SettingsScreen() {
  const scrollRef = useRef<ScrollView>(null);
  const tabScrollToTopRef = useRef({
    scrollToTop: () => scrollRef.current?.scrollTo({ y: 0, animated: true }),
  });
  useScrollToTop(tabScrollToTopRef);
  const { configured, initializing, user, signIn, signOut } = useAuth();
  const { books, localImportCount, migrateLocalBooks, seriesGroups } = useLibrary();
  const {
    hydrated: appSettingsHydrated,
    newReleaseNotifications,
    setNewReleaseNotifications,
    openExternalPurchaseLinks,
    setOpenExternalPurchaseLinks,
    trackPurchasePrices,
    setTrackPurchasePrices,
  } = useAppSettings();
  const { colors, mode, setMode } = useAppTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [migrationSubmitting, setMigrationSubmitting] = useState(false);
  const [notificationSubmitting, setNotificationSubmitting] = useState(false);
  const [pendingNewReleaseSwitchValue, setPendingNewReleaseSwitchValue] = useState<boolean | null>(null);
  const displayedNewReleaseNotifications = pendingNewReleaseSwitchValue ?? newReleaseNotifications;

  useEffect(() => {
    if (pendingNewReleaseSwitchValue === null) return;
    if (newReleaseNotifications === pendingNewReleaseSwitchValue) {
      setPendingNewReleaseSwitchValue(null);
    }
  }, [newReleaseNotifications, pendingNewReleaseSwitchValue]);

  const submitAuth = async () => {
    if (!email.trim() || !password) {
      Alert.alert('本の間', 'メールアドレスとパスワードを入力してください。');
      return;
    }

    setAuthSubmitting(true);
    try {
      await signIn(email.trim(), password);
      setPassword('');
    } catch (error) {
      Alert.alert('本の間', error instanceof Error ? error.message : '認証に失敗しました。');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const submitSignOut = async () => {
    setAuthSubmitting(true);
    try {
      await signOut();
    } catch (error) {
      Alert.alert('本の間', error instanceof Error ? error.message : 'ログアウトに失敗しました。');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const submitLocalMigration = async () => {
    setMigrationSubmitting(true);
    try {
      const importedCount = await migrateLocalBooks();
      Alert.alert('移行が完了しました', `${importedCount}冊をクラウド本棚へ追加しました。`);
    } catch (error) {
      Alert.alert('移行できませんでした', error instanceof Error ? error.message : 'もう一度お試しください。');
    } finally {
      setMigrationSubmitting(false);
    }
  };

  const escapeCsvValue = (value?: string | number | null) => {
    const text = value === undefined || value === null ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };

  const exportCsv = async () => {
    const header = [
      'title',
      'seriesTitle',
      'volumeNumber',
      'isbn',
      'author',
      'publisher',
      'purchasePrice',
      'listPrice',
      'priceSource',
      'priceFetchedAt',
      'status',
      'createdAt',
    ];
    const rows = books.map((book) =>
      [
        book.title,
        book.seriesTitle,
        book.volumeNumber,
        book.isbn,
        book.author,
        book.publisher,
        book.purchasePrice,
        book.listPrice,
        book.priceSource,
        book.priceFetchedAt,
        book.status,
        book.createdAt,
      ]
        .map(escapeCsvValue)
        .join(','),
    );

    await Share.share({
      title: '本の間 CSV Export',
      message: [header.join(','), ...rows].join('\n'),
    });
  };

  const exportJson = async () => {
    await Share.share({
      title: '本の間 JSON Backup',
      message: JSON.stringify({ exportedAt: new Date().toISOString(), books }, null, 2),
    });
  };

  const toggleNewReleaseNotifications = async (enabled: boolean) => {
    setPendingNewReleaseSwitchValue(enabled);
    if (!user) {
      setPendingNewReleaseSwitchValue(null);
      Alert.alert(
        'ログインが必要です',
        '新刊通知はクラウド側でシリーズを定期確認するため、ログイン後に利用できます。',
      );
      return;
    }

    setNotificationSubmitting(true);
    try {
      if (enabled) {
        setNewReleaseNotifications(true);
        try {
          await syncNewReleaseSubscriptions(user.id, seriesGroups);
        } catch (subscriptionError) {
          Alert.alert(
            '通知設定をONにしました',
            `シリーズ通知の同期に失敗しました。設定はONのまま保存しました。\n${
              subscriptionError instanceof Error ? subscriptionError.message : '本棚を更新してからもう一度お試しください。'
            }`,
          );
          return;
        }
        try {
          await enableNewReleaseNotifications(user.id, seriesGroups);
        } catch (tokenError) {
          Alert.alert(
            'シリーズ通知設定を表示しました',
            `通知対象シリーズは選択できますが、端末通知の登録に失敗しました。\n${
              tokenError instanceof Error ? tokenError.message : 'もう一度お試しください。'
            }`,
          );
        }
      } else {
        setNewReleaseNotifications(false);
        try {
          await disableNewReleaseNotifications(user.id);
        } catch (disableError) {
          Alert.alert(
            '通知設定をOFFにしました',
            `端末通知の無効化に失敗しました。設定はOFFのまま保存しました。\n${
              disableError instanceof Error ? disableError.message : 'しばらくしてからもう一度お試しください。'
            }`,
          );
        }
      }
    } catch (error) {
      Alert.alert(
        '通知設定を更新できませんでした',
        error instanceof Error ? error.message : 'もう一度お試しください。',
      );
    } finally {
      setNotificationSubmitting(false);
    }
  };


  return (
    <ScrollView
      ref={scrollRef}
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      <View style={[styles.section, { borderBottomColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>アカウント</Text>
        {initializing ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.text} />
          </View>
        ) : user ? (
          <>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: colors.text }]}>ログイン中</Text>
                <Text style={[styles.rowCopy, { color: colors.muted }]}>{user.email}</Text>
              </View>
            </View>
            <Link href={{ pathname: '/account', params: { from: 'settings' } }} asChild>
              <Pressable
                style={[
                  styles.accountLink,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View style={[styles.accountIcon, { backgroundColor: colors.surface }]}>
                  <Ionicons color={colors.text} name="person-circle-outline" size={22} />
                </View>
                <View style={styles.rowText}>
                  <View style={styles.navigationTitleRow}>
                    <Ionicons color={colors.muted} name="chevron-forward" size={16} />
                    <Text style={[styles.rowTitle, { color: colors.text }]}>{'\u30de\u30a4\u30da\u30fc\u30b8'}</Text>
                  </View>
                  <Text style={[styles.rowCopy, { color: colors.muted }]}>
                    {'\u901a\u77e5\u5c65\u6b74\u3001\u8cfc\u5165\u30fb\u652f\u51fa\u30b5\u30de\u30ea\u30fc\u3001\u30a2\u30ab\u30a6\u30f3\u30c8\u60c5\u5831\u3092\u78ba\u8a8d\u3067\u304d\u307e\u3059\u3002'}
                  </Text>
                </View>
              </Pressable>
            </Link>
            <Pressable disabled={authSubmitting} style={[styles.neutralButton, { borderColor: colors.border }]} onPress={submitSignOut}>
              <Text style={[styles.neutralButtonText, { color: colors.text }]}>ログアウト</Text>
            </Pressable>
            {localImportCount > 0 && (
              <View style={[styles.pendingBox, { backgroundColor: colors.elevated }]}>
                <Text style={[styles.rowTitle, { color: colors.text }]}>ローカル蔵書を移行</Text>
                <Text style={[styles.rowCopy, { color: colors.muted }]}>
                  この端末にある{localImportCount}冊をクラウド本棚へ移します。重複は自動で除外されます。
                </Text>
                <Pressable
                  disabled={migrationSubmitting}
                  onPress={() => void submitLocalMigration()}
                  style={[
                    styles.neutralButton,
                    { borderColor: colors.border },
                    migrationSubmitting && styles.disabledButton,
                  ]}
                >
                  <Text style={[styles.neutralButtonText, { color: colors.text }]}>
                    {migrationSubmitting ? '移行中' : 'クラウドへ移行'}
                  </Text>
                </Pressable>
              </View>
            )}
          </>
        ) : (
          <View>
            <Text style={[styles.rowTitle, { color: colors.text }]}>プロフィール</Text>
            <Text style={[styles.rowCopy, { color: colors.muted }]}>
              {configured
                ? 'ログインしなくても端末内に保存できます。アカウント作成後にクラウドへ移行できます。'
                : 'Supabase の環境変数を追加すると認証が有効になります。'}
            </Text>
            <TextInput
              autoCapitalize="none"
              keyboardType="email-address"
              onChangeText={setEmail}
              placeholder="メールアドレス"
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.input, color: colors.text }]}
              value={email}
            />
            <View style={[styles.passwordInputWrap, { backgroundColor: colors.input }]}>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setPassword}
                placeholder="パスワード"
                placeholderTextColor={colors.muted}
                secureTextEntry={!passwordVisible}
                style={[styles.passwordInput, { color: colors.text }]}
                textContentType="password"
                value={password}
              />
              <Pressable
                accessibilityLabel={passwordVisible ? 'パスワードを隠す' : 'パスワードを表示'}
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => setPasswordVisible((current) => !current)}
                style={styles.passwordToggle}
              >
                <Ionicons
                  color={colors.muted}
                  name={passwordVisible ? 'eye-outline' : 'eye-off-outline'}
                  size={21}
                />
              </Pressable>
            </View>
            <View style={styles.authFormActions}>
              <Pressable
                disabled={!configured || authSubmitting}
                style={[
                  styles.neutralButton,
                  { borderColor: colors.border },
                  (!configured || authSubmitting) && styles.disabledButton,
                ]}
                onPress={() => submitAuth()}
              >
                <Text style={[styles.neutralButtonText, { color: colors.text }]}>ログイン</Text>
              </Pressable>
              <Link href="/signup" asChild>
                <Pressable
                  disabled={!configured || authSubmitting}
                  style={[
                    styles.neutralButton,
                    styles.signupButton,
                    { borderColor: colors.border },
                    (!configured || authSubmitting) && styles.disabledButton,
                  ]}
                >
                  <Text numberOfLines={1} style={[styles.neutralButtonText, styles.signupButtonText, { color: colors.text }]}>{'> 新規登録へ進む'}</Text>
                </Pressable>
              </Link>
            </View>
          </View>
        )}
      </View>

      <View style={[styles.section, { borderBottomColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>クラウド同期</Text>
        <View style={styles.row}>
          <View style={[styles.accountIcon, { backgroundColor: colors.surface }]}>
            <Ionicons color={colors.text} name={user ? "cloud-done-outline" : "cloud-upload-outline"} size={21} />
          </View>
          <View style={styles.rowText}>
            <Text style={[styles.rowTitle, { color: colors.text }]}>
              {user ? '蔵書データはアカウントに同期されています' : 'ログインすると本棚を復元できます'}
            </Text>
            <Text style={[styles.rowCopy, { color: colors.muted }]}>
              {user
                ? '機種変更後も同じアカウントでログインすると、クラウド本棚を引き継げます。'
                : '未ログインでも端末内には保存されます。アカウント作成後にクラウドへ移行できます。'}
            </Text>
          </View>
        </View>
        <View style={[styles.exportBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>詳細データを書き出す</Text>
          <Text style={[styles.rowCopy, { color: colors.muted }]}>CSV/JSONは確認用や開発時の控えとして使えます。</Text>
          <View style={styles.authButtons}>
            <Pressable
              disabled={books.length === 0}
              onPress={() => void exportCsv()}
              style={[
                styles.neutralButton,
                styles.authButton,
                { borderColor: colors.border },
                books.length === 0 && styles.disabledButton,
              ]}
            >
              <Text style={[styles.neutralButtonText, { color: colors.text }]}>CSV出力</Text>
            </Pressable>
            <Pressable
              disabled={books.length === 0}
              onPress={() => void exportJson()}
              style={[
                styles.neutralButton,
                styles.authButton,
                { borderColor: colors.border },
                books.length === 0 && styles.disabledButton,
              ]}
            >
              <Text style={[styles.neutralButtonText, { color: colors.text }]}>JSON出力</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View style={[styles.section, { borderBottomColor: colors.border }]}>
        <View style={styles.sectionTitleRow}>
          <Ionicons color={colors.primary} name="help-circle-outline" size={20} />
          <Text style={[styles.sectionTitle, styles.sectionTitleInRow, { color: colors.text }]}>ヘルプ</Text>
        </View>
        <Link href="/help" asChild>
          <Pressable
            style={[
              styles.helpLink,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.rowText}>
              <View style={styles.navigationTitleRow}>
                <Ionicons color={colors.muted} name="chevron-forward" size={16} />
                <Text style={[styles.rowTitle, { color: colors.text }]}>本の間の使い方</Text>
              </View>
              <Text style={[styles.helpCopy, { color: colors.muted }]} numberOfLines={2}>
                {'\u767b\u9332\u3001\u672c\u68da\u3001\u6b32\u3057\u3044\u3001\u30e9\u30f3\u30ad\u30f3\u30b0\u3001\u901a\u77e5\u306a\u3069\u306e\u64cd\u4f5c\u3092\u78ba\u8a8d\u3067\u304d\u307e\u3059\u3002'}
              </Text>
            </View>
          </Pressable>
        </Link>
      </View>

      <View style={[styles.section, { borderBottomColor: colors.border }]}>
        <View style={styles.sectionTitleRow}>
          <Text style={[styles.sectionTextIcon, { color: colors.primary }]}>Aa</Text>
          <Text style={[styles.sectionTitle, styles.sectionTitleInRow, { color: colors.text }]}>データ補正</Text>
        </View>
        <Link href="/reading-suggestions" asChild>
          <Pressable
            style={[
              styles.helpLink,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.rowText}>
              <View style={styles.navigationTitleRow}>
                <Ionicons color={colors.muted} name="chevron-forward" size={16} />
                <Text style={[styles.rowTitle, { color: colors.text }]}>シリーズ名の読み方を報告</Text>
              </View>
              <Text style={[styles.helpCopy, { color: colors.muted }]} numberOfLines={2}>
                五十音順の並び替えに使う読み方の候補を送信できます。
              </Text>
            </View>
          </Pressable>
        </Link>
      </View>

      <View style={[styles.section, { borderBottomColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>外部EC</Text>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={[styles.rowTitle, { color: colors.text }]}>外部アプリで直接開く</Text>
            <Text style={[styles.rowCopy, { color: colors.muted }]}>
              ONは購入アプリへ直接遷移、OFFは本の間内ブラウザで開きます。
            </Text>
          </View>
          <Switch
            onValueChange={setOpenExternalPurchaseLinks}
            thumbColor="#ffffff"
            trackColor={{ false: '#d4d4d4', true: '#31c759' }}
            value={openExternalPurchaseLinks}
          />
        </View>
      </View>

      <View style={[styles.section, { borderBottomColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>通知</Text>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={[styles.rowTitle, { color: colors.text }]}>新刊通知</Text>
            <Text style={[styles.rowCopy, { color: colors.muted }]}>
              所持シリーズに新刊が見つかった時に通知します。ログイン中のみ利用できます。
            </Text>
          </View>
          <Switch
            disabled={!appSettingsHydrated || notificationSubmitting || !user}
            onValueChange={(value) => void toggleNewReleaseNotifications(value)}
            thumbColor="#ffffff"
            trackColor={{ false: '#d4d4d4', true: '#31c759' }}
            value={displayedNewReleaseNotifications}
          />
        </View>
        <Text style={[styles.rowCopy, { color: colors.muted }]}>
          {user
            ? 'シリーズごとの通知ON/OFFは、本棚のシリーズカードから変更できます。'
            : 'ログイン後にONにすると、端末とシリーズ情報を通知用に登録します。'}
        </Text>
        <Link href="/notifications" asChild>
          <Pressable style={[styles.largeNavigationButton, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.largeNavigationIcon, { backgroundColor: colors.elevated }]}>
              <Ionicons color="#ffcc00" name="notifications" size={22} />
            </View>
            <View style={styles.rowText}>
              <View style={styles.navigationTitleRow}>
                <Ionicons color={colors.muted} name="chevron-forward" size={16} />
                <Text style={[styles.largeNavigationTitle, { color: colors.text }]}>{'\u65b0\u520a\u901a\u77e5\u3092\u78ba\u8a8d\u3059\u308b'}</Text>
              </View>
              <Text style={[styles.rowCopy, { color: colors.muted }]}>
                {'\u901a\u77e5\u3055\u308c\u305f\u30b7\u30ea\u30fc\u30ba\u3068\u5dfb\u6570\u306e\u8a73\u7d30\u3092\u4e00\u89a7\u3067\u78ba\u8a8d\u3067\u304d\u307e\u3059\u3002'}
              </Text>
            </View>
          </Pressable>
        </Link>
      </View>

      <View style={[styles.section, { borderBottomColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>表示</Text>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={[styles.rowTitle, { color: colors.text }]}>購入価格を記録</Text>
            <Text style={[styles.rowCopy, { color: colors.muted }]}>ONにすると、登録時とシリーズ詳細の編集で通常価格または中古価格を記録できます。</Text>
          </View>
          <Switch
            onValueChange={setTrackPurchasePrices}
            thumbColor="#ffffff"
            trackColor={{ false: '#d4d4d4', true: '#31c759' }}
            value={trackPurchasePrices}
          />
        </View>
        <View style={[styles.segmented, { backgroundColor: colors.elevated }]}>
          {themeOptions.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => setMode(option.value)}
              style={[styles.segment, mode === option.value && { backgroundColor: colors.text }]}
            >
              <Text style={[styles.segmentText, { color: mode === option.value ? colors.background : colors.muted }]}>
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={[styles.section, { borderBottomColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>アプリ情報</Text>
        <Link href="/privacy" asChild>
          <Pressable
            style={[
              styles.accountLink,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={[styles.accountIcon, { backgroundColor: colors.surface }]}>
              <Ionicons color={colors.text} name="document-text-outline" size={21} />
            </View>
            <View style={styles.rowText}>
              <View style={styles.navigationTitleRow}>
                <Ionicons color={colors.muted} name="chevron-forward" size={16} />
                <Text style={[styles.rowTitle, { color: colors.text }]}>{'\u30d7\u30e9\u30a4\u30d0\u30b7\u30fc\u30dd\u30ea\u30b7\u30fc'}</Text>
              </View>
              <Text style={[styles.rowCopy, { color: colors.muted }]} numberOfLines={2}>
                {'\u53d6\u5f97\u3059\u308b\u60c5\u5831\u3001\u901a\u77e5\u3001\u30e9\u30f3\u30ad\u30f3\u30b0\u96c6\u8a08\u3001\u5916\u90e8\u30b5\u30fc\u30d3\u30b9\u5229\u7528\u306b\u3064\u3044\u3066\u78ba\u8a8d\u3067\u304d\u307e\u3059\u3002'}
              </Text>
            </View>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 18, padding: 18, paddingBottom: 40 },
  section: { borderBottomWidth: 1, paddingBottom: 18 },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginBottom: 12 },
  sectionTitleInRow: { marginBottom: 0 },
  sectionTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 6, marginBottom: 12 },
  sectionTextIcon: { fontSize: 15, fontWeight: '900', lineHeight: 20 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 56 },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '800' },
  navigationTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 3 },
  rowCopy: { fontSize: 13, lineHeight: 18, marginTop: 3 },
  loadingRow: { alignItems: 'center', height: 56, justifyContent: 'center' },
  input: {
    borderRadius: 8,
    fontSize: 16,
    minHeight: 48,
    marginTop: 10,
    paddingHorizontal: 12,
  },
  passwordInputWrap: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    minHeight: 48,
    marginTop: 10,
    paddingLeft: 12,
    paddingRight: 8,
  },
  passwordInput: { flex: 1, fontSize: 16, height: 44, paddingRight: 8 },
  passwordToggle: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 },
  authButtons: { flexDirection: 'row', gap: 10, marginTop: 10 },
  authFormActions: { gap: 8, marginTop: 12 },
  authButton: { flex: 1, marginTop: 0 },
  signupButton: { alignItems: 'center', justifyContent: 'center' },
  signupButtonText: { flexShrink: 0, textAlign: 'center' },
  disabledButton: { opacity: 0.35 },
  neutralButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: 'center',
    marginTop: 10,
  },
  neutralButtonText: { fontSize: 14, fontWeight: '800' },
  largeNavigationButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    minHeight: 72,
    padding: 14,
  },
  largeNavigationIcon: {
    alignItems: 'center',
    borderRadius: 8,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  largeNavigationTitle: { fontSize: 16, fontWeight: '900' },
  dangerButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: 'center',
    marginTop: 10,
  },
  dangerButtonText: { fontSize: 14, fontWeight: '800' },
  accountLink: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
    padding: 12,
  },
  accountIcon: {
    alignItems: 'center',
    borderRadius: 9,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  pendingBox: {
    borderRadius: 8,
    marginTop: 10,
    padding: 12,
  },
  exportBox: {
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 14,
    padding: 12,
  },
  helpLink: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  helpTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  linkTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  helpCopy: { fontSize: 13, lineHeight: 18, marginTop: 3 },
  utilityLabel: { fontSize: 12, fontWeight: '800', marginTop: 14 },
  segmented: {
    borderRadius: 8,
    flexDirection: 'row',
    padding: 4,
  },
  segment: { alignItems: 'center', borderRadius: 6, flex: 1, height: 38, justifyContent: 'center' },
  segmentText: { fontSize: 13, fontWeight: '800' },
});


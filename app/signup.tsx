import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '../src/store/AuthContext';
import { useAppTheme } from '../src/store/ThemeContext';

export default function SignUpScreen() {
  const { configured, signUp } = useAuth();
  const { colors } = useAppTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submitSignUp = async () => {
    if (!configured) {
      Alert.alert('本の間', 'クラウド同期の設定が完了していないため、新規登録を利用できません。');
      return;
    }
    if (!email.trim() || !password) {
      Alert.alert('本の間', 'メールアドレスとパスワードを入力してください。');
      return;
    }
    if (!acceptedPrivacy) {
      Alert.alert('本の間', 'プライバシーポリシーを確認し、同意してから登録してください。');
      return;
    }

    setSubmitting(true);
    try {
      await signUp(email.trim(), password);
      setPassword('');
      Alert.alert(
        '確認メールを送信しました',
        'Supabaseから届く認証メールを開いたあと、ログイン画面でもう一度メールアドレスとパスワードを入力してください。',
        [{ text: 'ログイン画面へ', onPress: () => router.replace('/(tabs)/settings') }],
      );
    } catch (error) {
      Alert.alert('登録できませんでした', error instanceof Error ? error.message : 'しばらくしてからもう一度お試しください。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={styles.screen}
        contentContainerStyle={styles.content}
      >
        <View style={styles.header}>
          <View style={[styles.iconBox, { backgroundColor: colors.elevated }]}>
            <Ionicons color={colors.text} name="person-add-outline" size={28} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>新規登録</Text>
          <Text style={[styles.copy, { color: colors.muted }]}>アカウントを作成すると、本棚や欲しいリストをクラウドに保存できます。</Text>
        </View>

        <View style={[styles.panel, { backgroundColor: colors.elevated }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>登録前に確認すること</Text>
          <View style={styles.noticeList}>
            <NoticeItem text="登録後、Supabaseから認証メールが届きます。" />
            <NoticeItem text="メール内のリンクを開くと登録が完了します。" />
            <NoticeItem text="認証後は、ログイン画面でもう一度メールアドレスとパスワードを入力してください。" />
          </View>
        </View>

        <View style={[styles.panel, { backgroundColor: colors.elevated }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>アカウント情報</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="メールアドレス"
            placeholderTextColor={colors.muted}
            style={[styles.input, { backgroundColor: colors.input, color: colors.text }]}
            textContentType="emailAddress"
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
              textContentType="newPassword"
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
        </View>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: acceptedPrivacy }}
          onPress={() => setAcceptedPrivacy((current) => !current)}
          style={[styles.privacyRow, { borderColor: colors.border }]}
        >
          <Ionicons
            color={acceptedPrivacy ? colors.primary : colors.muted}
            name={acceptedPrivacy ? 'checkbox' : 'square-outline'}
            size={22}
          />
          <View style={styles.privacyText}>
            <Text style={[styles.privacyTitle, { color: colors.text }]}>プライバシーポリシーに同意する</Text>
            <Link href="/privacy" asChild>
              <Pressable hitSlop={8}>
                <Text style={[styles.privacyLink, { color: colors.primary }]}>内容を確認する</Text>
              </Pressable>
            </Link>
          </View>
        </Pressable>

        <Pressable
          disabled={submitting || !configured}
          onPress={() => void submitSignUp()}
          style={[
            styles.primaryButton,
            { backgroundColor: colors.text },
            (submitting || !configured) && styles.disabledButton,
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={[styles.primaryButtonText, { color: colors.background }]}>登録する</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function NoticeItem({ text }: { text: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.noticeItem}>
      <Ionicons color={colors.primary} name="checkmark-circle-outline" size={18} />
      <Text style={[styles.noticeText, { color: colors.muted }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 14, padding: 18, paddingBottom: 36 },
  header: { gap: 8, paddingTop: 6 },
  iconBox: { alignItems: 'center', borderRadius: 12, height: 52, justifyContent: 'center', width: 52 },
  title: { fontSize: 24, fontWeight: '900', letterSpacing: 0 },
  copy: { fontSize: 13, lineHeight: 19 },
  panel: { borderRadius: 8, gap: 12, padding: 14 },
  sectionTitle: { fontSize: 16, fontWeight: '900' },
  noticeList: { gap: 10 },
  noticeItem: { alignItems: 'flex-start', flexDirection: 'row', gap: 8 },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 19 },
  input: { borderRadius: 8, fontSize: 16, height: 44, paddingHorizontal: 12 },
  passwordInputWrap: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    height: 44,
    paddingLeft: 12,
    paddingRight: 8,
  },
  passwordInput: { flex: 1, fontSize: 16, height: 44, paddingRight: 8 },
  passwordToggle: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 },
  privacyRow: { alignItems: 'flex-start', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 12 },
  privacyText: { flex: 1, gap: 4 },
  privacyTitle: { fontSize: 14, fontWeight: '800' },
  privacyLink: { fontSize: 13, fontWeight: '800' },
  primaryButton: { alignItems: 'center', borderRadius: 8, height: 48, justifyContent: 'center' },
  primaryButtonText: { fontSize: 15, fontWeight: '900' },
  disabledButton: { opacity: 0.35 },
});
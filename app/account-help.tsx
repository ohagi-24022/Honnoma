import { Link, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';

import { EMAIL_PATTERN } from '../src/lib/authRecovery';
import { useAuth } from '../src/store/AuthContext';
import { useAppTheme } from '../src/store/ThemeContext';

export default function AccountHelpScreen() {
  const params = useLocalSearchParams<{ mode?: string; email?: string }>();
  const confirmation = params.mode === 'confirmation';
  const { configured, requestPasswordReset, resendConfirmation } = useAuth();
  const { colors } = useAppTheme();
  const [email, setEmail] = useState(params.email ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const sending = useRef(false);
  const nextSendAt = useRef(0);
  useEffect(() => {
    const timer = setInterval(() => setRemaining(Math.max(0, Math.ceil((nextSendAt.current - Date.now()) / 1000))), 1000);
    return () => clearInterval(timer);
  }, []);

  async function sendEmail() {
    if (sending.current || Date.now() < nextSendAt.current || !configured) return;
    if (!EMAIL_PATTERN.test(email.trim())) {
      Alert.alert('本の間', 'メールアドレスの形式を確認してください。');
      return;
    }
    sending.current = true;
    setSubmitting(true);
    setSent(false);
    try {
      if (confirmation) await resendConfirmation(email.trim());
      else await requestPasswordReset(email.trim());
      nextSendAt.current = Date.now() + 60_000;
      setRemaining(60);
      setSent(true);
    } catch (error) {
      Alert.alert('送信できませんでした', error instanceof Error ? error.message : 'しばらくしてからお試しください。');
    } finally {
      sending.current = false;
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: colors.text }]}>{confirmation ? '確認メールを再送する' : 'パスワードを忘れた方'}</Text>
        <Text style={[styles.copy, { color: colors.muted }]}>{confirmation ? '新規登録時のメールアドレスを入力してください。まだ登録を確認していないアカウントへ、確認メールを再送します。' : '登録したメールアドレスを入力してください。届いたメールのリンクから、新しいパスワードを設定できます。'}</Text>
        <TextInput accessibilityLabel="登録したメールアドレス" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" value={email} onChangeText={(value) => { setEmail(value); setSent(false); }} editable={!submitting} placeholder="メールアドレス" placeholderTextColor={colors.muted} style={[styles.input, { backgroundColor: colors.input, color: colors.text }]} />
        <Pressable accessibilityRole="button" disabled={!configured || submitting || remaining > 0} onPress={() => void sendEmail()} style={[styles.button, { backgroundColor: colors.text, opacity: !configured || submitting || remaining > 0 ? 0.4 : 1 }]}>
          {submitting ? <ActivityIndicator color={colors.background} /> : <Text style={{ color: colors.background, fontWeight: '800' }}>{remaining > 0 ? `再送まであと${remaining}秒` : confirmation ? '確認メールを送る' : '再設定メールを送る'}</Text>}
        </Pressable>
        {sent && <Text accessibilityLiveRegion="polite" style={[styles.copy, { color: colors.primary }]}>対象のアカウントがある場合、メールが届きます。本の間をインストールした端末でリンクを開いてください。届かない場合は迷惑メールフォルダも確認してください。</Text>}
        {!configured && <Text style={[styles.copy, { color: colors.muted }]}>認証の設定が完了していないため、現在この機能を利用できません。</Text>}
        <Link href="/(tabs)/settings" style={{ color: colors.primary, paddingVertical: 12 }}>ログイン画面へ戻る</Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40, gap: 16 },
  title: { fontSize: 23, fontWeight: '900' },
  copy: { fontSize: 14, lineHeight: 22 },
  input: { borderRadius: 8, paddingHorizontal: 12, height: 48, fontSize: 16 },
  button: { borderRadius: 8, minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 12 },
});

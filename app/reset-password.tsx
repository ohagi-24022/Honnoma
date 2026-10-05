import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { validateNewPassword } from '../src/lib/authRecovery';
import { useAuth } from '../src/store/AuthContext';
import { useAppTheme } from '../src/store/ThemeContext';

export default function ResetPasswordScreen() {
  const { recoveryReady, updatePassword } = useAuth();
  const { colors } = useAppTheme();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const sending = useRef(false);
  async function submit() {
    if (sending.current) return;
    const issue = validateNewPassword(password, confirmation);
    if (issue) { Alert.alert('本の間', issue); return; }
    sending.current = true;
    setSubmitting(true);
    try {
      await updatePassword(password);
      setPassword(''); setConfirmation(''); setDone(true);
      Alert.alert('パスワードを変更しました', '次回から新しいパスワードでログインできます。', [{ text: '本の間へ戻る', onPress: () => router.replace('/(tabs)/settings') }]);
    } catch (error) {
      Alert.alert('変更できませんでした', error instanceof Error ? error.message : '再設定メールをもう一度送信してください。');
    } finally { sending.current = false; setSubmitting(false); }
  }
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 18 }}>
        <Text style={{ color: colors.text, fontSize: 23, fontWeight: '900' }}>パスワードの再設定</Text>
        {done ? <Link href="/(tabs)/settings" style={{ color: colors.primary }}>変更が完了しました。本の間へ戻る</Link> : !recoveryReady ? <>
          <Text style={{ color: colors.muted, lineHeight: 22 }}>再設定メールのリンクから開いてください。リンクを開き直せない場合は、新しいメールを送信してください。</Text>
          <Link href="/account-help?mode=reset" style={{ color: colors.primary, paddingVertical: 12 }}>再設定メールを送る</Link>
        </> : <>
          <Text style={{ color: colors.muted, lineHeight: 22 }}>新しいパスワードを6文字以上で入力してください。</Text>
          {([{ label: '新しいパスワード', value: password, set: setPassword }, { label: '新しいパスワード（確認）', value: confirmation, set: setConfirmation }]).map((field) => <TextInput key={field.label} accessibilityLabel={field.label} placeholder={field.label} placeholderTextColor={colors.muted} value={field.value} onChangeText={field.set} autoCapitalize="none" autoCorrect={false} secureTextEntry={!visible} textContentType="newPassword" editable={!submitting} style={{ backgroundColor: colors.input, color: colors.text, fontSize: 16, borderRadius: 8, height: 48, paddingHorizontal: 12 }} />)}
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: visible }} onPress={() => setVisible(!visible)} style={{ flexDirection: 'row', gap: 8, paddingVertical: 8 }}>
            <Ionicons name={visible ? 'checkbox' : 'square-outline'} color={colors.primary} size={22} /><Text style={{ color: colors.text }}>パスワードを表示する</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={submitting} onPress={() => void submit()} style={{ backgroundColor: colors.text, borderRadius: 8, minHeight: 48, alignItems: 'center', justifyContent: 'center', opacity: submitting ? 0.4 : 1 }}>
            {submitting ? <ActivityIndicator color={colors.background} /> : <Text style={{ color: colors.background, fontWeight: '800' }}>パスワードを変更する</Text>}
          </Pressable>
        </>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

import { Link, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { useAuth } from '../src/store/AuthContext';
import { useAppTheme } from '../src/store/ThemeContext';

export default function AuthCallbackScreen() {
  const { authLinkUrl: url, completeAuthLink, initializing } = useAuth();
  const { colors } = useAppTheme();
  const handledUrl = useRef<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (initializing || !url || handledUrl.current === url) return;
    handledUrl.current = url;
    setMessage(null);
    void completeAuthLink(url).then((type) => {
      if (type === 'recovery') router.replace('/reset-password');
      else setConfirmed(true);
    }).catch((error) => setMessage(error instanceof Error ? error.message : 'メールの確認を完了できませんでした。'));
  }, [url, initializing, completeAuthLink]);

  return (
    <View style={{ flex: 1, padding: 24, gap: 20, backgroundColor: colors.background }}>
      {!message && !confirmed && url && <ActivityIndicator color={colors.text} />}
      <Text style={{ color: colors.text, fontSize: 18, lineHeight: 28 }}>{message ?? (confirmed ? 'メールアドレスの確認が完了しました。本の間を利用できます。' : url ? 'メールのリンクを確認しています…' : '届いたメールのリンクから、この画面を開いてください。')}</Text>
      {(message || !url) && <>
        <Link href="/account-help?mode=reset" style={{ color: colors.primary, paddingVertical: 12 }}>パスワードの再設定メールを送る</Link>
        <Link href="/account-help?mode=confirmation" style={{ color: colors.primary, paddingVertical: 12 }}>確認メールを再送する</Link>
      </>}
      <Link href="/(tabs)/settings" style={{ color: colors.primary, paddingVertical: 12 }}>{confirmed ? '本の間へ戻る' : 'ログイン画面へ戻る'}</Link>
    </View>
  );
}

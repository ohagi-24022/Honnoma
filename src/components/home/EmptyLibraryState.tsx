import Ionicons from '@expo/vector-icons/Ionicons';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../../store/ThemeContext';

type EmptyLibraryStateProps = {
  requiresAuth: boolean;
  libraryIsEmpty: boolean;
};

export function EmptyLibraryState({
  requiresAuth,
  libraryIsEmpty,
}: EmptyLibraryStateProps) {
  const { colors } = useAppTheme();

  if (requiresAuth) {
    return (
      <View style={styles.empty}>
        <Ionicons color={colors.muted} name="library-outline" size={40} />
        <Text style={[styles.title, { color: colors.text }]}>ログイン待ちです</Text>
        <Text style={[styles.copy, { color: colors.muted }]}>
          設定タブでログインすると、本棚が同期されます。
        </Text>
      </View>
    );
  }

  if (!libraryIsEmpty) {
    return (
      <View style={styles.empty}>
        <Ionicons color={colors.muted} name="search-outline" size={40} />
        <Text style={[styles.title, { color: colors.text }]}>条件に一致する本がありません</Text>
        <Text style={[styles.copy, { color: colors.muted }]}>
          検索語や表示条件を変更してみてください。
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.empty}>
      <Ionicons color={colors.text} name="barcode-outline" size={48} />
      <Text style={[styles.title, { color: colors.text }]}>最初の1冊を登録しましょう</Text>
      <Text style={[styles.copy, { color: colors.muted }]}>
        まずは1冊スキャンしてみましょう。{'\n'}
        ISBNバーコードから書籍情報を自動入力できます。{'\n'}
        バーコードがない本は手動登録もできます。
      </Text>
      <Link href="/(tabs)/scan" asChild>
        <Pressable style={[styles.action, { backgroundColor: colors.text }]}>
          <Ionicons color={colors.background} name="barcode-outline" size={19} />
          <Text style={[styles.actionText, { color: colors.background }]}>本を登録する</Text>
        </Pressable>
      </Link>
      <Text style={[styles.accountCopy, { color: colors.muted }]}>アカウントを作ると、本棚をクラウドに保存できます。</Text>
      <Link href="/signup" asChild>
        <Pressable style={[styles.secondaryAction, { borderColor: colors.border }]}>
          <Text style={[styles.secondaryActionText, { color: colors.text }]}>{'>'} 新規登録へ進む</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 58 },
  title: { fontSize: 18, fontWeight: '800', marginTop: 14, textAlign: 'center' },
  copy: { fontSize: 14, lineHeight: 22, marginTop: 8, textAlign: 'center' },
  action: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    height: 44,
    justifyContent: 'center',
    marginTop: 22,
    minWidth: 156,
    paddingHorizontal: 18,
  },
  actionText: { fontSize: 14, fontWeight: '800' },
  accountCopy: { fontSize: 12, lineHeight: 18, marginTop: 18, textAlign: 'center' },
  secondaryAction: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    marginTop: 8,
    minWidth: 156,
    paddingHorizontal: 16,
  },
  secondaryActionText: { fontSize: 13, fontWeight: '800' },
});


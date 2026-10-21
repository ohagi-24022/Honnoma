import Ionicons from '@expo/vector-icons/Ionicons';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { privacyPolicySections as sections, privacyPolicyUpdatedAt } from '../src/lib/privacyPolicy';
import { useAppTheme } from '../src/store/ThemeContext';



export default function PrivacyScreen() {
  const { colors } = useAppTheme();

  async function openContact(kind: 'form' | 'email') {
    try {
      if (kind === 'form') await Linking.openURL('https://docs.google.com/forms/d/e/1FAIpQLSdKp8lpTAanF885CYChSQUafiQhV-YWXgQmeVTUxFu1612s3Q/viewform');
      else await Linking.openURL('mailto:ohagiworks.contact@gmail.com?subject=' + encodeURIComponent('本の間についてのお問い合わせ'));
    } catch {
      Alert.alert('開けませんでした', kind === 'email' ? 'メールアプリの設定を確認してください。下のメールアドレスをコピーして問い合わせることもできます。' : '通信環境を確認してください。下のURLをコピーしてブラウザで開くこともできます。');
    }
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <View style={[styles.iconBox, { backgroundColor: colors.elevated }]}>
          <Ionicons color={colors.text} name="shield-checkmark-outline" size={28} />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>プライバシーポリシー</Text>
        <Text style={[styles.copy, { color: colors.muted }]}>
          最終更新日: {privacyPolicyUpdatedAt}
        </Text>
        <Text style={[styles.copy, { color: colors.muted }]}>
          本ポリシーは、本の間における利用者情報の取り扱いについて説明するものです。お問い合わせは下記のフォームまたはメールアドレスからご連絡ください。
        </Text>
      </View>

      {sections.map((section) => (
        <View key={section.title} style={[styles.card, { borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{section.title}</Text>
          <Text style={[styles.body, { color: colors.muted }]}>{section.body}</Text>
        </View>
      ))}

      <View style={[styles.card, { borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>問い合わせ先</Text>
        <Pressable accessibilityRole="link" onPress={() => void openContact('form')} style={[styles.contactButton, { backgroundColor: colors.elevated }]}>
          <Ionicons name="open-outline" color={colors.primary} size={19} /><Text style={{ color: colors.primary, fontWeight: '800' }}>問い合わせフォームを開く</Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => void openContact('email')} style={[styles.contactButton, { backgroundColor: colors.elevated }]}>
          <Ionicons name="mail-outline" color={colors.primary} size={19} /><Text style={{ color: colors.primary, fontWeight: '800' }}>メールで問い合わせる</Text>
        </Pressable>
        <View style={styles.contactRows}>
          <View style={styles.contactRow}>
            <Text style={[styles.contactLabel, { color: colors.text }]}>運営者</Text>
            <Text selectable style={[styles.contactValue, { color: colors.muted }]}>YUKI UTSUNO</Text>
          </View>
          <View style={styles.contactRow}>
            <Text style={[styles.contactLabel, { color: colors.text }]}>問い合わせフォーム</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.urlScroller}>
              <Text selectable style={[styles.contactValue, styles.urlText, { color: colors.text }]}>https://docs.google.com/forms/d/e/1FAIpQLSdKp8lpTAanF885CYChSQUafiQhV-YWXgQmeVTUxFu1612s3Q/viewform</Text>
            </ScrollView>
          </View>
          <View style={styles.contactRow}>
            <Text style={[styles.contactLabel, { color: colors.text }]}>メールアドレス</Text>
            <Text selectable style={[styles.contactValue, { color: colors.muted }]}>ohagiworks.contact@gmail.com</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: 12, padding: 18, paddingBottom: 40 },
  header: { gap: 8, marginBottom: 4 },
  iconBox: {
    alignItems: 'center',
    borderRadius: 8,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  title: { fontSize: 24, fontWeight: '900' },
  copy: { fontSize: 13, lineHeight: 19 },
  card: { borderRadius: 8, borderWidth: 1, gap: 7, padding: 14 },
  sectionTitle: { fontSize: 16, fontWeight: '900' },
  body: { fontSize: 14, lineHeight: 21 },
  contactButton: { minHeight: 48, borderRadius: 8, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  contactRows: { gap: 10 },
  contactRow: { gap: 4 },
  contactLabel: { fontSize: 13, fontWeight: '900' },
  contactValue: { fontSize: 14, lineHeight: 21 },
  urlScroller: { maxWidth: '100%' },
  urlText: { fontFamily: 'monospace' },
});

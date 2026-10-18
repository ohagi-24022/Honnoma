import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname, useRootNavigationState } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getStorageItemWithLegacy } from '../lib/asyncStorageCompat';
import { useAuth } from '../store/AuthContext';
import { OnboardingFocus, useOnboardingTour } from '../store/OnboardingContext';
import { useAppTheme } from '../store/ThemeContext';

const LEGACY_ONBOARDING_STORAGE_PREFIX = 'booknest.onboarding.login.v1';
const ONBOARDING_STORAGE_PREFIX = 'honnoma.onboarding.login.v1';

const slides = [
  { icon: 'library-outline', title: '本棚をひと目で確認', focus: 'shelf', path: '/', route: '/(tabs)', screen: '本棚',
    body: '登録した本はシリーズごとに並びます。持っている巻や未読の本を確認できます。' },
  { icon: 'barcode-outline', title: 'バーコードでかんたん登録', focus: 'scan', path: '/scan', route: '/(tabs)/scan', screen: '登録',
    body: '「通常」は1冊ずつ確認して登録。「連続登録」は複数のバーコードを続けて読み取れます。バーコードがない本は手動登録で検索できます。' },
  { icon: 'albums-outline', title: 'シリーズ登録でまとめて追加', focus: 'series', path: '/scan', route: '/(tabs)/scan', screen: '登録・シリーズ登録の入口',
    body: '「シリーズ登録」から1冊をスキャンし、内容を確認して登録。そのあと何巻まで持っているかを指定すると、未登録の巻をまとめて追加できます。登録済みのシリーズ画面からも利用できます。' },
  { icon: 'cart-outline', title: '欲しい本を残しておく', focus: 'wishlist', path: '/wishlist', route: '/(tabs)/wishlist', screen: '欲しい',
    body: '気になる作品を検索して、欲しいリストへ。優先度を付けると、次に買う本を選びやすくなります。' },
  { icon: 'cloud-done-outline', title: 'クラウドに保存する', focus: 'settings', path: '/settings', route: '/(tabs)/settings', screen: '設定',
    body: 'ログインすると本棚や欲しいリストを保存できます。端末を変えても同じアカウントで使えます。表示や通知の設定もここから変更できます。' },
] as const;

function storageKey(userId: string) { return `${ONBOARDING_STORAGE_PREFIX}:${userId}`; }
function legacyStorageKey(userId: string) { return `${LEGACY_ONBOARDING_STORAGE_PREFIX}:${userId}`; }

export function OnboardingGate() {
  const { user, recoveryReady } = useAuth();
  const pathname = usePathname();
  const navigation = useRootNavigationState();
  const { colors } = useAppTheme();
  const { setFocus } = useOnboardingTour();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const [checkedUserId, setCheckedUserId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const currentSlide = slides[index];
  const isLast = index === slides.length - 1;
  const canGuide = !!navigation?.key && visible && !!user?.id && checkedUserId === user.id
    && !recoveryReady && pathname !== '/auth-callback' && pathname !== '/reset-password';

  useEffect(() => {
    let active = true;
    setVisible(false);
    setCheckedUserId(null);
    setIndex(0);
    if (user?.id) {
      const userId = user.id;
      void getStorageItemWithLegacy(storageKey(userId), legacyStorageKey(userId))
        .then(value => { if (active) { setVisible(value !== 'seen'); setCheckedUserId(userId); } })
        .catch(error => {
          console.warn('Failed to load onboarding state', error);
          if (active) { setVisible(true); setCheckedUserId(userId); }
        });
    }
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    if (!canGuide) { setFocus(null); return; }
    // Set the preview state before mounting the destination: camera scanning is paused.
    setFocus(currentSlide.focus as OnboardingFocus);
    if (pathname !== currentSlide.path) router.replace(currentSlide.route);
  }, [canGuide, currentSlide, pathname, setFocus]);
  useEffect(() => () => setFocus(null), [setFocus]);

  const finish = () => {
    const userId = user?.id;
    setVisible(false);
    setFocus(null);
    if (userId) void AsyncStorage.setItem(storageKey(userId), 'seen')
      .catch(error => console.warn('Failed to save onboarding state', error));
    router.replace('/(tabs)/scan');
  };

  if (!canGuide) return null;

  return (
    <Modal animationType="fade" transparent visible onRequestClose={finish}>
      <View style={[styles.backdrop, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View accessibilityViewIsModal style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ScrollView style={{ maxHeight: Math.min(height * 0.5, 380) }} contentContainerStyle={styles.copy}>
            <Text style={[styles.location, { color: colors.primary }]}>表示中：{currentSlide.screen}　{index + 1} / {slides.length}</Text>
            <View style={styles.heading}>
              <Ionicons color={colors.primary} name={currentSlide.icon} size={25} />
              <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{currentSlide.title}</Text>
            </View>
            <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.muted }]}>{currentSlide.body}</Text>
          </ScrollView>
          <View style={styles.dots} accessibilityLabel={`使い方の案内 ${index + 1} / ${slides.length}`}>
            {slides.map((slide, dotIndex) => <View key={slide.focus} style={[styles.dot,
              { backgroundColor: dotIndex === index ? colors.primary : colors.border }, dotIndex === index && styles.activeDot]} />)}
          </View>
          <View style={styles.actions}>
            <Pressable accessibilityLabel="オンボーディングをスキップ" onPress={finish} style={styles.textButton}>
              <Text style={{ color: colors.muted }}>スキップ</Text>
            </Pressable>
            {index > 0 && <Pressable accessibilityLabel="前の案内へ戻る" onPress={() => setIndex(value => value - 1)} style={styles.textButton}>
              <Text style={{ color: colors.text }}>戻る</Text>
            </Pressable>}
            <Pressable accessibilityLabel={isLast ? '本を登録する' : '次へ'}
              onPress={() => isLast ? finish() : setIndex(value => value + 1)}
              style={[styles.primaryButton, { backgroundColor: colors.text }]}>
              <Text style={[styles.primaryText, { color: colors.background }]}>{isLast ? '本を登録する' : '次へ'}</Text>
              <Ionicons color={colors.background} name={isLast ? 'barcode-outline' : 'chevron-forward'} size={17} />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 14, backgroundColor: 'rgba(0,0,0,0.16)' },
  card: { width: '100%', maxWidth: 540, borderRadius: 18, borderWidth: 1, padding: 18 },
  copy: { gap: 12 },
  location: { fontSize: 12, fontWeight: '800' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontSize: 19, fontWeight: '900' },
  body: { fontSize: 14, lineHeight: 23 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 7, marginTop: 16 },
  dot: { borderRadius: 999, height: 6, width: 6 },
  activeDot: { width: 18 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  textButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 2 },
  primaryButton: { flex: 1, minHeight: 44, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8 },
  primaryText: { fontSize: 14, fontWeight: '900' },
});

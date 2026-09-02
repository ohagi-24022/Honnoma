import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { getStorageItemWithLegacy } from '../lib/asyncStorageCompat';
import { useAuth } from '../store/AuthContext';
import { useAppTheme } from '../store/ThemeContext';

const LEGACY_ONBOARDING_STORAGE_PREFIX = 'booknest.onboarding.login.v1';
const ONBOARDING_STORAGE_PREFIX = 'honnoma.onboarding.login.v1';

const slides = [
  {
    icon: 'barcode-outline' as const,
    title: 'スキャンで本棚を作る',
    body: 'ISBNバーコードを読み取ると、表紙やシリーズ名を自動で取得して本棚に追加できます。',
  },
  {
    icon: 'cloud-done-outline' as const,
    title: 'クラウドに保存する',
    body: 'ログインすると本棚や欲しいリストを保存できます。端末を変えても同じアカウントで使えます。',
  },
  {
    icon: 'cart-outline' as const,
    title: '欲しい本を残しておく',
    body: '気になるシリーズは欲しいタブへ。優先度を付けて、あとで買う候補を見返せます。',
  },
];

function storageKey(userId: string) {
  return `${ONBOARDING_STORAGE_PREFIX}:${userId}`;
}

function legacyStorageKey(userId: string) {
  return `${LEGACY_ONBOARDING_STORAGE_PREFIX}:${userId}`;
}

export function OnboardingGate() {
  const { user } = useAuth();
  const { colors } = useAppTheme();
  const [visible, setVisible] = useState(false);
  const [checking, setChecking] = useState(true);
  const [index, setIndex] = useState(0);

  const currentSlide = slides[index];
  const isLast = index === slides.length - 1;

  useEffect(() => {
    let active = true;

    if (!user?.id) {
      setVisible(false);
      setChecking(false);
      setIndex(0);
      return () => {
        active = false;
      };
    }

    setChecking(true);
    getStorageItemWithLegacy(storageKey(user.id), legacyStorageKey(user.id))
      .then((value) => {
        if (!active) return;
        setVisible(value !== 'seen');
        setIndex(0);
      })
      .finally(() => {
        if (active) setChecking(false);
      });

    return () => {
      active = false;
    };
  }, [user?.id]);

  const markSeen = async () => {
    if (user?.id) {
      await AsyncStorage.setItem(storageKey(user.id), 'seen');
    }
    setVisible(false);
    setIndex(0);
  };

  const primaryLabel = useMemo(() => (isLast ? '使いはじめる' : '次へ'), [isLast]);

  if (checking || !user?.id) return null;

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={() => void markSeen()}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.iconShell, { backgroundColor: colors.elevated }]}>
            <Ionicons color={colors.text} name={currentSlide.icon} size={30} />
          </View>
          <Text style={[styles.title, { color: colors.text }]}>{currentSlide.title}</Text>
          <Text style={[styles.body, { color: colors.muted }]}>{currentSlide.body}</Text>

          <View style={styles.dots}>
            {slides.map((slide, dotIndex) => (
              <View
                key={slide.title}
                style={[
                  styles.dot,
                  { backgroundColor: dotIndex === index ? colors.text : colors.border },
                  dotIndex === index && styles.activeDot,
                ]}
              />
            ))}
          </View>

          <View style={styles.actions}>
            <Pressable accessibilityLabel="オンボーディングをスキップ" onPress={() => void markSeen()} style={styles.skipButton}>
              <Text style={[styles.skipText, { color: colors.muted }]}>スキップ</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={primaryLabel}
              onPress={() => {
                if (isLast) {
                  void markSeen();
                  router.push('/(tabs)/scan');
                  return;
                }
                setIndex((value) => value + 1);
              }}
              style={[styles.primaryButton, { backgroundColor: colors.text }]}
            >
              <Text style={[styles.primaryText, { color: colors.background }]}>{primaryLabel}</Text>
              <Ionicons color={colors.background} name={isLast ? 'barcode-outline' : 'chevron-forward'} size={17} />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: { alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 22 },
  activeDot: { width: 18 },
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
    flex: 1,
    justifyContent: 'center',
    padding: 22,
  },
  body: { fontSize: 14, lineHeight: 22, marginTop: 10, textAlign: 'center' },
  card: { alignItems: 'center', borderRadius: 8, borderWidth: 1, padding: 20, width: '100%' },
  dot: { borderRadius: 999, height: 7, width: 7 },
  dots: { flexDirection: 'row', gap: 7, marginTop: 18 },
  iconShell: { alignItems: 'center', borderRadius: 8, height: 58, justifyContent: 'center', width: 58 },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 44,
    justifyContent: 'center',
  },
  primaryText: { fontSize: 14, fontWeight: '900' },
  skipButton: { alignItems: 'center', height: 44, justifyContent: 'center', paddingHorizontal: 10 },
  skipText: { fontSize: 14, fontWeight: '800' },
  title: { fontSize: 20, fontWeight: '900', marginTop: 16, textAlign: 'center' },
});



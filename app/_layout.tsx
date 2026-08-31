import Constants from 'expo-constants';
import { router, Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { OnboardingGate } from '../src/components/OnboardingGate';

import { AppSettingsProvider } from '../src/store/AppSettingsContext';
import { AuthProvider } from '../src/store/AuthContext';
import { LibraryProvider } from '../src/store/LibraryContext';
import { ThemeProvider, useAppTheme } from '../src/store/ThemeContext';
import { WishlistProvider } from '../src/store/WishlistContext';

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.errorScreen}>
      <View style={styles.errorCard}>
        <Text style={styles.errorTitle}>問題が発生しました</Text>
        <Text style={styles.errorCopy}>
          画面の表示中に予期しないエラーが発生しました。再読み込みしても直らない場合は、アプリを再起動してください。
        </Text>
        {__DEV__ && <Text selectable style={styles.errorDetail}>{error.message}</Text>}
        <Pressable accessibilityLabel="画面を再読み込み" onPress={retry} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>再読み込み</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
        <AuthProvider>
          <AppSettingsProvider>
            <WishlistProvider>
              <LibraryProvider>
                <RootStack />
                <OnboardingGate />
              </LibraryProvider>
            </WishlistProvider>
          </AppSettingsProvider>
        </AuthProvider>
      </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootStack() {
  const { colors, resolvedMode } = useAppTheme();

  useEffect(() => {
    if (Platform.OS === 'android' && Constants.appOwnership === 'expo') return;

    let subscription: { remove: () => void } | undefined;
    let mounted = true;

    void import('expo-notifications').then((Notifications) => {
      if (!mounted) return;
      const lastResponse = Notifications.getLastNotificationResponse();
      const initialUrl = lastResponse?.notification.request.content.data?.url;
      if (typeof initialUrl === 'string') {
        router.push(initialUrl);
      }

      subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        const url = response.notification.request.content.data?.url;
        if (typeof url === 'string') {
          router.push(url);
        }
      });
    });

    return () => {
      mounted = false;
      subscription?.remove();
    };
  }, []);

  const panelScreenOptions = {
    animation: 'default' as const,
    contentStyle: { backgroundColor: colors.background },
    fullScreenGestureEnabled: false,
    gestureDirection: 'horizontal' as const,
    gestureEnabled: true,
    presentation: 'card' as const,
    headerShadowVisible: false,
    headerStyle: { backgroundColor: colors.background },
    headerTintColor: colors.text,
    headerTitleStyle: { fontWeight: '700' as const },
  };

  return (
    <>
      <StatusBar style={resolvedMode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerBackTitle: '戻る',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="series/[title]" options={{ ...panelScreenOptions, title: '\u30b7\u30ea\u30fc\u30ba' }} />
        <Stack.Screen name="book/[id]" options={{ ...panelScreenOptions, title: '\u5dfb\u306e\u60c5\u5831' }} />
        <Stack.Screen name="report" options={{ ...panelScreenOptions, title: '\u60c5\u5831\u306e\u5831\u544a' }} />
        <Stack.Screen name="reading-suggestions" options={{ ...panelScreenOptions, title: '読み方の報告' }} />
        <Stack.Screen name="account" options={{ ...panelScreenOptions, title: '\u30de\u30a4\u30da\u30fc\u30b8' }} />
        <Stack.Screen name="signup" options={{ ...panelScreenOptions, title: '新規登録' }} />
        <Stack.Screen name="help" options={{ ...panelScreenOptions, title: '\u30d8\u30eb\u30d7' }} />
        <Stack.Screen name="notifications" options={{ ...panelScreenOptions, title: '\u65b0\u520a\u901a\u77e5' }} />
        <Stack.Screen name="ranking/[category]" options={{ ...panelScreenOptions, title: '\u30e9\u30f3\u30ad\u30f3\u30b0' }} />
        <Stack.Screen name="privacy" options={{ title: 'プライバシーポリシー' }} />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  errorScreen: {
    alignItems: 'center',
    backgroundColor: '#f7f7f7',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  errorCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e5e5',
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: 420,
    padding: 20,
    width: '100%',
  },
  errorTitle: { color: '#111111', fontSize: 20, fontWeight: '900' },
  errorCopy: { color: '#555555', fontSize: 14, lineHeight: 21, marginTop: 10 },
  errorDetail: { color: '#777777', fontSize: 12, lineHeight: 18, marginTop: 12 },
  retryButton: {
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 8,
    height: 44,
    justifyContent: 'center',
    marginTop: 18,
  },
  retryButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
});


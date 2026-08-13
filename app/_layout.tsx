import Constants from 'expo-constants';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AppSettingsProvider } from '../src/store/AppSettingsContext';
import { AuthProvider } from '../src/store/AuthContext';
import { LibraryProvider } from '../src/store/LibraryContext';
import { ThemeProvider, useAppTheme } from '../src/store/ThemeContext';
import { WishlistProvider } from '../src/store/WishlistContext';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AuthProvider>
          <AppSettingsProvider>
            <WishlistProvider>
              <LibraryProvider>
                <RootStack />
              </LibraryProvider>
            </WishlistProvider>
          </AppSettingsProvider>
        </AuthProvider>
      </ThemeProvider>
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
    animation: 'slide_from_right' as const,
    contentStyle: { backgroundColor: colors.background },
    fullScreenGestureEnabled: true,
    gestureEnabled: true,
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
        <Stack.Screen name="account" options={{ ...panelScreenOptions, title: '\u30de\u30a4\u30da\u30fc\u30b8' }} />
        <Stack.Screen name="help" options={{ ...panelScreenOptions, title: '\u30d8\u30eb\u30d7' }} />
        <Stack.Screen name="notifications" options={{ ...panelScreenOptions, title: '\u65b0\u520a\u901a\u77e5' }} />
        <Stack.Screen name="ranking/[category]" options={{ ...panelScreenOptions, title: '\u30e9\u30f3\u30ad\u30f3\u30b0' }} />
        <Stack.Screen name="privacy" options={{ title: 'プライバシーポリシー' }} />
      </Stack>
    </>
  );
}

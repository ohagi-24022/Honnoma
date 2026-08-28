import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { requestScanQueueReview } from '../../src/lib/scanQueueReviewBridge';
import { useAppTheme } from '../../src/store/ThemeContext';

export default function TabLayout() {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const safeBottomInset = Math.min(Math.max(insets.bottom, Platform.OS === 'android' ? 10 : 8), 28);
  const interceptTabPress = (targetHref: string) => ({
    tabPress: (event: { preventDefault: () => void }) => {
      if (requestScanQueueReview(targetHref)) {
        event.preventDefault();
      }
    },
  });

  return (
    <Tabs
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 62 + safeBottomInset,
          overflow: 'visible',
          paddingBottom: safeBottomInset,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700', lineHeight: 13, marginTop: 1 },
      }}
    >
      <Tabs.Screen
        name="index"
        listeners={interceptTabPress('/')}
        options={{
          title: '本棚',
          tabBarLabel: '本棚',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons color={color} name={focused ? 'library' : 'library-outline'} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="wishlist"
        listeners={interceptTabPress('/(tabs)/wishlist')}
        options={{
          title: '欲しい',
          tabBarLabel: '欲しい',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons color={color} name={focused ? 'cart' : 'cart-outline'} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'スキャン',
          tabBarLabel: () => null,
          tabBarIcon: ({ color, focused }) => (
            <View
              style={{
                alignItems: 'center',
                backgroundColor: focused ? colors.text : colors.background,
                borderColor: focused ? colors.text : colors.border,
                borderRadius: 32,
                borderWidth: 2,
                height: 64,
                justifyContent: 'center',
                marginBottom: -8,
                shadowColor: '#000000',
                shadowOffset: { height: 3, width: 0 },
                shadowOpacity: 0.14,
                shadowRadius: 7,
                width: 64,
              }}
            >
              <Ionicons
                color={focused ? colors.background : color}
                name={focused ? 'barcode' : 'barcode-outline'}
                size={22}
              />
              <Text
                style={{
                  color: focused ? colors.background : color,
                  fontSize: 10,
                  fontWeight: '800',
                  marginTop: 2,
                }}
              >
                登録
              </Text>
            </View>
          ),
          tabBarItemStyle: {
            marginTop: -14,
          },
        }}
      />
      <Tabs.Screen
        name="ranking"
        listeners={interceptTabPress('/(tabs)/ranking')}
        options={{
          title: '順位',
          tabBarLabel: '順位',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons color={color} name={focused ? 'podium' : 'podium-outline'} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        listeners={interceptTabPress('/(tabs)/settings')}
        options={{
          title: '設定',
          tabBarLabel: '設定',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons color={color} name={focused ? 'settings' : 'settings-outline'} size={24} />
          ),
        }}
      />
    </Tabs>
  );
}


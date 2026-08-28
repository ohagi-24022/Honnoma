import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import {
  createContext,
  PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { hasEnabledNewReleasePushToken } from '../lib/newReleaseNotifications';
import { normalizeSeriesKey } from '../lib/series';
import { supabase } from '../lib/supabase';
import { isFutureJwtError, isMissingSupabaseRelationError } from '../lib/supabaseErrors';
import { useAuth } from './AuthContext';

const LEGACY_STORAGE_KEY = 'booknest.app-settings.v1';
const DEVICE_STORAGE_KEY = 'booknest.device-settings.v1';
const GUEST_USER_STORAGE_KEY = 'booknest.user-settings.guest.v1';
const NEW_RELEASE_NOTIFICATION_STORAGE_KEY_PREFIX = 'booknest.new-release-notifications';

type UserSettings = {
  favoriteSeriesKeys: string[];
  newReleaseNotifications: boolean;
};

type LegacyUserSettings = Partial<UserSettings>;

type DeviceSettings = {
  openExternalPurchaseLinks: boolean;
  trackPurchasePrices: boolean;
};

type AppSettings = UserSettings & DeviceSettings;

type AppSettingsContextValue = AppSettings & {
  hydrated: boolean;
  isFavoriteSeries: (seriesTitle: string) => boolean;
  migrateFavoriteSeries: (fromSeriesTitle: string, toSeriesTitle: string) => void;
  setFavoriteSeries: (seriesTitle: string, favorite: boolean) => void;
  setNewReleaseNotifications: (value: boolean) => void;
  setOpenExternalPurchaseLinks: (value: boolean) => void;
  setTrackPurchasePrices: (value: boolean) => void;
  toggleFavoriteSeries: (seriesTitle: string) => void;
};

const defaultUserSettings: UserSettings = {
  favoriteSeriesKeys: [],
  newReleaseNotifications: false,
};

const defaultDeviceSettings: DeviceSettings = {
  openExternalPurchaseLinks: false,
  trackPurchasePrices: false,
};

const defaultSettings: AppSettings = {
  ...defaultUserSettings,
  ...defaultDeviceSettings,
};

function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeFavoriteKeys(values: string[]) {
  return uniqueValues(values.map((value) => normalizeSeriesKey(value)));
}

async function loadRemoteFavoriteKeys(userId: string) {
  const client = supabase;
  if (!client) return [];

  const fetchFavoriteRows = () =>
    client
      .from('favorite_series')
      .select('series_key, series_title')
      .eq('user_id', userId);

  let { data, error } = await fetchFavoriteRows();
  if (error && isFutureJwtError(error)) {
    const { error: refreshError } = await client.auth.refreshSession();
    if (!refreshError) {
      ({ data, error } = await fetchFavoriteRows());
    }
  }

  if (error) {
    if (isMissingSupabaseRelationError(error)) return [];
    console.warn('Failed to load favorite series from Supabase', error);
    return [];
  }

  return (data ?? []).flatMap((row) => {
    const seriesKey = typeof row.series_key === 'string' ? row.series_key : '';
    const seriesTitle = typeof row.series_title === 'string' ? row.series_title : '';
    return [seriesKey, seriesTitle].map((value) => normalizeSeriesKey(value));
  });
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function AppSettingsProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const userStorageKey = userId ? `booknest.user-settings.${userId}.v1` : GUEST_USER_STORAGE_KEY;
  const newReleaseNotificationStorageKey = `${NEW_RELEASE_NOTIFICATION_STORAGE_KEY_PREFIX}.${userId ?? 'guest'}.v1`;
  const [userSettings, setUserSettings] = useState<UserSettings>(defaultUserSettings);
  const [deviceSettings, setDeviceSettings] = useState<DeviceSettings>(defaultDeviceSettings);
  const [hydrated, setHydrated] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const hydratedStorageKeyRef = useRef<string | null>(null);
  const appStateRefreshAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    hydratedStorageKeyRef.current = null;
    setHydrated(false);

    Promise.all([
      AsyncStorage.getItem(userStorageKey),
      AsyncStorage.getItem(DEVICE_STORAGE_KEY),
      AsyncStorage.getItem(LEGACY_STORAGE_KEY),
      AsyncStorage.getItem(GUEST_USER_STORAGE_KEY),
      AsyncStorage.getItem(newReleaseNotificationStorageKey),
      userId ? hasEnabledNewReleasePushToken(userId) : Promise.resolve(false),
      userId ? loadRemoteFavoriteKeys(userId) : Promise.resolve([]),
    ])
      .then(([storedUserSettings, storedDeviceSettings, legacySettings, guestUserSettings, storedNewReleaseNotification, remoteNewReleaseNotifications, remoteFavoriteKeys]) => {
        if (cancelled) return;
        const parsedUserSettings = storedUserSettings
          ? (JSON.parse(storedUserSettings) as Partial<LegacyUserSettings>)
          : legacySettings && !userId
            ? (JSON.parse(legacySettings) as Partial<LegacyUserSettings>)
            : {};
        const parsedGuestUserSettings = guestUserSettings
          ? (JSON.parse(guestUserSettings) as Partial<UserSettings>)
          : {};
        const parsedDeviceSettings = storedDeviceSettings
          ? (JSON.parse(storedDeviceSettings) as Partial<DeviceSettings>)
          : legacySettings
            ? (JSON.parse(legacySettings) as Partial<DeviceSettings>)
            : {};
        const localFavoriteKeys = Array.isArray(parsedUserSettings.favoriteSeriesKeys)
          ? normalizeFavoriteKeys(parsedUserSettings.favoriteSeriesKeys)
          : [];
        const storedNewReleaseNotifications =
          storedNewReleaseNotification === 'true'
            ? true
            : storedNewReleaseNotification === 'false'
              ? false
              : undefined;
        const guestFavoriteKeys = userId && Array.isArray(parsedGuestUserSettings.favoriteSeriesKeys)
          ? normalizeFavoriteKeys(parsedGuestUserSettings.favoriteSeriesKeys)
          : [];

        const legacyDeviceNewReleaseNotifications =
          'newReleaseNotifications' in parsedDeviceSettings &&
          typeof (parsedDeviceSettings as { newReleaseNotifications?: unknown }).newReleaseNotifications === 'boolean'
            ? (parsedDeviceSettings as { newReleaseNotifications: boolean }).newReleaseNotifications
            : undefined;
        const resolvedNewReleaseNotifications = remoteNewReleaseNotifications
          ? true
          : storedNewReleaseNotifications !== undefined
            ? storedNewReleaseNotifications
            : typeof parsedUserSettings.newReleaseNotifications === 'boolean'
              ? parsedUserSettings.newReleaseNotifications
              : legacyDeviceNewReleaseNotifications ?? defaultUserSettings.newReleaseNotifications;

        setUserSettings({
          ...defaultUserSettings,
          ...parsedUserSettings,
          newReleaseNotifications: resolvedNewReleaseNotifications,
          favoriteSeriesKeys: normalizeFavoriteKeys([...localFavoriteKeys, ...guestFavoriteKeys, ...remoteFavoriteKeys]),
        });
        const { newReleaseNotifications: _legacyNewReleaseNotifications, ...cleanDeviceSettings } = parsedDeviceSettings as Partial<DeviceSettings> & { newReleaseNotifications?: boolean };
        setDeviceSettings({
          ...defaultDeviceSettings,
          ...cleanDeviceSettings,
        });
      })
      .finally(() => {
        if (cancelled) return;
        hydratedStorageKeyRef.current = userStorageKey;
        setHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, [newReleaseNotificationStorageKey, refreshNonce, userId, userStorageKey]);

  useEffect(() => {
    if (!hydrated || hydratedStorageKeyRef.current !== userStorageKey) return;
    AsyncStorage.setItem(userStorageKey, JSON.stringify(userSettings));
    AsyncStorage.setItem(newReleaseNotificationStorageKey, String(userSettings.newReleaseNotifications));
    AsyncStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(deviceSettings));
  }, [deviceSettings, hydrated, newReleaseNotificationStorageKey, userId, userSettings, userStorageKey]);
  useEffect(() => {
    if (!userId) return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      const currentTime = Date.now();
      if (currentTime - appStateRefreshAtRef.current < 5000) return;
      appStateRefreshAtRef.current = currentTime;
      setRefreshNonce((current) => current + 1);
    });
    return () => subscription.remove();
  }, [userId]);

  const value = useMemo(
    () => ({
      ...userSettings,
      ...deviceSettings,
      hydrated,
      isFavoriteSeries: (seriesTitle: string) =>
        userSettings.favoriteSeriesKeys.includes(normalizeSeriesKey(seriesTitle)),
      migrateFavoriteSeries: (fromSeriesTitle: string, toSeriesTitle: string) => {
        const fromKey = normalizeSeriesKey(fromSeriesTitle);
        const toKey = normalizeSeriesKey(toSeriesTitle);
        if (!fromKey || !toKey || fromKey === toKey) return;
        setUserSettings((current) => {
          if (!current.favoriteSeriesKeys.includes(fromKey)) return current;
          return {
            ...current,
            favoriteSeriesKeys: [
              ...current.favoriteSeriesKeys.filter((key) => key !== fromKey && key !== toKey),
              toKey,
            ],
          };
        });
      },
      setNewReleaseNotifications: (newReleaseNotifications: boolean) =>
        setUserSettings((current) => {
          const next = { ...current, newReleaseNotifications };
          if (hydratedStorageKeyRef.current === userStorageKey) {
            void AsyncStorage.setItem(userStorageKey, JSON.stringify(next));
            void AsyncStorage.setItem(newReleaseNotificationStorageKey, String(newReleaseNotifications));
          }
          return next;
        }),
      setFavoriteSeries: (seriesTitle: string, favorite: boolean) => {
        const seriesKey = normalizeSeriesKey(seriesTitle);
        if (!seriesKey) return;
        setUserSettings((current) => {
          const currentKeys = current.favoriteSeriesKeys.filter((key) => key !== seriesKey);
          return {
            ...current,
            favoriteSeriesKeys: favorite ? [...currentKeys, seriesKey] : currentKeys,
          };
        });
        if (supabase && userId) {
          const request = favorite
            ? supabase.from('favorite_series').upsert({
                user_id: userId,
                series_key: seriesKey,
                series_title: seriesTitle,
              })
            : supabase
                .from('favorite_series')
                .delete()
                .eq('user_id', userId)
                .eq('series_key', seriesKey);
          void request.then(({ error }) => {
            if (error && !isMissingSupabaseRelationError(error)) {
              console.warn('Failed to sync favorite series', error);
            }
          });
        }
      },
      setOpenExternalPurchaseLinks: (openExternalPurchaseLinks: boolean) =>
        setDeviceSettings((current) => ({ ...current, openExternalPurchaseLinks })),
      setTrackPurchasePrices: (trackPurchasePrices: boolean) =>
        setDeviceSettings((current) => ({ ...current, trackPurchasePrices })),
      toggleFavoriteSeries: (seriesTitle: string) => {
        const seriesKey = normalizeSeriesKey(seriesTitle);
        if (!seriesKey) return;
        const favorite = !userSettings.favoriteSeriesKeys.includes(seriesKey);
        setUserSettings((current) => {
          const currentKeys = current.favoriteSeriesKeys.filter((key) => key !== seriesKey);
          return {
            ...current,
            favoriteSeriesKeys: favorite ? [...currentKeys, seriesKey] : currentKeys,
          };
        });
        if (supabase && userId) {
          const request = favorite
            ? supabase.from('favorite_series').upsert({
                user_id: userId,
                series_key: seriesKey,
                series_title: seriesTitle,
              })
            : supabase
                .from('favorite_series')
                .delete()
                .eq('user_id', userId)
                .eq('series_key', seriesKey);
          void request.then(({ error }) => {
            if (error && !isMissingSupabaseRelationError(error)) {
              console.warn('Failed to sync favorite series', error);
            }
          });
        }
      },
    }),
    [deviceSettings, hydrated, newReleaseNotificationStorageKey, userId, userSettings, userStorageKey],
  );

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext);
  if (!context) {
    throw new Error('useAppSettings must be used inside AppSettingsProvider');
  }

  return context;
}






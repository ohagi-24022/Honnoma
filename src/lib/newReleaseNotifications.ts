import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';import { Platform } from 'react-native';

import { SeriesGroup } from './seriesSelectors';
import { normalizeSeriesKey } from './series';
import { supabase } from './supabase';


const NEW_RELEASE_NOTIFICATION_LAST_SEEN_STORAGE_PREFIX = 'booknest.new-release-notifications.last-seen.v1';

function getNotificationLastSeenStorageKey(userId: string) {
  return `${NEW_RELEASE_NOTIFICATION_LAST_SEEN_STORAGE_PREFIX}:${userId}`;
}

export async function getNewReleaseNotificationsLastSeenAt(userId: string) {
  return AsyncStorage.getItem(getNotificationLastSeenStorageKey(userId));
}

export async function markNewReleaseNotificationsSeen(userId: string, seenAt = new Date().toISOString()) {
  await AsyncStorage.setItem(getNotificationLastSeenStorageKey(userId), seenAt);
}

export async function hasUnseenNewReleaseNotifications(userId: string) {
  if (!supabase) return false;

  const lastSeenAt = await getNewReleaseNotificationsLastSeenAt(userId);
  let query = supabase
    .from('notification_logs')
    .select('id,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (lastSeenAt) {
    query = query.gt('created_at', lastSeenAt);
  }

  const { data, error } = await query;
  if (error) return false;
  return (data?.length ?? 0) > 0;
}
export type NewReleaseSubscriptionInput = {
  latestVolume?: number;
  seriesKey: string;
  seriesTitle: string;
};

export type NewReleaseSubscription = NewReleaseSubscriptionInput & {
  enabled: boolean;
};

export type NewReleaseCheckResult = {
  checked?: Array<{
    error?: string;
    latestVolume: number | null;
    notified?: number;
    queued?: number;
    seriesTitle: string;
    cached?: boolean;
    source?: string | null;
  }>;
  delivered?: Array<{
    error?: string;
    sent: number;
    status: string;
    userId: string;
  }>;
  error?: string;
  mode?: 'all' | 'check' | 'deliver';
  ok?: boolean;
};

export type NewReleaseNotificationLog = {
  createdAt: string;
  id?: string;
  notificationTitle?: string;
  seriesTitle: string;
  status: string;
  volumeNumber?: number;
};

export type ServerOperationSummary = {
  errorCount: number;
  lastRunAt?: string;
  operation: string;
  provider?: string;
  requestCount: number;
  totalDurationMs: number;
};

function getProjectId() {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}


type NotificationsModule = typeof import('expo-notifications');

let notificationHandlerReady = false;

function isAndroidExpoGo() {
  return Platform.OS === 'android' && Constants.appOwnership === 'expo';
}

async function getNotifications(requireRemotePush = false): Promise<NotificationsModule> {
  if (isAndroidExpoGo()) {
    throw new Error(
      requireRemotePush
        ? 'Android版のExpo Goではプッシュ通知トークンを取得できません。通知機能はdevelopment buildで確認してください。'
        : 'Android版のExpo Goでは通知機能の確認に制限があります。development buildで確認してください。',
    );
  }

  const Notifications = await import('expo-notifications');
  if (!notificationHandlerReady) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    notificationHandlerReady = true;
  }
  return Notifications;
}
function describeFunctionError(error: unknown) {
  if (error instanceof Error) {
    const context = 'context' in error ? (error as { context?: unknown }).context : undefined;
    if (context) {
      try {
        return `${error.message} / ${JSON.stringify(context)}`;
      } catch {
        return `${error.message} / ${String(context)}`;
      }
    }
    return error.message;
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export async function registerForNewReleasePushToken() {
  const Notifications = await getNotifications(true);

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('new-releases', {
      name: '新刊通知',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    throw new Error('通知が許可されていません。端末の設定で通知を許可してください。');
  }

  const projectId = getProjectId();
  if (!projectId) {
    throw new Error('EAS projectId が見つからないため、通知トークンを取得できません。');
  }

  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return token.data;
}

export async function sendNewReleaseDebugNotification() {
  const Notifications = await getNotifications(false);

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('new-releases', {
      name: '新刊通知',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    throw new Error('通知が許可されていません。端末の設定で通知を許可してください。');
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      body: 'この通知が表示されれば、端末側の通知表示は動作しています。',
      data: { url: '/(tabs)' },
      title: '本の間 通知テスト',
    },
    trigger: null,
  });
}
export function buildSeriesSubscriptions(seriesGroups: SeriesGroup[]): NewReleaseSubscriptionInput[] {
  return seriesGroups.map((group) => ({
    latestVolume: group.latestVolume,
    seriesKey: normalizeSeriesKey(group.title),
    seriesTitle: group.title,
  }));
}

export async function enableNewReleaseNotifications(
  userId: string,
  seriesGroups: SeriesGroup[],
) {
  if (!supabase) throw new Error('Supabaseが設定されていません。');

  const expoPushToken = await registerForNewReleasePushToken();
  const now = new Date().toISOString();

  const { error: tokenError } = await supabase.from('push_tokens').upsert(
    {
      enabled: true,
      expo_push_token: expoPushToken,
      last_seen_at: now,
      platform: Platform.OS,
      user_id: userId,
    },
    { onConflict: 'user_id,expo_push_token' },
  );
  if (tokenError) {
    throw new Error(
      `通知トークンを保存できませんでした。${tokenError.message ?? ''}${
        tokenError.code ? ` / code: ${tokenError.code}` : ''
      }`,
    );
  }

  await syncNewReleaseSubscriptions(userId, seriesGroups);
  const subscriptions = await getNewReleaseSubscriptions(userId);

  return {
    enabledSubscriptionCount: subscriptions.filter((subscription) => subscription.enabled).length,
    expoPushToken,
    subscriptionCount: subscriptions.length,
  };
}

export async function getNewReleaseSubscriptions(userId: string) {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('series_subscriptions')
    .select('series_key,series_title,latest_known_volume,enabled')
    .eq('user_id', userId);
  if (error) throw new Error('新刊通知の購読状態を取得できませんでした。');

  return (data ?? []).map((row) => ({
    enabled: Boolean(row.enabled),
    latestVolume:
      typeof row.latest_known_volume === 'number' ? row.latest_known_volume : undefined,
    seriesKey: String(row.series_key),
    seriesTitle: String(row.series_title),
  })) satisfies NewReleaseSubscription[];
}

export async function syncNewReleaseSubscriptions(userId: string, seriesGroups: SeriesGroup[]) {
  if (!supabase) return;
  const subscriptions = buildSeriesSubscriptions(seriesGroups);
  if (subscriptions.length === 0) return;
  const existingSubscriptions = await getNewReleaseSubscriptions(userId);
  const existingByKey = new Map(
    existingSubscriptions.map((subscription) => [subscription.seriesKey, subscription]),
  );
  const currentSeriesKeys = new Set(subscriptions.map((subscription) => subscription.seriesKey));

  const staleSubscriptions = existingSubscriptions.filter(
    (subscription) => !currentSeriesKeys.has(subscription.seriesKey) && subscription.enabled,
  );
  if (staleSubscriptions.length > 0) {
    const { error: staleError } = await supabase
      .from('series_subscriptions')
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in(
        'series_key',
        staleSubscriptions.map((subscription) => subscription.seriesKey),
      );
    if (staleError) throw new Error('古い通知対象シリーズを整理できませんでした。');
  }

  if (subscriptions.length === 0) return;

  const { error } = await supabase.from('series_subscriptions').upsert(
    subscriptions.map((subscription) => ({
      latest_known_volume: subscription.latestVolume ?? null,
      enabled: existingByKey.get(subscription.seriesKey)?.enabled ?? false,
      series_key: subscription.seriesKey,
      series_title: subscription.seriesTitle,
      updated_at: new Date().toISOString(),
      user_id: userId,
    })),
    { onConflict: 'user_id,series_key' },
  );
  if (error) throw new Error('通知対象シリーズを同期できませんでした。');
}

export async function migrateNewReleaseSeriesSubscription(
  userId: string,
  fromSeriesTitle: string,
  toSeriesTitle: string,
  latestVolume?: number,
) {
  if (!supabase) return;
  const fromSeriesKey = normalizeSeriesKey(fromSeriesTitle);
  const toSeriesKey = normalizeSeriesKey(toSeriesTitle);
  if (!fromSeriesKey || !toSeriesKey || fromSeriesKey === toSeriesKey) return;

  const existingSubscriptions = await getNewReleaseSubscriptions(userId);
  const existing = existingSubscriptions.find((subscription) => subscription.seriesKey === fromSeriesKey);
  if (!existing) return;

  const { error: upsertError } = await supabase.from('series_subscriptions').upsert(
    {
      enabled: existing.enabled,
      latest_known_volume: latestVolume ?? existing.latestVolume ?? null,
      series_key: toSeriesKey,
      series_title: toSeriesTitle,
      updated_at: new Date().toISOString(),
      user_id: userId,
    },
    { onConflict: 'user_id,series_key' },
  );
  if (upsertError) throw new Error('変更後のシリーズ通知設定を保存できませんでした。');

  const { error: deleteError } = await supabase
    .from('series_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('series_key', fromSeriesKey);
  if (deleteError) throw new Error('変更前のシリーズ通知設定を整理できませんでした。');
}

export async function setNewReleaseSeriesSubscription(
  userId: string,
  subscription: NewReleaseSubscriptionInput,
  enabled: boolean,
) {
  if (!supabase) throw new Error('Supabaseが設定されていません。');

  const { error } = await supabase.from('series_subscriptions').upsert(
    {
      enabled,
      latest_known_volume: subscription.latestVolume ?? null,
      series_key: subscription.seriesKey,
      series_title: subscription.seriesTitle,
      updated_at: new Date().toISOString(),
      user_id: userId,
    },
    { onConflict: 'user_id,series_key' },
  );
  if (error) throw new Error('シリーズの通知設定を保存できませんでした。');
}

export async function runNewReleaseCheck(limit = 10) {
  if (!supabase) throw new Error('Supabaseが設定されていません。');

  const { data, error } = await supabase.functions.invoke<NewReleaseCheckResult>(
    'check-new-releases',
    { body: { limit, mode: 'all', userLimit: 100 } },
  );
  if (error) {
    throw new Error(`新刊チェックを実行できませんでした。${describeFunctionError(error)}`);
  }
  if (data?.ok === false) {
    throw new Error(data.error ?? '新刊チェックを実行できませんでした。');
  }

  return data ?? { checked: [] };
}

export async function getNewReleaseNotificationLogs(userId: string, limit = 50) {
  if (!supabase) throw new Error('Supabaseが設定されていません。');

  const { data, error } = await supabase
    .from('notification_logs')
    .select('id,series_title,volume_number,status,notification_title,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error('通知履歴を取得できませんでした。');

  return (data ?? []).map((row) => ({
    createdAt: String(row.created_at),
    id: String(row.id),
    notificationTitle: row.notification_title ? String(row.notification_title) : undefined,
    seriesTitle: String(row.series_title),
    status: String(row.status),
    volumeNumber:
      typeof row.volume_number === 'number' ? row.volume_number : undefined,
  })) satisfies NewReleaseNotificationLog[];
}

export async function getServerOperationDiagnostics(hours = 24) {
  if (!supabase) throw new Error('Supabaseが設定されていません。');

  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('server_operation_logs')
    .select('operation,provider,status,request_count,duration_ms,created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) throw new Error('運用ログを取得できませんでした。SQLマイグレーションが反映済みか確認してください。');

  const summaries = new Map<string, ServerOperationSummary>();
  for (const row of data ?? []) {
    const operation = String(row.operation);
    const provider = row.provider ? String(row.provider) : undefined;
    const key = `${operation}:${provider ?? ''}`;
    const current =
      summaries.get(key) ??
      ({
        errorCount: 0,
        lastRunAt: undefined,
        operation,
        provider,
        requestCount: 0,
        totalDurationMs: 0,
      } satisfies ServerOperationSummary);

    current.requestCount += typeof row.request_count === 'number' ? row.request_count : 1;
    current.totalDurationMs += typeof row.duration_ms === 'number' ? row.duration_ms : 0;
    if (String(row.status) === 'error') current.errorCount += 1;
    current.lastRunAt = current.lastRunAt ?? String(row.created_at);
    summaries.set(key, current);
  }

  return [...summaries.values()];
}

export async function getNewReleaseDiagnostics(userId: string) {
  if (!supabase) throw new Error('Supabaseが設定されていません。');

  const [subscriptions, tokenResult, logResult] = await Promise.all([
    getNewReleaseSubscriptions(userId),
    supabase
      .from('push_tokens')
      .select('expo_push_token')
      .eq('user_id', userId)
      .eq('enabled', true),
    supabase
      .from('notification_logs')
      .select('series_title,volume_number,status,notification_title,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(3),
  ]);

  if (tokenResult.error) throw new Error('通知トークンの状態を取得できませんでした。');
  if (logResult.error) throw new Error('通知ログを取得できませんでした。');

  const recentLogs = (logResult.data ?? []).map((row) => ({
    createdAt: String(row.created_at),
    notificationTitle: row.notification_title ? String(row.notification_title) : undefined,
    seriesTitle: String(row.series_title),
    status: String(row.status),
    volumeNumber:
      typeof row.volume_number === 'number' ? row.volume_number : undefined,
  })) satisfies NewReleaseNotificationLog[];

  return {
    activePushTokenCount: tokenResult.data?.length ?? 0,
    enabledSeriesCount: subscriptions.filter((subscription) => subscription.enabled).length,
    recentLogs,
    subscriptionCount: subscriptions.length,
  };
}

export async function hasEnabledNewReleasePushToken(userId: string) {
  if (!supabase) return false;

  const { data, error } = await supabase
    .from('push_tokens')
    .select('expo_push_token')
    .eq('user_id', userId)
    .eq('enabled', true)
    .limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

export async function disableNewReleaseNotifications(userId: string) {
  if (!supabase) return;

  const { error: tokenError } = await supabase
    .from('push_tokens')
    .update({ enabled: false, last_seen_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (tokenError) throw new Error('通知トークンを無効化できませんでした。');
}

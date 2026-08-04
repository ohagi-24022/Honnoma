// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

type FunctionMode = 'all' | 'check' | 'deliver';

type SubscriptionRow = {
  id: string;
  latest_known_volume: number | null;
  series_key: string;
  series_title: string;
  user_id: string;
};

type PushTokenRow = {
  expo_push_token: string;
  user_id: string;
};

type NotificationLogRow = {
  attempt_count: number | null;
  id: string;
  user_id: string;
};

type PublicationCheckRow = {
  checked_at: string;
  latest_volume: number | null;
  raw: Record<string, unknown> | null;
  source: string | null;
};

type RakutenBooksResponse = {
  Items?: Array<{
    Item?: {
      title?: string;
    };
  }>;
};

type RakutenProxyResponse = {
  body: RakutenBooksResponse | unknown;
  ok: boolean;
  status: number;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
const CHECK_NEW_RELEASES_SECRET = Deno.env.get('CHECK_NEW_RELEASES_SECRET') ?? '';
const FUNCTION_SECRET =
  SUPABASE_SERVICE_ROLE_KEY ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CHECK_CACHE_HOURS = 20;
const DEFAULT_CHECK_LIMIT = 30;
const DEFAULT_USER_LIMIT = 100;
const LOG_RETENTION_DAYS = 90;
const OPERATION_LOG_RETENTION_DAYS = 30;

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-booknest-cron-secret, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const startedAt = Date.now();
    const body = await safeJson(request);
    const mode = normalizeMode(body.mode);
    const limit = Number.isFinite(body.limit)
      ? Math.min(Math.max(Number(body.limit), 1), 100)
      : DEFAULT_CHECK_LIMIT;
    const userLimit = Number.isFinite(body.userLimit)
      ? Math.min(Math.max(Number(body.userLimit), 1), 500)
      : DEFAULT_USER_LIMIT;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse(
        {
          checked: [],
          delivered: [],
          error: 'SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が Edge Function に設定されていません。',
          ok: false,
        },
        200,
      );
    }

    if (!isAuthorizedSchedulerRequest(request)) {
      await writeOperationLog({
        durationMs: Date.now() - startedAt,
        metadata: { mode, reason: 'unauthorized' },
        operation: 'check-new-releases',
        provider: 'supabase-edge-function',
        requestCount: 1,
        status: 'error',
      });
      return jsonResponse(
        {
          checked: [],
          delivered: [],
          error: 'This function can only be executed by the scheduled worker.',
          ok: false,
        },
        403,
      );
    }

    await pruneOldNotificationLogs();
    await pruneOldOperationLogs();

    const checked = mode === 'deliver' ? [] : await checkSeries(limit);
    const delivered = mode === 'check' ? [] : await deliverDailyNotifications(userLimit);

    await writeOperationLog({
      durationMs: Date.now() - startedAt,
      metadata: {
        checkedCount: checked.length,
        deliveredUserCount: delivered.length,
        limit,
        mode,
        userLimit,
      },
      operation: 'check-new-releases',
      provider: 'supabase-edge-function',
      requestCount: 1,
      status: 'ok',
    });

    return jsonResponse({ checked, delivered, mode, ok: true });
  } catch (error) {
    await writeOperationLog({
      metadata: { error: describeError(error) },
      operation: 'check-new-releases',
      provider: 'supabase-edge-function',
      requestCount: 1,
      status: 'error',
    });
    return jsonResponse(
      { checked: [], delivered: [], error: describeError(error), ok: false },
      200,
    );
  }
});

async function checkSeries(limit: number) {
  const { data: subscriptions, error } = await supabase
    .from('series_subscriptions')
    .select('id,user_id,series_key,series_title,latest_known_volume')
    .eq('enabled', true)
    .order('updated_at', { ascending: true })
    .limit(limit * 20);

  if (error) throw error;

  const seriesByKey = new Map<string, SubscriptionRow[]>();
  for (const subscription of (subscriptions ?? []) as SubscriptionRow[]) {
    const rows = seriesByKey.get(subscription.series_key) ?? [];
    rows.push(subscription);
    seriesByKey.set(subscription.series_key, rows);
  }

  const checked: Array<{
    latestVolume: number | null;
    queued: number;
    seriesTitle: string;
    source?: string | null;
    cached?: boolean;
    error?: string;
  }> = [];

  for (const subscriptionsForSeries of [...seriesByKey.values()].slice(0, limit)) {
    const firstSubscription = subscriptionsForSeries[0];
    try {
      const publication = await getLatestPublication(firstSubscription.series_key, firstSubscription.series_title);
      const latestVolume = publication.latestVolume;
      let queued = 0;

      if (latestVolume) {
        for (const subscription of subscriptionsForSeries) {
          if (latestVolume <= (subscription.latest_known_volume ?? 0)) continue;
          const inserted = await insertNotificationLog(subscription, latestVolume);
          if (inserted) queued += 1;

          const { error: updateError } = await supabase
            .from('series_subscriptions')
            .update({
              latest_known_volume: latestVolume,
              updated_at: new Date().toISOString(),
            })
            .eq('id', subscription.id);
          if (updateError) throw updateError;
        }
      }

      checked.push({
        cached: publication.cached,
        latestVolume,
        queued,
        seriesTitle: firstSubscription.series_title,
        source: publication.source,
      });
    } catch (subscriptionError) {
      checked.push({
        error: describeError(subscriptionError),
        latestVolume: null,
        queued: 0,
        seriesTitle: firstSubscription.series_title,
      });
    }
  }

  return checked;
}

async function getLatestPublication(seriesKey: string, seriesTitle: string) {
  const cached = await getRecentPublicationCheck(seriesKey);
  if (cached) {
    return {
      cached: true,
      latestVolume: cached.latest_volume,
      source: cached.source,
    };
  }

  const latestVolume = await lookupLatestSeriesVolume(seriesTitle);
  const { error: checkError } = await supabase.from('publication_checks').insert({
    latest_volume: latestVolume,
    raw: {
      cacheHours: CHECK_CACHE_HOURS,
      checkedBy: 'check-new-releases',
    },
    series_key: seriesKey,
    series_title: seriesTitle,
    source: latestVolume ? 'Rakuten Books' : null,
  });
  if (checkError) throw checkError;

  return {
    cached: false,
    latestVolume,
    source: latestVolume ? 'Rakuten Books' : null,
  };
}

async function getRecentPublicationCheck(seriesKey: string): Promise<PublicationCheckRow | null> {
  const since = new Date(Date.now() - CHECK_CACHE_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('publication_checks')
    .select('latest_volume,source,checked_at,raw')
    .eq('series_key', seriesKey)
    .gte('checked_at', since)
    .order('checked_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as PublicationCheckRow | null;
}

async function deliverDailyNotifications(userLimit: number) {
  const { data: logs, error } = await supabase
    .from('notification_logs')
    .select('id,user_id,attempt_count')
    .eq('status', 'pending')
    .lte('next_retry_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(userLimit * 20);
  if (error) throw error;

  const logsByUser = new Map<string, NotificationLogRow[]>();
  for (const log of (logs ?? []) as NotificationLogRow[]) {
    const rows = logsByUser.get(log.user_id) ?? [];
    rows.push(log);
    logsByUser.set(log.user_id, rows);
  }

  const userIds = [...logsByUser.keys()].slice(0, userLimit);
  const delivered: Array<{ sent: number; status: string; userId: string; error?: string }> = [];

  for (const userId of userIds) {
    const targetLogs = logsByUser.get(userId) ?? [];
    const targetLogIds = targetLogs.map((log) => log.id);
    if (targetLogIds.length === 0) continue;

    try {
      const { data: tokens, error: tokenError } = await supabase
        .from('push_tokens')
        .select('user_id,expo_push_token')
        .eq('user_id', userId)
        .eq('enabled', true);
      if (tokenError) throw tokenError;

      let sent = 0;
      let lastResponse: unknown = null;
      let lastError: string | null = null;
      for (const token of (tokens ?? []) as PushTokenRow[]) {
        const response = await sendExpoPush({
          body: '蒐集架で新刊情報を確認できます。',
          data: {
            url: '/(tabs)/notifications',
          },
          sound: 'default',
          title: '蒐集架 新刊情報',
          to: token.expo_push_token,
        });
        lastResponse = response;
        const pushResult = parseExpoPushResult(response);
        if (pushResult.accepted) {
          sent += 1;
        } else {
          lastError = pushResult.error;
          if (pushResult.deviceNotRegistered) {
            await supabase
              .from('push_tokens')
              .update({ enabled: false })
              .eq('user_id', userId)
              .eq('expo_push_token', token.expo_push_token);
          }
        }
      }

      const attemptCount = nextAttemptCount(targetLogs);
      const willRetry = sent === 0 && attemptCount < 5;
      const status = sent > 0 ? 'sent' : willRetry ? 'pending' : 'failed';
      const { error: updateError } = await supabase
        .from('notification_logs')
        .update({
          attempt_count: sent > 0 ? 0 : attemptCount,
          delivered_at: sent > 0 ? new Date().toISOString() : null,
          failed_at: status === 'failed' ? new Date().toISOString() : null,
          last_error: sent > 0 ? null : lastError ?? 'No enabled push token was available.',
          next_retry_at: sent > 0 ? new Date().toISOString() : nextRetryAt(attemptCount),
          notification_title: '蒐集架 新刊情報',
          response: lastResponse,
          status,
        })
        .in('id', targetLogIds);
      if (updateError) throw updateError;

      delivered.push({ sent, status, userId });
    } catch (deliveryError) {
      const attemptCount = nextAttemptCount(targetLogs);
      const willRetry = attemptCount < 5;
      await supabase
        .from('notification_logs')
        .update({
          attempt_count: attemptCount,
          failed_at: willRetry ? null : new Date().toISOString(),
          last_error: describeError(deliveryError),
          next_retry_at: nextRetryAt(attemptCount),
          status: willRetry ? 'pending' : 'failed',
        })
        .in('id', targetLogIds);

      delivered.push({
        error: describeError(deliveryError),
        sent: 0,
        status: willRetry ? 'retry' : 'failed',
        userId,
      });
    }
  }

  return delivered;
}

function nextAttemptCount(logs: NotificationLogRow[]) {
  return Math.max(0, ...logs.map((log) => log.attempt_count ?? 0)) + 1;
}

function nextRetryAt(attemptCount: number) {
  const retryMinutes = Math.min(60 * 24, 5 * 2 ** Math.max(0, attemptCount - 1));
  return new Date(Date.now() + retryMinutes * 60 * 1000).toISOString();
}

async function pruneOldNotificationLogs() {
  const before = new Date(Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from('notification_logs').delete().lt('created_at', before);
  if (error) throw error;
}

async function pruneOldOperationLogs() {
  const before = new Date(Date.now() - OPERATION_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('server_operation_logs').delete().lt('created_at', before);
}

async function safeJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function normalizeMode(value: unknown): FunctionMode {
  if (value === 'check' || value === 'deliver' || value === 'all') return value;
  return 'all';
}

function isAuthorizedSchedulerRequest(request: Request) {
  const cronSecret = request.headers.get('x-booknest-cron-secret') ?? '';
  if (CHECK_NEW_RELEASES_SECRET && cronSecret === CHECK_NEW_RELEASES_SECRET) return true;

  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return getJwtRole(token) === 'service_role';
}

function getJwtRole(token: string) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded)) as { role?: string };
    return decoded.role;
  } catch {
    return undefined;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

async function lookupLatestSeriesVolume(seriesTitle: string) {
  const startedAt = Date.now();
  const params = {
    hits: '30',
    outOfStockFlag: '1',
    size: '9',
    sort: '-releaseDate',
    title: seriesTitle,
  };
  const response = await fetch(`${SUPABASE_URL}/functions/v1/rakuten-books`, {
    body: JSON.stringify({
      params,
      path: 'BooksBook/Search/20170404',
    }),
    headers: {
      Authorization: `Bearer ${FUNCTION_SECRET}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  if (!response.ok) {
    await writeOperationLog({
      durationMs: Date.now() - startedAt,
      metadata: { endpoint: 'BooksBook/Search/20170404', seriesTitle, status: response.status },
      operation: 'external-api-call',
      provider: 'Rakuten Books',
      requestCount: 1,
      status: 'error',
    });
    return null;
  }

  const payload = (await response.json()) as RakutenProxyResponse;
  await writeOperationLog({
    durationMs: Date.now() - startedAt,
    metadata: {
      endpoint: 'BooksBook/Search/20170404',
      ok: payload.ok,
      seriesTitle,
      status: payload.status,
    },
    operation: 'external-api-call',
    provider: 'Rakuten Books',
    requestCount: 1,
    status: payload.ok ? 'ok' : 'error',
  });

  if (!payload.ok || !isRakutenBooksResponse(payload.body)) return null;

  const volumes = payload.body.Items
    ?.map((entry) => entry.Item?.title)
    .map((title) => (title ? parseVolumeNumber(title) : null))
    .filter((volume): volume is number => !!volume && volume > 0 && volume <= 500);

  return volumes && volumes.length > 0 ? Math.max(...volumes) : null;
}

async function writeOperationLog(input: {
  durationMs?: number;
  metadata?: Record<string, unknown>;
  operation: string;
  provider?: string;
  requestCount?: number;
  status: 'ok' | 'error' | 'skipped';
}) {
  try {
    await supabase.from('server_operation_logs').insert({
      duration_ms: input.durationMs ?? null,
      metadata: input.metadata ?? null,
      operation: input.operation,
      provider: input.provider ?? null,
      request_count: input.requestCount ?? 1,
      status: input.status,
    });
  } catch {
    // Operation logs are useful for migration planning, but must never block user-facing work.
  }
}

function isRakutenBooksResponse(value: unknown): value is RakutenBooksResponse {
  return typeof value === 'object' && value !== null && Array.isArray((value as RakutenBooksResponse).Items);
}

function parseVolumeNumber(title: string) {
  const normalized = title.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const patterns = [
    /(?:第\s*)?([0-9]{1,3})\s*巻/,
    /(?:^|[\s:・\-ー])([0-9]{1,3})(?=$|[\s()（）「」『』])/,
    /[（(]\s*(?:第\s*)?([0-9]{1,3})\s*(?:巻)?/,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) return Number.parseInt(match[1], 10);
  }
  return null;
}

async function insertNotificationLog(
  subscription: SubscriptionRow,
  latestVolume: number,
) {
  const { error } = await supabase.from('notification_logs').insert({
    series_key: subscription.series_key,
    series_title: subscription.series_title,
    status: 'pending',
    user_id: subscription.user_id,
    volume_number: latestVolume,
  });

  if (!error) return true;
  if (error.code === '23505') return false;
  throw error;
}

function parseExpoPushResult(response: { body: unknown; ok: boolean; status: number }) {
  const body = response.body as { data?: unknown; errors?: unknown } | null;
  const data = Array.isArray(body?.data) ? body?.data[0] : body?.data;
  const dataRecord = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  const details = dataRecord?.details && typeof dataRecord.details === 'object'
    ? (dataRecord.details as Record<string, unknown>)
    : null;
  const ticketStatus = typeof dataRecord?.status === 'string' ? dataRecord.status : undefined;
  const detailError = typeof details?.error === 'string' ? details.error : undefined;
  const message = typeof dataRecord?.message === 'string' ? dataRecord.message : undefined;

  if (response.ok && ticketStatus !== 'error') {
    return { accepted: true, deviceNotRegistered: false, error: null as string | null };
  }

  const error = detailError || message || `Expo Push HTTP ${response.status}`;
  return {
    accepted: false,
    deviceNotRegistered: detailError === 'DeviceNotRegistered',
    error,
  };
}

async function sendExpoPush(message: Record<string, unknown>) {
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    body: JSON.stringify(message),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  return {
    body: await response.json().catch(() => null),
    ok: response.ok,
    status: response.status,
  };
}

function describeError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const parts = [
      record.message,
      record.code ? `code: ${record.code}` : null,
      record.details ? `details: ${record.details}` : null,
      record.hint ? `hint: ${record.hint}` : null,
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(' / ');

    try {
      return JSON.stringify(record);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
  return String(error);
}

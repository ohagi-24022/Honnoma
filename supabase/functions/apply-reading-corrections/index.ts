// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

type SuggestionRow = {
  series_key: string;
  series_title: string;
  suggested_reading: string;
  updated_at: string;
  user_id: string;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
const APPLY_READING_CORRECTIONS_SECRET =
  Deno.env.get('APPLY_READING_CORRECTIONS_SECRET') ?? Deno.env.get('CHECK_NEW_RELEASES_SECRET') ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-booknest-cron-secret, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.', ok: false }, 200);
    }
    if (!isAuthorizedSchedulerRequest(request)) {
      return jsonResponse({ error: 'This function can only be executed by the scheduled worker.', ok: false }, 403);
    }

    const body = await safeJson(request);
    const minCount = Number.isFinite(body.minCount) ? Math.max(Number(body.minCount), 1) : 2;
    const limit = Number.isFinite(body.limit) ? Math.min(Math.max(Number(body.limit), 1), 500) : 200;

    const { data, error } = await supabase
      .from('series_reading_suggestions')
      .select('series_key,series_title,suggested_reading,updated_at,user_id')
      .order('updated_at', { ascending: false })
      .limit(5000);

    if (error) throw error;

    const corrections = buildCorrections((data ?? []) as SuggestionRow[], minCount).slice(0, limit);
    if (corrections.length > 0) {
      const { error: upsertError } = await supabase.from('series_reading_corrections').upsert(corrections, {
        onConflict: 'series_key',
      });
      if (upsertError) throw upsertError;
    }

    return jsonResponse({ corrected: corrections.length, corrections, ok: true }, 200);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'unknown error', ok: false }, 500);
  }
});

function buildCorrections(rows: SuggestionRow[], minCount: number) {
  const bySeries = new Map<string, Map<string, { latest: string; seriesTitle: string; users: Set<string> }>>();

  for (const row of rows) {
    const seriesKey = cleanText(row.series_key);
    const reading = cleanText(row.suggested_reading);
    if (!seriesKey || !reading || hasKanji(reading)) continue;

    const byReading = bySeries.get(seriesKey) ?? new Map();
    const current = byReading.get(reading) ?? {
      latest: row.updated_at,
      seriesTitle: cleanText(row.series_title) ?? row.series_key,
      users: new Set<string>(),
    };
    current.users.add(row.user_id);
    if (row.updated_at > current.latest) {
      current.latest = row.updated_at;
      current.seriesTitle = cleanText(row.series_title) ?? current.seriesTitle;
    }
    byReading.set(reading, current);
    bySeries.set(seriesKey, byReading);
  }

  return [...bySeries.entries()]
    .map(([seriesKey, readings]) => {
      const candidates = [...readings.entries()]
        .map(([reading, value]) => ({ reading, ...value, count: value.users.size }))
        .filter((candidate) => candidate.count >= minCount)
        .sort((left, right) => right.count - left.count || right.latest.localeCompare(left.latest) || left.reading.localeCompare(right.reading));
      const winner = candidates[0];
      if (!winner) return null;
      const totalCount = [...readings.values()].reduce((sum, value) => sum + value.users.size, 0);
      return {
        corrected_reading: winner.reading,
        series_key: seriesKey,
        series_title: winner.seriesTitle,
        source: 'user_suggestions',
        suggestion_count: winner.count,
        total_count: totalCount,
        updated_at: new Date().toISOString(),
      };
    })
    .filter((value): value is NonNullable<typeof value> => !!value)
    .sort((left, right) => right.suggestion_count - left.suggestion_count || left.series_title.localeCompare(right.series_title));
}

function cleanText(value?: string | null) {
  const cleaned = value?.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

function hasKanji(value: string) {
  return /[一-龯]/.test(value);
}

function isAuthorizedSchedulerRequest(request: Request) {
  if (!APPLY_READING_CORRECTIONS_SECRET) return false;
  return request.headers.get('x-booknest-cron-secret') === APPLY_READING_CORRECTIONS_SECRET;
}

async function safeJson(request: Request) {
  try {
    return await request.json();
  } catch (_error) {
    return {};
  }
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

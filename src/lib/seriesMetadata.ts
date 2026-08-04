import AsyncStorage from '@react-native-async-storage/async-storage';

import { SeriesPublicationInfo } from './bookApis';
import { normalizeSeriesKey } from './series';
import { supabase } from './supabase';
import { isMissingSupabaseRelationError } from './supabaseErrors';

export const SERIES_METADATA_STORAGE_KEY = 'booknest.series-metadata.v1';

export type SeriesMetadataOverride = {
  seriesKey: string;
  seriesTitle: string;
  displayTitle?: string;
  latestVolume?: number;
  isCompleted?: boolean;
  coverUrl?: string;
  publisher?: string;
  source?: 'manual' | 'api' | 'imported';
  updatedAt?: string;
};

type SeriesMetadataRow = {
  series_key: string;
  series_title: string;
  display_title: string | null;
  latest_volume: number | null;
  is_completed: boolean | null;
  cover_url: string | null;
  publisher: string | null;
  source: string | null;
  updated_at: string | null;
};

function normalizeOptionalText(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeLatestVolume(value?: number) {
  if (!Number.isFinite(value ?? NaN)) return undefined;
  const volume = Math.floor(value as number);
  return volume > 0 ? volume : undefined;
}

function normalizeOverride(override: SeriesMetadataOverride): SeriesMetadataOverride {
  const seriesTitle = normalizeOptionalText(override.seriesTitle) ?? override.seriesKey;
  const seriesKey = normalizeSeriesKey(override.seriesKey || seriesTitle);
  return {
    seriesKey,
    seriesTitle,
    displayTitle: normalizeOptionalText(override.displayTitle),
    latestVolume: normalizeLatestVolume(override.latestVolume),
    isCompleted: typeof override.isCompleted === 'boolean' ? override.isCompleted : undefined,
    coverUrl: normalizeOptionalText(override.coverUrl),
    publisher: normalizeOptionalText(override.publisher),
    source: override.source ?? 'manual',
    updatedAt: override.updatedAt ?? new Date().toISOString(),
  };
}

function rowToOverride(row: SeriesMetadataRow): SeriesMetadataOverride {
  return normalizeOverride({
    seriesKey: row.series_key,
    seriesTitle: row.series_title,
    displayTitle: row.display_title ?? undefined,
    latestVolume: row.latest_volume ?? undefined,
    isCompleted: row.is_completed ?? undefined,
    coverUrl: row.cover_url ?? undefined,
    publisher: row.publisher ?? undefined,
    source: row.source === 'api' || row.source === 'imported' ? row.source : 'manual',
    updatedAt: row.updated_at ?? undefined,
  });
}

export async function loadLocalSeriesMetadata() {
  const stored = await AsyncStorage.getItem(SERIES_METADATA_STORAGE_KEY);
  if (!stored) return {} as Record<string, SeriesMetadataOverride>;
  const parsed = JSON.parse(stored) as Record<string, SeriesMetadataOverride>;
  return Object.fromEntries(Object.values(parsed).map((value) => {
    const normalized = normalizeOverride(value);
    return [normalized.seriesKey, normalized];
  }));
}

async function saveLocalSeriesMetadata(values: Record<string, SeriesMetadataOverride>) {
  await AsyncStorage.setItem(SERIES_METADATA_STORAGE_KEY, JSON.stringify(values));
}

export async function loadSeriesMetadata(userId?: string | null) {
  const localValues = await loadLocalSeriesMetadata();
  if (!userId || !supabase) return localValues;

  const { data, error } = await supabase
    .from('series_metadata')
    .select('series_key, series_title, display_title, latest_volume, is_completed, cover_url, publisher, source, updated_at')
    .eq('user_id', userId);

  if (error) {
    if (!isMissingSupabaseRelationError(error)) {
      console.warn('Failed to load series metadata overrides', error);
    }
    return localValues;
  }

  const remoteValues = Object.fromEntries(
    (data ?? []).map((row) => {
      const override = rowToOverride(row as SeriesMetadataRow);
      return [override.seriesKey, override];
    }),
  );
  const merged = { ...localValues, ...remoteValues };
  await saveLocalSeriesMetadata(merged);
  return merged;
}

export async function upsertSeriesMetadataOverride(userId: string | null | undefined, override: SeriesMetadataOverride) {
  const normalized = normalizeOverride(override);
  const localValues = await loadLocalSeriesMetadata();
  const merged = { ...localValues, [normalized.seriesKey]: normalized };
  await saveLocalSeriesMetadata(merged);

  if (userId && supabase) {
    const { error } = await supabase.from('series_metadata').upsert(
      {
        user_id: userId,
        series_key: normalized.seriesKey,
        series_title: normalized.seriesTitle,
        display_title: normalized.displayTitle ?? null,
        latest_volume: normalized.latestVolume ?? null,
        is_completed: normalized.isCompleted ?? null,
        cover_url: normalized.coverUrl ?? null,
        publisher: normalized.publisher ?? null,
        source: normalized.source ?? 'manual',
        updated_at: normalized.updatedAt ?? new Date().toISOString(),
      },
      { onConflict: 'user_id,series_key' },
    );
    if (error) throw error;
  }

  return normalized;
}

export function overrideToPublicationInfo(override?: SeriesMetadataOverride): SeriesPublicationInfo | null {
  if (!override?.latestVolume) return null;
  return {
    latestVolume: override.latestVolume,
    source: 'Google Books',
    checkedAt: override.updatedAt ?? new Date().toISOString(),
    isCompleted: override.isCompleted,
  };
}

export function mergeSeriesPublicationInfo(
  publicationInfo?: SeriesPublicationInfo | null,
  override?: SeriesMetadataOverride,
): SeriesPublicationInfo | undefined {
  const overridePublication = overrideToPublicationInfo(override);
  if (!publicationInfo) return overridePublication ?? undefined;
  if (!overridePublication) {
    if (typeof override?.isCompleted === 'boolean') return { ...publicationInfo, isCompleted: override.isCompleted };
    return publicationInfo;
  }
  return {
    ...publicationInfo,
    latestVolume: overridePublication.latestVolume,
    checkedAt: overridePublication.checkedAt,
    isCompleted: overridePublication.isCompleted ?? publicationInfo.isCompleted,
  };
}

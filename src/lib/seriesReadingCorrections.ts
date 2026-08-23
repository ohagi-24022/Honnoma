import { normalizeSeriesKey } from './series';
import { supabase } from './supabase';
import { isMissingSupabaseRelationError } from './supabaseErrors';

export type SeriesReadingCorrection = {
  correctedReading: string;
  seriesKey: string;
  seriesTitle: string;
  suggestionCount: number;
  totalCount: number;
};

type SeriesReadingCorrectionRow = {
  corrected_reading: string | null;
  series_key: string | null;
  series_title: string | null;
  suggestion_count: number | null;
  total_count: number | null;
};

function cleanText(value?: string | null) {
  const cleaned = value?.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return cleaned || undefined;
}

export async function loadSeriesReadingCorrections() {
  if (!supabase) return new Map<string, SeriesReadingCorrection>();

  const { data, error } = await supabase
    .from('series_reading_corrections')
    .select('series_key,series_title,corrected_reading,suggestion_count,total_count')
    .order('suggestion_count', { ascending: false })
    .limit(500);

  if (error) {
    if (isMissingSupabaseRelationError(error)) return new Map<string, SeriesReadingCorrection>();
    throw error;
  }

  return new Map(
    ((data ?? []) as SeriesReadingCorrectionRow[])
      .map((row) => {
        const seriesTitle = cleanText(row.series_title);
        const seriesKey = cleanText(row.series_key) ?? (seriesTitle ? normalizeSeriesKey(seriesTitle) : undefined);
        const correctedReading = cleanText(row.corrected_reading);
        if (!seriesKey || !seriesTitle || !correctedReading) return null;
        return [
          seriesKey,
          {
            correctedReading,
            seriesKey,
            seriesTitle,
            suggestionCount: Number(row.suggestion_count ?? 0),
            totalCount: Number(row.total_count ?? 0),
          } satisfies SeriesReadingCorrection,
        ] as const;
      })
      .filter((entry): entry is readonly [string, SeriesReadingCorrection] => !!entry),
  );
}

export function resolveSeriesReadingCorrection(
  corrections: Map<string, SeriesReadingCorrection>,
  seriesTitle: string,
) {
  return corrections.get(normalizeSeriesKey(seriesTitle));
}

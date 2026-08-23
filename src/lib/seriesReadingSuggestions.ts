import { normalizeSeriesKey } from './series';
import { supabase } from './supabase';

export type SeriesReadingSuggestionInput = {
  userId: string;
  seriesTitle: string;
  currentReading?: string | null;
  suggestedReading: string;
  note?: string;
};

function cleanText(value?: string | null) {
  const cleaned = value?.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

export async function submitSeriesReadingSuggestion(input: SeriesReadingSuggestionInput) {
  if (!supabase) throw new Error('Supabaseが設定されていません。');

  const seriesTitle = cleanText(input.seriesTitle);
  const suggestedReading = cleanText(input.suggestedReading);
  if (!seriesTitle) throw new Error('シリーズを選択してください。');
  if (!suggestedReading) throw new Error('読み方を入力してください。');

  const { error } = await supabase.from('series_reading_suggestions').upsert(
    {
      user_id: input.userId,
      series_key: normalizeSeriesKey(seriesTitle),
      series_title: seriesTitle,
      current_reading: cleanText(input.currentReading),
      suggested_reading: suggestedReading,
      note: cleanText(input.note),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,series_key' },
  );

  if (error) {
    if (error.code === '42P01' || error.message.includes('series_reading_suggestions')) {
      throw new Error('読み方報告用のテーブルが未作成です。Supabaseのマイグレーションを反映してください。');
    }
    if (error.code === '42501') {
      throw new Error('読み方報告へのアクセス権限がありません。SupabaseのRLS/GRANT設定を確認してください。');
    }
    throw new Error('読み方の報告を保存できませんでした。しばらくしてからもう一度お試しください。');
  }
}

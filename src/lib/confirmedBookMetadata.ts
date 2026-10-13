import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizeKnownIsbn } from './knownBookOverrides';
import { supabase } from './supabase';

export type ConfirmedBookMetadata = {
  normalized_isbn: string;
  title: string;
  subtitle?: string | null;
  series_title?: string | null;
  volume_number?: number | null;
  author?: string | null;
  publisher?: string | null;
  description?: string | null;
  thumbnail_url?: string | null;
  source_url?: string | null;
  list_price?: number | null;
  price_source?: 'rakuten' | 'google' | 'manual' | null;
  price_fetched_at?: string | null;
  confirmed_at?: string;
};

// Separate from expiring provider caches: a refresh must never erase the last confirmed ISBN.
const PREFIX = 'honnoma.confirmed-metadata.v1:';
function matches(row: ConfirmedBookMetadata | null | undefined, isbn: string): row is ConfirmedBookMetadata {
  return !!row?.title && normalizeKnownIsbn(row.normalized_isbn) === isbn;
}

export async function getConfirmedBookMetadata(isbn?: string): Promise<ConfirmedBookMetadata | null | undefined> {
  const normalized = normalizeKnownIsbn(isbn);
  if (!normalized) return undefined;
  const key = PREFIX + normalized;
  if (supabase) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const { data, error } = await supabase.rpc('get_confirmed_book_metadata', { p_isbn: normalized }).abortSignal(controller.signal);
      if (error) throw error;
      if (!data || !Object.prototype.hasOwnProperty.call(data, 'metadata')) throw new Error('Invalid confirmed metadata response');
      const row = data.metadata as ConfirmedBookMetadata | null;
      if (row !== null && !matches(row, normalized)) throw new Error('Confirmed metadata ISBN mismatch');
      try {
        if (row) await AsyncStorage.setItem(key, JSON.stringify(row));
        else await AsyncStorage.removeItem(key); // An explicit withdrawal takes precedence over offline data.
      } catch (error) {
        console.warn('Failed to persist confirmed book metadata', error);
      }
      return row;
    } catch (error) {
      console.warn('Failed to read confirmed book metadata', error);
    } finally {
      clearTimeout(timeout);
    }
  }
  try {
    const stored = await AsyncStorage.getItem(key);
    const row = stored ? JSON.parse(stored) as ConfirmedBookMetadata : null;
    if (matches(row, normalized)) return row;
  } catch (error) {
    console.warn('Failed to read saved confirmed book metadata', error);
  }
  return undefined;
}

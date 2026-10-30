import AsyncStorage from '@react-native-async-storage/async-storage';

import { Book } from '../types';
import { getStorageItemWithLegacy } from './asyncStorageCompat';
import { BookVolumeDetails, lookupBookVolumeDetails } from './bookApis';
import { getBookMetadataOverrideDetails } from './bookMetadataOverrides';
import { normalizeSeriesKey } from './series';
import { getDemoBookDetails } from './demoLibrary';
import { supabase } from './supabase';

const LEGACY_CACHE_PREFIX = 'booknest.book-details.v3';
const CACHE_PREFIX = 'honnoma.book-details.v4';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DB_CACHE_TTL_DAYS = 30;

type CacheEntry = {
  fetchedAt: number;
  details: BookVolumeDetails | null;
};

type BookMetadataCacheRow = {
  id: string;
  isbn: string | null;
  normalized_isbn: string | null;
  title: string;
  subtitle: string | null;
  series_title: string | null;
  series_key: string | null;
  volume_number: number | null;
  author: string | null;
  publisher: string | null;
  description: string | null;
  thumbnail_url: string | null;
  list_price: number | null;
  price_source: 'rakuten' | 'google' | 'manual' | null;
  price_fetched_at: string | null;
  source: BookVolumeDetails['source'];
  source_url: string | null;
  fetched_at: string;
  expires_at: string;
};

function normalizeIsbn(value?: string) {
  return value?.replace(/[^0-9X]/gi, '').toUpperCase();
}

function cacheKey(book: Pick<Book, 'id' | 'isbn'>) {
  const identity = normalizeIsbn(book.isbn) || book.id;
  return `${CACHE_PREFIX}:${identity}`;
}

function legacyCacheKey(book: Pick<Book, 'id' | 'isbn'>) {
  const identity = normalizeIsbn(book.isbn) || book.id;
  return `${LEGACY_CACHE_PREFIX}:${identity}`;
}

function dbRowToDetails(row: BookMetadataCacheRow): BookVolumeDetails {
  return {
    title: row.title,
    subtitle: row.subtitle ?? undefined,
    author: row.author ?? undefined,
    publisher: row.publisher ?? undefined,
    description: row.description ?? undefined,
    thumbnailUrl: row.thumbnail_url ?? undefined,
    listPrice: row.list_price ?? undefined,
    priceSource: row.price_source ?? undefined,
    priceFetchedAt: row.price_fetched_at ?? undefined,
    source: row.source,
    sourceUrl: row.source_url ?? undefined,
    checkedAt: row.fetched_at,
  };
}

function dbCacheIsFresh(row: Pick<BookMetadataCacheRow, 'expires_at'>) {
  return Number.isFinite(Date.parse(row.expires_at)) && Date.parse(row.expires_at) > Date.now();
}

async function readSupabaseCache(book: Book) {
  if (!supabase) return null;

  const normalizedIsbn = normalizeIsbn(book.isbn);
  const seriesKey = normalizeSeriesKey(book.seriesTitle);

  try {
    if (normalizedIsbn) {
      const { data, error } = await supabase
        .from('book_metadata_cache')
        .select('*')
        .eq('normalized_isbn', normalizedIsbn)
        .maybeSingle();
      if (error) throw error;
      if (data && dbCacheIsFresh(data as BookMetadataCacheRow)) {
        return dbRowToDetails(data as BookMetadataCacheRow);
      }
    }

    if (!normalizedIsbn && seriesKey && book.volumeNumber) {
      const { data, error } = await supabase
        .from('book_metadata_cache')
        .select('*')
        .eq('series_key', seriesKey)
        .eq('volume_number', book.volumeNumber)
        .maybeSingle();
      if (error) throw error;
      if (data && dbCacheIsFresh(data as BookMetadataCacheRow)) {
        return dbRowToDetails(data as BookMetadataCacheRow);
      }
    }
  } catch (error) {
    console.warn('Failed to read Supabase book metadata cache', error);
  }

  return null;
}

async function writeSupabaseCache(book: Book, details: BookVolumeDetails | null) {
  if (!supabase || !details?.title || details.source === 'Developer Override') return;

  const normalizedIsbn = normalizeIsbn(book.isbn);
  const seriesKey = normalizeSeriesKey(book.seriesTitle);
  if (!normalizedIsbn && (!seriesKey || !book.volumeNumber)) return;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + DB_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const row = {
    isbn: book.isbn ?? null,
    normalized_isbn: normalizedIsbn ?? null,
    title: details.title,
    subtitle: details.subtitle ?? null,
    series_title: book.seriesTitle,
    series_key: seriesKey || null,
    volume_number: book.volumeNumber ?? null,
    author: details.author ?? null,
    publisher: details.publisher ?? null,
    description: details.description ?? null,
    thumbnail_url: details.thumbnailUrl ?? null,
    list_price: details.listPrice ?? null,
    price_source: details.priceSource ?? null,
    price_fetched_at: details.priceFetchedAt ?? null,
    source: details.source,
    source_url: details.sourceUrl ?? null,
    fetched_at: details.checkedAt,
    expires_at: expiresAt.toISOString(),
    updated_at: now.toISOString(),
  };

  try {
    if (normalizedIsbn) {
      const { data } = await supabase
        .from('book_metadata_cache')
        .select('id')
        .eq('normalized_isbn', normalizedIsbn)
        .maybeSingle();
      if (data?.id) {
        const { error } = await supabase.from('book_metadata_cache').update(row).eq('id', data.id);
        if (error) throw error;
        return;
      }
    } else if (seriesKey && book.volumeNumber) {
      const { data } = await supabase
        .from('book_metadata_cache')
        .select('id')
        .eq('series_key', seriesKey)
        .eq('volume_number', book.volumeNumber)
        .maybeSingle();
      if (data?.id) {
        const { error } = await supabase.from('book_metadata_cache').update(row).eq('id', data.id);
        if (error) throw error;
        return;
      }
    }

    const { error } = await supabase.from('book_metadata_cache').insert(row);
    if (error) throw error;
  } catch (error) {
    console.warn('Failed to save Supabase book metadata cache', error);
  }
}

function mergeOverrideDetails(
  book: Book,
  base: BookVolumeDetails | null,
  override: BookVolumeDetails | null,
): BookVolumeDetails | null {
  if (!override) return base;

  return {
    title: override.title ?? base?.title ?? book.title,
    subtitle: override.subtitle ?? base?.subtitle,
    seriesTitle: override.seriesTitle ?? base?.seriesTitle ?? book.seriesTitle,
    author: override.author ?? base?.author ?? book.author,
    publisher: override.publisher ?? base?.publisher ?? book.publisher,
    description: override.description ?? base?.description,
    thumbnailUrl: override.thumbnailUrl ?? base?.thumbnailUrl ?? book.thumbnailUrl,
    listPrice: override.listPrice ?? base?.listPrice ?? book.listPrice ?? undefined,
    priceSource: override.priceSource ?? base?.priceSource ?? book.priceSource ?? undefined,
    priceFetchedAt: override.priceFetchedAt ?? base?.priceFetchedAt ?? book.priceFetchedAt ?? undefined,
    source: override.source,
    sourceUrl: override.sourceUrl ?? base?.sourceUrl,
    checkedAt: override.checkedAt,
  };
}
async function readLastLocalDetails(key: string, legacyKey: string) {
  const values = await Promise.allSettled([
    getStorageItemWithLegacy(key, legacyKey),
    AsyncStorage.getItem(`${key}:synopsis-v1`),
  ]);
  for (const result of values) {
    try {
      if (result.status !== 'fulfilled' || !result.value) continue;
      const entry = JSON.parse(result.value) as CacheEntry;
      if (entry?.details?.source !== 'Developer Override' && typeof entry?.details?.description === 'string' && entry.details.description.trim()) return entry.details;
    } catch { /* Keep trying another saved copy. */ }
  }
  return null;
}
export async function getBookVolumeDetails(
  book: Book,
  options: { forceRefresh?: boolean } = {},
) {
  const demoDetails = getDemoBookDetails(book);
  if (demoDetails) return demoDetails;

  const key = cacheKey(book);
  const legacyKey = legacyCacheKey(book);
  const overrideDetails = await getBookMetadataOverrideDetails(book);
  const savedDetails = await readSupabaseCache(book);
  const localDetails = await readLastLocalDetails(key, legacyKey);
  const fallbackDescription = savedDetails?.description?.trim() || localDetails?.description;
  if (overrideDetails?.title) {
    // Fill only a missing synopsis; confirmed identity, edition and cover stay authoritative.
    if (overrideDetails.description?.trim() || !book.isbn) return overrideDetails;
    if (!options.forceRefresh && savedDetails?.description?.trim()) {
      return { ...overrideDetails, description: savedDetails.description };
    }
    const synopsisKey = `${key}:synopsis-v1`;
    if (!options.forceRefresh) {
      try {
        const cached = JSON.parse((await AsyncStorage.getItem(synopsisKey)) ?? 'null') as CacheEntry | null;
        const ttl = cached?.details?.description ? CACHE_TTL_MS : 24 * 60 * 60 * 1000;
        if (cached && Date.now() - cached.fetchedAt < ttl) {
          return { ...overrideDetails, description: cached.details?.description || fallbackDescription };
        }
      } catch { /* A failed local cache must not prevent a synopsis lookup. */ }
    }
    try {
      const supplement = await lookupBookVolumeDetails(book, { exactIsbnOnly: true });
      if (supplement?.description?.trim()) await writeSupabaseCache(book, supplement);
      try {
        if (supplement?.description?.trim() || !localDetails?.description) {
          await AsyncStorage.setItem(synopsisKey, JSON.stringify({ fetchedAt: Date.now(), details: supplement }));
        }
      } catch { /* The fetched synopsis remains usable when local storage is full. */ }
      return { ...overrideDetails, description: supplement?.description || fallbackDescription };
    } catch {
      return { ...overrideDetails, description: fallbackDescription };
    }
  }

  if (!options.forceRefresh && savedDetails?.description?.trim()) {
    return mergeOverrideDetails(book, savedDetails, overrideDetails);
  }

  if (!options.forceRefresh) {
    try {
      const cached = await getStorageItemWithLegacy(key, legacyKey);
      if (cached) {
        const entry = JSON.parse(cached) as CacheEntry;
        if (entry.details?.source !== 'Developer Override' && Date.now() - entry.fetchedAt < (entry.details?.description ? CACHE_TTL_MS : 24 * 60 * 60 * 1000)) {
          return mergeOverrideDetails(book, entry.details, overrideDetails);
        }
      }
    } catch (error) {
      console.warn('Failed to read book details cache', error);
    }
  }

  const fetched = await lookupBookVolumeDetails(book);
  const details = fetched ? { ...fetched, description: fetched.description || fallbackDescription } : savedDetails ?? localDetails;
  await writeSupabaseCache(book, details);
  const mergedDetails = mergeOverrideDetails(book, details, overrideDetails);
  const entry: CacheEntry = { fetchedAt: Date.now(), details: mergedDetails };
  try {
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch (error) {
    console.warn('Failed to save book details cache', error);
  }
  return mergedDetails;
}


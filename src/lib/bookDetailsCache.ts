import AsyncStorage from '@react-native-async-storage/async-storage';

import { Book } from '../types';
import { getStorageItemWithLegacy } from './asyncStorageCompat';
import { BookVolumeDetails, lookupBookVolumeDetails } from './bookApis';
import { getBookMetadataOverrideDetails } from './bookMetadataOverrides';
import { normalizeSeriesKey } from './series';
import { supabase } from './supabase';

const LEGACY_CACHE_PREFIX = 'booknest.book-details.v3';
const CACHE_PREFIX = 'honnoma.book-details.v3';
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

    if (seriesKey && book.volumeNumber) {
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
export async function getBookVolumeDetails(
  book: Book,
  options: { forceRefresh?: boolean } = {},
) {
  const key = cacheKey(book);
  const legacyKey = legacyCacheKey(book);
  const overrideDetails = await getBookMetadataOverrideDetails(book);

  if (!options.forceRefresh) {
    try {
      const cached = await getStorageItemWithLegacy(key, legacyKey);
      if (cached) {
        const entry = JSON.parse(cached) as CacheEntry;
        if (Date.now() - entry.fetchedAt < CACHE_TTL_MS) {
          return mergeOverrideDetails(book, entry.details, overrideDetails);
        }
      }
    } catch (error) {
      console.warn('Failed to read book details cache', error);
    }
  }

  if (!options.forceRefresh) {
    const dbCached = await readSupabaseCache(book);
    if (dbCached) {
      const mergedDetails = mergeOverrideDetails(book, dbCached, overrideDetails);
      const entry: CacheEntry = { fetchedAt: Date.now(), details: mergedDetails };
      try {
        await AsyncStorage.setItem(key, JSON.stringify(entry));
      } catch (error) {
        console.warn('Failed to save book details cache', error);
      }
      return mergedDetails;
    }
  }

  const details = await lookupBookVolumeDetails(book);
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


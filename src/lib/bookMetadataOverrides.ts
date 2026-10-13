import { Book } from '../types';
import { BookVolumeDetails } from './bookApis';
import { env } from './env';
import { getKnownBookMetadataOverride, KnownBookMetadataOverride, normalizeKnownIsbn } from './knownBookOverrides';
import { normalizeSeriesKey } from './series';
import { getConfirmedBookMetadata } from './confirmedBookMetadata';

type RemoteBookMetadataOverrideResponse = {
  override?: {
    author?: string | null;
    description?: string | null;
    isbn?: string | null;
    normalized_isbn?: string | null;
    publisher?: string | null;
    series_title?: string | null;
    source_url?: string | null;
    subtitle?: string | null;
    thumbnail_url?: string | null;
    list_price?: number | null;
    price_source?: 'rakuten' | 'google' | 'manual' | null;
    price_fetched_at?: string | null;
    title?: string | null;
  } | null;
};

const SOURCE_FETCH_TIMEOUT_MS = 10000;

async function getRemoteBookMetadataOverride(book: Book): Promise<KnownBookMetadataOverride | null> {
  if (!env.metadataOverrideApiUrl) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(env.metadataOverrideApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isbn: book.isbn,
        normalizedIsbn: normalizeKnownIsbn(book.isbn),
        seriesKey: normalizeSeriesKey(book.seriesTitle),
        volumeNumber: book.volumeNumber,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as RemoteBookMetadataOverrideResponse;
    const override = payload.override;
    if (!override) return null;
    const requestedIsbn = normalizeKnownIsbn(book.isbn);
    if (requestedIsbn && normalizeKnownIsbn(override.normalized_isbn ?? override.isbn) !== requestedIsbn) return null;

    return {
      author: override.author ?? undefined,
      description: override.description ?? undefined,
      isbn: override.normalized_isbn ?? override.isbn ?? undefined,
      publisher: override.publisher ?? undefined,
      seriesTitle: override.series_title ?? undefined,
      sourceUrl: override.source_url ?? undefined,
      thumbnailUrl: override.thumbnail_url ?? undefined,
      listPrice: typeof override.list_price === 'number' ? override.list_price : undefined,
      priceSource: override.price_source ?? undefined,
      priceFetchedAt: override.price_fetched_at ?? undefined,
      title: override.title ?? undefined,
    };
  } catch (error) {
    console.warn('Failed to fetch remote book metadata override', error);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getBookMetadataOverrideDetails(book: Book): Promise<BookVolumeDetails | null> {
  const confirmed = await getConfirmedBookMetadata(book.isbn);
  if (confirmed) {
    return {
      title: confirmed.title,
      volumeNumber: confirmed.volume_number ?? undefined,
      subtitle: confirmed.subtitle ?? undefined,
      seriesTitle: confirmed.series_title ?? undefined,
      author: confirmed.author ?? undefined,
      publisher: confirmed.publisher ?? undefined,
      description: confirmed.description ?? undefined,
      thumbnailUrl: confirmed.thumbnail_url ?? undefined,
      listPrice: confirmed.list_price ?? undefined,
      priceSource: confirmed.price_source ?? undefined,
      priceFetchedAt: confirmed.price_fetched_at ?? undefined,
      source: 'Developer Override',
      sourceUrl: confirmed.source_url ?? undefined,
      checkedAt: confirmed.confirmed_at ?? new Date().toISOString(),
    };
  }
  const override =
    (confirmed === undefined ? await getRemoteBookMetadataOverride(book) : null) ??
    getKnownBookMetadataOverride({ isbn: book.isbn, title: book.title });
  if (!override) return null;

  return {
    title: override.title,
    seriesTitle: override.seriesTitle,
    author: override.author,
    publisher: override.publisher,
    description: override.description,
    thumbnailUrl: override.thumbnailUrl,
    listPrice: override.listPrice,
    priceSource: override.priceSource,
    priceFetchedAt: override.priceFetchedAt,
    source: 'Developer Override',
    sourceUrl: override.sourceUrl,
    checkedAt: new Date().toISOString(),
  };
}

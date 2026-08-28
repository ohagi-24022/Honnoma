import { Book } from '../types';
import { BookVolumeDetails } from './bookApis';
import { env } from './env';
import { getKnownBookMetadataOverride, KnownBookMetadataOverride, normalizeKnownIsbn } from './knownBookOverrides';
import { normalizeSeriesKey } from './series';

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
    title?: string | null;
  } | null;
};

type SourcePageDetails = {
  description?: string;
  thumbnailUrl?: string;
};

const SOURCE_FETCH_TIMEOUT_MS = 10000;

function decodeHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function firstMetaContent(html: string, names: string[]) {
  for (const name of names) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+(?:name|property)=["']${escapedName}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escapedName}["'][^>]*>`, 'i'),
    ];
    const match = patterns.map((pattern) => html.match(pattern)).find(Boolean);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return undefined;
}

async function fetchSourcePageDetails(sourceUrl?: string | null): Promise<SourcePageDetails> {
  if (!sourceUrl) return {};

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(sourceUrl, { signal: controller.signal });
    if (!response.ok) return {};
    const html = await response.text();
    return {
      description: firstMetaContent(html, ['description', 'og:description']),
      thumbnailUrl: firstMetaContent(html, ['og:image', 'twitter:image']),
    };
  } catch (error) {
    console.warn('Failed to fetch book metadata override source page', error);
    return {};
  } finally {
    clearTimeout(timeoutId);
  }
}

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

    return {
      author: override.author ?? undefined,
      description: override.description ?? undefined,
      isbn: override.normalized_isbn ?? override.isbn ?? undefined,
      publisher: override.publisher ?? undefined,
      seriesTitle: override.series_title ?? undefined,
      sourceUrl: override.source_url ?? undefined,
      thumbnailUrl: override.thumbnail_url ?? undefined,
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
  const override =
    (await getRemoteBookMetadataOverride(book)) ??
    getKnownBookMetadataOverride({ isbn: book.isbn, title: book.title });
  if (!override) return null;

  const sourcePage = await fetchSourcePageDetails(override.sourceUrl);

  return {
    title: override.title ?? book.title,
    subtitle: undefined,
    author: override.author ?? book.author,
    publisher: override.publisher ?? book.publisher,
    description: override.description ?? sourcePage.description,
    thumbnailUrl: override.thumbnailUrl ?? sourcePage.thumbnailUrl ?? book.thumbnailUrl,
    source: 'Developer Override',
    sourceUrl: override.sourceUrl,
    checkedAt: new Date().toISOString(),
  };
}

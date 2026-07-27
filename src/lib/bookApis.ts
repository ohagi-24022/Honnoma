import { Book, BookInput } from '../types';
import { normalizeAuthor } from './bookMetadata';
import { env } from './env';
import { normalizeSeriesKey, parseSeriesTitle } from './series';
import { supabase } from './supabase';

type GoogleBooksResponse = {
  items?: Array<{
    id?: string;
    volumeInfo?: {
      title?: string;
      subtitle?: string;
      authors?: string[];
      publisher?: string;
      description?: string;
      imageLinks?: {
        thumbnail?: string;
        smallThumbnail?: string;
        medium?: string;
        large?: string;
      };
      industryIdentifiers?: Array<{
        type?: string;
        identifier?: string;
      }>;
    };
    saleInfo?: {
      listPrice?: {
        amount?: number;
      };
    };
  }>;
};

type GoogleBooksItem = NonNullable<GoogleBooksResponse['items']>[number];
type GoogleBooksVolumeInfo = GoogleBooksItem['volumeInfo'];

type OpenBdResponse = Array<{
  summary?: {
    isbn?: string;
    title?: string;
    author?: string;
    publisher?: string;
    cover?: string;
  };
  onix?: {
    CollateralDetail?: {
      TextContent?: Array<{
        TextType?: string;
        ContentAudience?: string;
        Text?: string;
      }>;
    };
    DescriptiveDetail?: {
      Collection?: {
        TitleDetail?: {
          TitleElement?: {
            TitleText?: {
              content?: string;
            };
          };
        };
      };
    };
  };
} | null>;

type RakutenBooksResponse = {
  Items?: Array<{
    Item?: {
      title?: string;
      subTitle?: string;
      author?: string;
      publisherName?: string;
      itemCaption?: string;
      isbn?: string;
      largeImageUrl?: string;
      mediumImageUrl?: string;
      smallImageUrl?: string;
      itemPrice?: number;
    };
  }>;
};

type RakutenBooksTotalResponse = RakutenBooksResponse;

type RakutenItem = NonNullable<NonNullable<RakutenBooksResponse['Items']>[number]['Item']>;

type ExpectedBook = Partial<Pick<BookInput, 'seriesTitle' | 'volumeNumber'>> & {
  isbn?: string;
};

const RAKUTEN_APP_REFERER = 'https://github.com/ohagi-24022/BookNest';

type RakutenProxyRequest = {
  path: string;
  params: Record<string, string>;
};

type FetchLikeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

type RakutenProxyMetadata = {
  version?: string;
  transport?: string;
  refererConfigured?: boolean;
};

export type BookLookupDebugEntry = {
  provider: string;
  query: string;
  status: 'hit' | 'miss' | 'error';
  title?: string;
  isbn?: string;
  seriesTitle?: string;
  volumeNumber?: number;
  coverUrl?: string;
  reason?: string;
};

export type SeriesPublicationInfo = {
  latestVolume: number;
  source: 'Rakuten Books' | 'Google Books';
  checkedAt: string;
  isCompleted?: boolean;
};

export type BookVolumeDetails = {
  title?: string;
  subtitle?: string;
  author?: string;
  publisher?: string;
  description?: string;
  thumbnailUrl?: string;
  source: 'Google Books' | 'OpenBD' | 'Rakuten Books';
  checkedAt: string;
};

export type SeriesSearchCandidate = {
  author?: string;
  coverUrl?: string;
  publisher?: string;
  sampleTitle: string;
  seriesTitle: string;
  source: 'Google Books' | 'Rakuten Books';
  volumeNumber?: number;
};

const SERIES_COMPLETION_OVERRIDES: Record<string, number> = {
  [normalizeSeriesKey('???????????')]: 3,
  [normalizeSeriesKey('LIVER DIVER LOVER')]: 3,
  [normalizeSeriesKey('???????????=LIVER DIVER LOVER')]: 3,
};

function getSeriesCompletionOverride(seriesTitle: string, latestVolume: number | null) {
  if (!latestVolume) return false;
  const candidateKeys = [normalizeSeriesKey(seriesTitle), ...buildSeriesTitleSearchAliases(seriesTitle).map(normalizeSeriesKey)]
    .filter(Boolean);
  if (latestVolume === 3) {
    const joinedKey = candidateKeys.join('');
    if (joinedKey.includes(normalizeSeriesKey('????????')) || joinedKey.includes('liverdiverlover')) {
      return true;
    }
  }

  return candidateKeys.some((candidateKey) =>
    Object.entries(SERIES_COMPLETION_OVERRIDES).some(
      ([overrideKey, completedVolume]) =>
        completedVolume === latestVolume &&
        (candidateKey === overrideKey || candidateKey.includes(overrideKey) || overrideKey.includes(candidateKey)),
    ),
  );
}

function normalizeIsbn(isbn: string) {
  return isbn.replace(/[^0-9X]/gi, '').toUpperCase();
}

function isSameIsbn(left?: string, right?: string) {
  if (!left || !right) return false;
  return normalizeIsbn(left) === normalizeIsbn(right);
}

function normalizeImageUrl(url?: string) {
  if (!url) return undefined;
  return url.replace(/^http:\/\//i, 'https://');
}

function isKnownUnavailableCoverUrl(url?: string) {
  return !!url && /imagenotavailable|no[_-]?image|noimage/i.test(url);
}

function isNonBookTitle(title?: string) {
  if (!title) return false;
  const normalizedTitle = title.normalize('NFKC');
  return /blu-?ray|ブルーレイ|bd\b|dvd|cd|サウンドトラック|ost|ドラマcd/i.test(
    normalizedTitle,
  );
}

function isNonBookRakutenItem(item?: RakutenItem) {
  return isNonBookTitle([item?.title, item?.subTitle, item?.itemCaption].filter(Boolean).join(' '));
}

function isNonBookGoogleVolume(volume?: GoogleBooksVolumeInfo) {
  return isNonBookTitle([volume?.title, volume?.subtitle, volume?.description].filter(Boolean).join(' '));
}

function googleBookItems(payload: GoogleBooksResponse) {
  return payload.items?.filter((item) => !isNonBookGoogleVolume(item.volumeInfo)) ?? [];
}

function firstCoverUrl(...urls: Array<string | undefined>) {
  return urls
    .map(normalizeImageUrl)
    .find((url): url is string => !!url && !isKnownUnavailableCoverUrl(url));
}

function withIsbnCoverFallback(book: BookInput | null, isbn?: string): BookInput | null {
  return book;
}

function normalizeComparableText(value?: string) {
  return value
    ?.toLowerCase()
    .replace(/[ \t\r\n　]/g, '')
    .replace(/[!！?？:：;；,，.．。'"“”‘’「」『』（）()[\]【】〈〉<>]/g, '');
}

function hasMatchingIndustryIdentifier(
  identifiers: Array<{ type?: string; identifier?: string }> | undefined,
  isbn: string,
) {
  return identifiers?.some((identifier) => isSameIsbn(identifier.identifier, isbn)) ?? false;
}

function mergeBookMetadata(primary: BookInput, fallback: BookInput | null): BookInput {
  if (!fallback) return primary;

  return {
    ...primary,
    seriesTitle: primary.seriesTitle || fallback.seriesTitle,
    volumeNumber: primary.volumeNumber ?? fallback.volumeNumber,
    author: normalizeAuthor(primary.author ?? fallback.author),
    publisher: primary.publisher ?? fallback.publisher,
    thumbnailUrl: primary.thumbnailUrl ?? fallback.thumbnailUrl,
    listPrice: primary.listPrice ?? fallback.listPrice,
    priceSource: primary.priceSource ?? fallback.priceSource,
    priceFetchedAt: primary.priceFetchedAt ?? fallback.priceFetchedAt,
    purchasePrice: primary.purchasePrice ?? fallback.purchasePrice,
  };
}

function mergeBookMetadataList(primary: BookInput, fallbacks: Array<BookInput | null>): BookInput {
  return fallbacks.reduce<BookInput>((current, fallback) => mergeBookMetadata(current, fallback), primary);
}

function isSameSeriesTitle(left?: string, right?: string) {
  const normalizedLeft = normalizeComparableText(left);
  const normalizedRight = normalizeComparableText(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function keepThumbnailOnlyForSafeMatch(
  book: BookInput | null,
  isbn: string,
  expected?: Pick<BookInput, 'seriesTitle' | 'volumeNumber'>,
): BookInput | null {
  if (!book || isSameIsbn(book.isbn, isbn)) return book;
  const hasSameVolume =
    !!expected?.volumeNumber &&
    !!book.volumeNumber &&
    expected.volumeNumber === book.volumeNumber;
  const hasSameSeries = isSameSeriesTitle(book.seriesTitle, expected?.seriesTitle);
  if (hasSameVolume && hasSameSeries) return book;
  return { ...book, thumbnailUrl: undefined };
}

function hasExpectedVolumeAndSeries(book: Pick<BookInput, 'seriesTitle' | 'volumeNumber'>, expected?: ExpectedBook) {
  if (!expected?.volumeNumber || !expected.seriesTitle) return false;
  return book.volumeNumber === expected.volumeNumber && isSameSeriesTitle(book.seriesTitle, expected.seriesTitle);
}

function rakutenItemHasCover(item?: RakutenItem) {
  return !!firstCoverUrl(item?.largeImageUrl, item?.mediumImageUrl, item?.smallImageUrl);
}

function rakutenItemMatchesExpected(item: RakutenItem, expected?: ExpectedBook) {
  const parsed = parseSeriesTitle(item.title ?? '');
  if (expected?.isbn && isSameIsbn(item.isbn, expected.isbn)) return true;
  return hasExpectedVolumeAndSeries(parsed, expected);
}

function selectRakutenItem(items: RakutenBooksResponse['Items'], expected?: ExpectedBook) {
  const candidates =
    items
      ?.map((entry) => entry.Item)
      .filter((item): item is RakutenItem => !!item?.title && !isNonBookRakutenItem(item)) ?? [];
  if (candidates.length === 0) return undefined;

  return (
    candidates.find((item) => rakutenItemHasCover(item) && expected?.isbn && isSameIsbn(item.isbn, expected.isbn)) ??
    candidates.find((item) => rakutenItemHasCover(item) && rakutenItemMatchesExpected(item, expected)) ??
    candidates.find((item) => expected?.isbn && isSameIsbn(item.isbn, expected.isbn)) ??
    candidates.find((item) => rakutenItemMatchesExpected(item, expected)) ??
    candidates.find(rakutenItemHasCover) ??
    candidates[0]
  );
}

function rakutenItemToBookInput(item: RakutenItem, fallbackIsbn?: string): BookInput {
  const parsed = parseSeriesTitle(item.title ?? '');

  return {
    isbn: item.isbn ?? fallbackIsbn,
    title: item.title ?? '',
    seriesTitle: parsed.seriesTitle,
    volumeNumber: parsed.volumeNumber,
    author: normalizeAuthor(item.author),
    publisher: item.publisherName,
    thumbnailUrl: firstCoverUrl(item.largeImageUrl, item.mediumImageUrl, item.smallImageUrl),
    listPrice: typeof item.itemPrice === 'number' ? item.itemPrice : undefined,
    priceSource: typeof item.itemPrice === 'number' ? 'rakuten' : undefined,
    priceFetchedAt: typeof item.itemPrice === 'number' ? new Date().toISOString() : undefined,
    status: 'unread',
  };
}

function rakutenItemToDebugEntry(provider: string, query: string, item: RakutenItem): BookLookupDebugEntry {
  const parsed = parseSeriesTitle(item.title ?? '');

  return {
    provider,
    query,
    status: 'hit',
    title: item.title,
    isbn: item.isbn,
    seriesTitle: parsed.seriesTitle,
    volumeNumber: parsed.volumeNumber,
    coverUrl: firstCoverUrl(item.largeImageUrl, item.mediumImageUrl, item.smallImageUrl),
  };
}

function bookToDebugEntry(provider: string, query: string, book: BookInput | null): BookLookupDebugEntry {
  if (!book) {
    return {
      provider,
      query,
      status: 'miss',
      reason: '候補なし',
    };
  }

  return {
    provider,
    query,
    status: 'hit',
    title: book.title,
    isbn: book.isbn,
    seriesTitle: book.seriesTitle,
    volumeNumber: book.volumeNumber,
    coverUrl: book.thumbnailUrl,
  };
}

function getRakutenConfigDebugEntry(query: string): BookLookupDebugEntry {
  const appId = env.rakutenAppId ?? '';

  return {
    provider: 'Rakuten Config',
    query,
    status: supabase ? 'hit' : 'error',
    reason: [
      `APP ID: ${appId ? `${appId.length}文字` : 'なし'}`,
      `Edge Function: ${supabase ? '利用可' : '未設定'}`,
    ]
      .filter(Boolean)
      .join(' / '),
  };
}


function buildSeriesTitleSearchAliases(seriesTitle: string) {
  const normalized = seriesTitle.normalize('NFKC').trim();
  const parts = normalized
    .split(/[=?/??|]/g)
    .map((part) => part.trim())
    .filter(Boolean);
  const withoutSubtitle = normalized
    .replace(/[=?/??|].*$/, '')
    .replace(/\s+[-??]\s+.*$/, '')
    .trim();
  const noSpaceVariants = [normalized, withoutSubtitle, ...parts]
    .map((part) => part.replace(/[\s?]+/g, ''))
    .filter(Boolean);

  return [
    ...new Set([normalized, withoutSubtitle, ...parts, ...noSpaceVariants].filter((query) => query.length >= 2)),
  ];
}

function buildVolumeTitleSearchQueries(book: Pick<Book, 'title' | 'seriesTitle' | 'volumeNumber'>) {
  const aliases = buildSeriesTitleSearchAliases(book.seriesTitle || book.title);
  const volumeQueries = book.volumeNumber
    ? aliases.flatMap((seriesTitle) => [
        `${seriesTitle} ${book.volumeNumber}\u5dfb`,
        `${seriesTitle} \u7b2c${book.volumeNumber}\u5dfb`,
        `${seriesTitle} ${book.volumeNumber}`,
      ])
    : [];

  return [...new Set([book.title, ...volumeQueries, ...aliases].filter(Boolean))].slice(0, 8);
}

function buildTitleQueries(title: string) {
  const parsed = parseSeriesTitle(title);
  const seriesVolumeQuery = parsed.volumeNumber
    ? `${parsed.seriesTitle} ${parsed.volumeNumber}`
    : parsed.seriesTitle;
  const seriesVolumeWithSuffixQuery = parsed.volumeNumber
    ? `${parsed.seriesTitle} ${parsed.volumeNumber}巻`
    : undefined;
  const seriesVolumeWithPrefixQuery = parsed.volumeNumber
    ? `${parsed.seriesTitle} 第${parsed.volumeNumber}巻`
    : undefined;

  const queries = [
    ...new Set(
      [
        seriesVolumeWithSuffixQuery,
        seriesVolumeWithPrefixQuery,
        seriesVolumeQuery,
        title,
        ...buildSeriesTitleSearchAliases(parsed.seriesTitle),
      ].filter((query): query is string => !!query),
    ),
  ];

  return queries;
}

export function isBookIsbnBarcode(value: string) {
  const normalized = normalizeIsbn(value);
  if (normalized.length === 10) return isValidIsbn10(normalized);
  if (normalized.length === 13) {
    return (normalized.startsWith('978') || normalized.startsWith('979')) && isValidIsbn13(normalized);
  }
  return false;
}

function isValidIsbn10(isbn: string) {
  if (!/^[0-9]{9}[0-9X]$/.test(isbn)) return false;

  const sum = isbn.split('').reduce((total, character, index) => {
    const value = character === 'X' ? 10 : Number.parseInt(character, 10);
    return total + value * (10 - index);
  }, 0);

  return sum % 11 === 0;
}

function isValidIsbn13(isbn: string) {
  if (!/^[0-9]{13}$/.test(isbn)) return false;

  const sum = isbn
    .slice(0, 12)
    .split('')
    .reduce((total, character, index) => {
      const value = Number.parseInt(character, 10);
      return total + value * (index % 2 === 0 ? 1 : 3);
    }, 0);
  const checkDigit = (10 - (sum % 10)) % 10;

  return checkDigit === Number.parseInt(isbn[12], 10);
}

async function lookupOpenBd(isbn: string): Promise<BookInput | null> {
  const response = await fetchWithTimeout(
    `https://api.openbd.jp/v1/get?isbn=${encodeURIComponent(isbn)}`,
  );
  if (!response.ok) throw new Error(`OpenBD responded with ${response.status}`);

  const payload = (await response.json()) as OpenBdResponse;
  const item = payload[0];
  const title = item?.summary?.title;
  if (!title) return null;

  const collectionTitle =
    item?.onix?.DescriptiveDetail?.Collection?.TitleDetail?.TitleElement?.TitleText?.content;
  const parsed = parseSeriesTitle(title);

  return {
    isbn: item.summary?.isbn ?? isbn,
    title,
    seriesTitle: collectionTitle ?? parsed.seriesTitle,
    volumeNumber: parsed.volumeNumber,
    author: normalizeAuthor(item.summary?.author),
    publisher: item.summary?.publisher,
    thumbnailUrl: normalizeImageUrl(item.summary?.cover),
    status: 'unread',
  };
}

async function lookupRakutenBooksByIsbn(isbn: string): Promise<BookInput | null> {
  return lookupRakutenBooks({ isbn }, { isbn });
}

async function lookupRakutenBooksByTitle(title: string, expected?: ExpectedBook): Promise<BookInput | null> {
  return (await lookupRakutenBooks({ title }, expected)) ?? lookupRakutenBooksTotal(title, expected);
}

async function lookupRakutenBooks(
  params: { isbn?: string; title?: string },
  expected?: ExpectedBook,
): Promise<BookInput | null> {
  if (!supabase) return null;

  const searchParams = new URLSearchParams();
  if (params.isbn) searchParams.set('isbn', normalizeIsbn(params.isbn));
  if (params.title) searchParams.set('title', params.title);

  const path = 'BooksBook/Search/20170404';
  const response = await fetchRakutenWithTimeout(
    `https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404?${searchParams.toString()}`,
    { path, params: Object.fromEntries(searchParams.entries()) },
  );

  if (!response.ok) return null;

  const payload = (await response.json()) as RakutenBooksResponse;
  const item = selectRakutenItem(payload.Items, { ...expected, isbn: params.isbn ?? expected?.isbn });
  if (!item?.title) return null;

  return rakutenItemToBookInput(item, params.isbn);
}

async function lookupRakutenBooksTotal(keyword: string, expected?: ExpectedBook): Promise<BookInput | null> {
  if (!supabase || !keyword.trim()) return null;

  const searchParams = new URLSearchParams({ keyword });

  const path = 'BooksTotal/Search/20170404';
  const response = await fetchRakutenWithTimeout(
    `https://openapi.rakuten.co.jp/services/api/BooksTotal/Search/20170404?${searchParams.toString()}`,
    { path, params: Object.fromEntries(searchParams.entries()) },
  );

  if (!response.ok) return null;

  const payload = (await response.json()) as RakutenBooksTotalResponse;
  const item = selectRakutenItem(payload.Items, expected);
  if (!item?.title) return null;

  return rakutenItemToBookInput(item);
}

async function searchRakutenBookInputs(params: {
  path: 'BooksBook/Search/20170404' | 'BooksTotal/Search/20170404';
  queryParamName: 'keyword' | 'title';
  query: string;
}) {
  if (!supabase || !params.query.trim()) return [];

  const searchParams = new URLSearchParams({ [params.queryParamName]: params.query });
  const response = await fetchRakutenWithTimeout(
    `https://openapi.rakuten.co.jp/services/api/${params.path}?${searchParams.toString()}`,
    { path: params.path, params: Object.fromEntries(searchParams.entries()) },
  );
  if (!response.ok) return [];

  const payload = (await response.json()) as RakutenBooksResponse;
  return (
    payload.Items?.map((entry) => entry.Item)
      .filter((item): item is RakutenItem => !!item?.title && !isNonBookRakutenItem(item))
      .map((item) => rakutenItemToBookInput(item)) ?? []
  );
}

function toSeriesSearchCandidate(book: BookInput, source: SeriesSearchCandidate['source']): SeriesSearchCandidate | null {
  const parsed = parseSeriesTitle(book.seriesTitle || book.title);
  const seriesTitle = parsed.seriesTitle.trim();
  if (!seriesTitle) return null;

  return {
    author: book.author,
    coverUrl: book.thumbnailUrl,
    publisher: book.publisher,
    sampleTitle: book.title,
    seriesTitle,
    source,
    volumeNumber: book.volumeNumber ?? parsed.volumeNumber,
  };
}

function mergeSeriesCandidates(candidates: SeriesSearchCandidate[]) {
  const bySeries = new Map<string, SeriesSearchCandidate>();

  for (const candidate of candidates) {
    const key = normalizeSeriesKey(candidate.seriesTitle);
    if (!key) continue;
    const current = bySeries.get(key);
    const currentRank = current?.volumeNumber === 1 ? 0 : current?.volumeNumber ?? Number.MAX_SAFE_INTEGER;
    const candidateRank = candidate.volumeNumber === 1 ? 0 : candidate.volumeNumber ?? Number.MAX_SAFE_INTEGER;
    const shouldReplace =
      !current ||
      (!current.coverUrl && !!candidate.coverUrl) ||
      (!!current.coverUrl === !!candidate.coverUrl && candidateRank < currentRank);

    if (shouldReplace) bySeries.set(key, candidate);
  }

  return [...bySeries.values()].sort(
    (left, right) =>
      Number(!left.coverUrl) - Number(!right.coverUrl) ||
      (left.volumeNumber ?? Number.MAX_SAFE_INTEGER) - (right.volumeNumber ?? Number.MAX_SAFE_INTEGER) ||
      left.seriesTitle.localeCompare(right.seriesTitle),
  );
}

export async function searchSeriesCandidates(query: string): Promise<SeriesSearchCandidate[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const titleQueries = buildTitleQueries(trimmedQuery).slice(0, 2);
  const rakutenBooks = (
    await Promise.all(
      titleQueries.flatMap((titleQuery) => [
        searchRakutenBookInputs({
          path: 'BooksBook/Search/20170404',
          queryParamName: 'title',
          query: titleQuery,
        }),
        searchRakutenBookInputs({
          path: 'BooksTotal/Search/20170404',
          queryParamName: 'keyword',
          query: titleQuery,
        }),
      ]),
    )
  ).flat();

  const googleBooks = (
    await Promise.all(
      titleQueries.map((titleQuery) =>
        tryLookup('Google Books', () => lookupGoogleBooksByQuery(`intitle:${titleQuery}`, ''), { silent: true }),
      ),
    )
  ).filter((book): book is BookInput => !!book);

  return mergeSeriesCandidates([
    ...rakutenBooks
      .map((book) => toSeriesSearchCandidate(book, 'Rakuten Books'))
      .filter((candidate): candidate is SeriesSearchCandidate => !!candidate),
    ...googleBooks
      .map((book) => toSeriesSearchCandidate(book, 'Google Books'))
      .filter((candidate): candidate is SeriesSearchCandidate => !!candidate),
  ]).slice(0, 8);
}

function findLatestVolumeFromTitles(titles: Array<string | undefined>, seriesTitle: string) {
  const expectedKeys = buildSeriesTitleSearchAliases(seriesTitle).map(normalizeSeriesKey).filter(Boolean);
  const volumes = titles
    .map((title) => (title ? parseSeriesTitle(title) : null))
    .filter(
      (
        parsed,
      ): parsed is {
        seriesTitle: string;
        volumeNumber: number;
      } =>
        !!parsed?.volumeNumber &&
        parsed.volumeNumber > 0 &&
        parsed.volumeNumber <= 500 &&
        expectedKeys.some((expectedKey) => isSeriesKeyCandidate(normalizeSeriesKey(parsed.seriesTitle), expectedKey)),
    )
    .map((parsed) => parsed.volumeNumber);

  return volumes.length > 0 ? Math.max(...volumes) : null;
}

function isSeriesKeyCandidate(candidateKey: string, expectedKey: string) {
  if (!candidateKey || !expectedKey) return false;
  if (candidateKey === expectedKey) return true;
  if (candidateKey.length >= 4 && expectedKey.includes(candidateKey)) return true;
  if (expectedKey.length >= 4 && candidateKey.includes(expectedKey)) return true;
  return false;
}


function textHasCompletionHint(text: string, latestVolume: number | null) {
  const normalizedText = text.normalize('NFKC');
  if (/\u5b8c\u7d50|\u5b8c\u7d50\u7248|\u5b8c\u7d50\u30bb\u30c3\u30c8|\u6700\u7d42\u5dfb|\u6700\u7d42\u56de|\u5168\u5dfb|\u5168\u5dfb\u30bb\u30c3\u30c8|\u5168\s*\d+\s*\u5dfb|\d+\s*\u5dfb\s*\u5b8c\u7d50|\u5168\s*\d+\s*\u5dfb\s*\u5b8c\u7d50|\s\u5b8c(?:$|[\s\uff08()])/.test(normalizedText)) return true;
  if (!latestVolume) return false;
  const allVolumeMatch = normalizedText.match(/\u5168\s*(\d+)\s*\u5dfb/);
  if (allVolumeMatch && Number(allVolumeMatch[1]) === latestVolume) return true;
  const completedVolumeMatch = normalizedText.match(/(\d+)\s*\u5dfb\s*\u5b8c\u7d50/);
  return !!completedVolumeMatch && Number(completedVolumeMatch[1]) === latestVolume;
}

function findSeriesCompletionFromTitles(titles: Array<string | undefined>, latestVolume: number | null) {
  return titles.some((title) => (title ? textHasCompletionHint(title, latestVolume) : false));
}

function hasSeriesCompletionHint(titles: Array<string | undefined>, latestVolume: number | null) {
  return titles.some((title) => (title ? textHasCompletionHint(title, latestVolume) : false));
}

function rakutenItemsToCompletionTexts(items?: RakutenBooksResponse['Items']) {
  return (
    items
      ?.map((entry) => entry.Item)
      .filter((item): item is RakutenItem => !!item && !isNonBookRakutenItem(item))
      .flatMap((item) => [
        item.title,
        item.subTitle,
        item.itemCaption,
        item.author,
        item.publisherName,
      ]) ?? []
  );
}

function rakutenItemsToTitleTexts(items?: RakutenBooksResponse['Items']) {
  return (
    items
      ?.map((entry) => entry.Item)
      .filter((item): item is RakutenItem => !!item && !isNonBookRakutenItem(item))
      .flatMap((item) => [item.title, item.subTitle, item.itemCaption]) ?? []
  );
}

async function lookupRakutenCompletionHint(seriesTitle: string, latestVolume: number | null) {
  if (!supabase || !latestVolume) return false;

  const path = 'BooksTotal/Search/20170404';
  const queries = buildSeriesTitleSearchAliases(seriesTitle).flatMap((title) => [
    `${title} \u5b8c\u7d50`,
    `${title} \u5b8c`,
    `${title} \u5168\u5dfb`,
    `${title} \u5168${latestVolume}\u5dfb`,
    `${title} ${latestVolume}\u5dfb \u5b8c\u7d50`,
    `${title} \u5168${latestVolume}\u5dfb \u5b8c\u7d50`,
    `${title} ${latestVolume}\u5dfb\u5b8c\u7d50`,
    `${title} \u6700\u7d42\u5dfb`,
  ]);

  for (const query of queries) {
    const searchParams = new URLSearchParams({
      keyword: query,
      hits: '10',
      sort: '-releaseDate',
      outOfStockFlag: '1',
      size: '9',
    });
    const response = await fetchRakutenWithTimeout(
      `https://openapi.rakuten.co.jp/services/api/${path}?${searchParams.toString()}`,
      { path, params: Object.fromEntries(searchParams.entries()) },
    );
    if (!response.ok) continue;

    const payload = (await response.json()) as RakutenBooksResponse;
    if (hasSeriesCompletionHint(rakutenItemsToCompletionTexts(payload.Items), latestVolume)) {
      return true;
    }
  }

  return false;
}

async function lookupGoogleCompletionHint(seriesTitle: string, latestVolume: number | null) {
  if (!latestVolume) return false;

  const queries = buildSeriesTitleSearchAliases(seriesTitle).flatMap((title) => [
    `intitle:${title} \u5b8c\u7d50`,
    `intitle:${title} \u5b8c`,
    `intitle:${title} \u5168\u5dfb`,
    `intitle:${title} \u5168${latestVolume}\u5dfb`,
    `${title} ${latestVolume}\u5dfb \u5b8c\u7d50`,
    `${title} \u5168${latestVolume}\u5dfb \u5b8c\u7d50`,
    `${title} ${latestVolume}\u5dfb\u5b8c\u7d50`,
    `intitle:${title} \u6700\u7d42\u5dfb`,
  ]);

  for (const query of queries) {
    const params = new URLSearchParams({
      q: query,
      maxResults: '10',
      printType: 'books',
    });
    if (env.googleBooksApiKey) params.set('key', env.googleBooksApiKey);

    const response = await fetchWithTimeout(
      `https://www.googleapis.com/books/v1/volumes?${params.toString()}`,
    );
    if (!response.ok) continue;

    const payload = (await response.json()) as GoogleBooksResponse;
    const titles = googleBookItems(payload).flatMap((item) => [
      item.volumeInfo?.title,
      item.volumeInfo?.subtitle,
      item.volumeInfo?.description,
    ]);
    if (hasSeriesCompletionHint(titles, latestVolume)) return true;
  }

  return false;
}

async function lookupSeriesCompletionHint(seriesTitle: string, latestVolume: number | null) {
  try {
    if (await lookupRakutenCompletionHint(seriesTitle, latestVolume)) return true;
  } catch {
    // 完結情報は補助情報なので、失敗しても最新巻の取得結果を優先します。
  }
  try {
    return await lookupGoogleCompletionHint(seriesTitle, latestVolume);
  } catch {
    return false;
  }
}

async function lookupLatestRakutenSeriesVolume(seriesTitle: string) {
  if (!supabase) return null;

  const aliases = buildSeriesTitleSearchAliases(seriesTitle);
  const searches = aliases.flatMap((keyword) => [
    { path: 'BooksBook/Search/20170404', paramName: 'title', keyword },
    { path: 'BooksTotal/Search/20170404', paramName: 'keyword', keyword },
    { path: 'BooksBook/Search/20170404', paramName: 'title', keyword: `${keyword} 巻` },
    { path: 'BooksTotal/Search/20170404', paramName: 'keyword', keyword: `${keyword} 巻` },
    { path: 'BooksTotal/Search/20170404', paramName: 'keyword', keyword: `${keyword} コミック` },
  ]);

  for (const search of searches) {
    const searchParams = new URLSearchParams({
      [search.paramName]: search.keyword,
      hits: '30',
      sort: '-releaseDate',
      outOfStockFlag: '1',
      size: '9',
    });
    const response = await fetchRakutenWithTimeout(
      `https://openapi.rakuten.co.jp/services/api/${search.path}?${searchParams.toString()}`,
      { path: search.path, params: Object.fromEntries(searchParams.entries()) },
    );
    if (!response.ok) continue;

    const payload = (await response.json()) as RakutenBooksResponse;
    const titles = rakutenItemsToTitleTexts(payload.Items);
    const latestVolume = findLatestVolumeFromTitles(titles, seriesTitle);
    if (latestVolume) {
      return {
        isCompleted: hasSeriesCompletionHint(titles, latestVolume),
        latestVolume,
      };
    }
  }

  return null;
}

async function lookupLatestGoogleSeriesVolume(seriesTitle: string) {
  const aliases = buildSeriesTitleSearchAliases(seriesTitle);
  const queries = aliases.flatMap((keyword) => [
    `intitle:${keyword}`,
    `"${keyword}"`,
    `${keyword} 巻`,
    `${keyword} コミック`,
  ]);

  for (const query of queries) {
    const params = new URLSearchParams({
      q: query,
      maxResults: '40',
      orderBy: 'newest',
      printType: 'books',
    });
    if (env.googleBooksApiKey) params.set('key', env.googleBooksApiKey);

    const response = await fetchWithTimeout(
      `https://www.googleapis.com/books/v1/volumes?${params.toString()}`,
    );
    if (!response.ok) continue;

    const payload = (await response.json()) as GoogleBooksResponse;
    const titles = googleBookItems(payload).flatMap((item) => [item.volumeInfo?.title, item.volumeInfo?.subtitle]);
    const latestVolume = findLatestVolumeFromTitles(titles, seriesTitle);
    if (latestVolume) {
      return {
        isCompleted: hasSeriesCompletionHint(titles, latestVolume),
        latestVolume,
      };
    }
  }

  return null;
}

export async function lookupLatestSeriesPublication(
  seriesTitle: string,
): Promise<SeriesPublicationInfo | null> {
  const normalizedTitle = seriesTitle.trim();
  if (!normalizedTitle) return null;

  const rakutenPublication = await lookupLatestRakutenSeriesVolume(normalizedTitle);
  if (rakutenPublication) {
    const isCompleted =
      rakutenPublication.isCompleted ||
      getSeriesCompletionOverride(normalizedTitle, rakutenPublication.latestVolume) ||
      (await lookupSeriesCompletionHint(normalizedTitle, rakutenPublication.latestVolume));
    return {
      latestVolume: rakutenPublication.latestVolume,
      source: 'Rakuten Books',
      checkedAt: new Date().toISOString(),
      isCompleted,
    };
  }

  const googlePublication = await lookupLatestGoogleSeriesVolume(normalizedTitle);
  if (!googlePublication) return null;
  const isCompleted =
    googlePublication.isCompleted ||
    getSeriesCompletionOverride(normalizedTitle, googlePublication.latestVolume) ||
    (await lookupSeriesCompletionHint(normalizedTitle, googlePublication.latestVolume));

  return {
    latestVolume: googlePublication.latestVolume,
    source: 'Google Books',
    checkedAt: new Date().toISOString(),
    isCompleted,
  };
}

async function lookupGoogleBooks(isbn: string): Promise<BookInput | null> {
  return lookupGoogleBooksByQuery(`isbn:${isbn}`, isbn, { trustFirstResultThumbnail: true });
}

async function lookupGoogleBooksByQuery(
  query: string,
  isbn: string,
  options: { expectedSeriesTitle?: string; expectedVolumeNumber?: number; trustFirstResultThumbnail?: boolean } = {},
): Promise<BookInput | null> {
  const params = new URLSearchParams({ q: query });
  if (env.googleBooksApiKey) params.set('key', env.googleBooksApiKey);

  const response = await fetchWithTimeout(
    `https://www.googleapis.com/books/v1/volumes?${params.toString()}`,
  );

  if (!response.ok) {
    if (response.status === 403 || response.status === 429) {
      throw new Error(
        env.googleBooksApiKey
          ? 'Google Books APIが拒否しました。APIキーの有効化、制限、割り当てを確認してください。'
          : 'Google Books APIキーがアプリに読み込まれていません。EXPO_PUBLIC_GOOGLE_BOOKS_API_KEYを設定して再起動してください。',
      );
    }
    return null;
  }

  const payload = (await response.json()) as GoogleBooksResponse;
  const bookItems = googleBookItems(payload);
  const normalizedIsbn = normalizeIsbn(isbn);
  const matchingItem = normalizedIsbn
    ? bookItems.find((item) =>
        hasMatchingIndustryIdentifier(item.volumeInfo?.industryIdentifiers, normalizedIsbn),
      )
    : undefined;
  const matchingVolumeItem = bookItems.find((item) => {
    const title = item.volumeInfo?.title;
    if (!title || !options.expectedVolumeNumber || !options.expectedSeriesTitle) return false;
    const parsed = parseSeriesTitle(title);
    return (
      parsed.volumeNumber === options.expectedVolumeNumber &&
      isSameSeriesTitle(parsed.seriesTitle, options.expectedSeriesTitle)
    );
  });
  const selectedItem = matchingItem ?? matchingVolumeItem ?? bookItems[0];
  const volume = selectedItem?.volumeInfo;
  if (!volume?.title) return null;

  const parsed = parseSeriesTitle(volume.title);
  const isbnMatched = normalizedIsbn
    ? hasMatchingIndustryIdentifier(volume.industryIdentifiers, normalizedIsbn)
    : false;
  const canUseThumbnail = !normalizedIsbn || isbnMatched || !!options.trustFirstResultThumbnail;
  const isbnFromApi =
    volume.industryIdentifiers?.find((item) => item.type === 'ISBN_13')?.identifier ?? isbn;
  const fallbackCoverUrl = canUseThumbnail
    ? firstCoverUrl(
        volume.imageLinks?.thumbnail,
        volume.imageLinks?.smallThumbnail,
      )
    : undefined;

  return {
    isbn: isbnFromApi,
    title: volume.title,
    seriesTitle: parsed.seriesTitle,
    volumeNumber: parsed.volumeNumber,
    author: normalizeAuthor(volume.authors?.join(', ')),
    publisher: volume.publisher,
    thumbnailUrl: fallbackCoverUrl,
    listPrice: typeof selectedItem?.saleInfo?.listPrice?.amount === 'number'
      ? Math.round(selectedItem.saleInfo.listPrice.amount)
      : undefined,
    priceSource: typeof selectedItem?.saleInfo?.listPrice?.amount === 'number' ? 'google' : undefined,
    priceFetchedAt: typeof selectedItem?.saleInfo?.listPrice?.amount === 'number' ? new Date().toISOString() : undefined,
    status: 'unread',
  };
}

function plainTextDescription(value?: string) {
  if (!value) return undefined;

  const decoded = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return decoded || undefined;
}

function mergeVolumeDetails(
  primary: BookVolumeDetails | null,
  fallback: BookVolumeDetails | null,
) {
  if (!primary) return fallback;
  if (!fallback) return primary;

  return {
    ...primary,
    title: primary.title ?? fallback.title,
    subtitle: primary.subtitle ?? fallback.subtitle,
    author: primary.author ?? fallback.author,
    publisher: primary.publisher ?? fallback.publisher,
    description: primary.description ?? fallback.description,
    thumbnailUrl: primary.thumbnailUrl ?? fallback.thumbnailUrl,
    source: primary.description ? primary.source : fallback.source,
  };
}

async function lookupGoogleBookVolumeDetails(
  book: Pick<Book, 'isbn' | 'title' | 'seriesTitle' | 'volumeNumber'>,
): Promise<BookVolumeDetails | null> {
  const normalizedIsbn = book.isbn ? normalizeIsbn(book.isbn) : '';
  const query = normalizedIsbn ? `isbn:${normalizedIsbn}` : `intitle:${book.title}`;
  const params = new URLSearchParams({
    q: query,
    maxResults: '10',
    printType: 'books',
  });
  if (env.googleBooksApiKey) params.set('key', env.googleBooksApiKey);

  const response = await fetchWithTimeout(
    `https://www.googleapis.com/books/v1/volumes?${params.toString()}`,
  );
  if (!response.ok) return null;

  const payload = (await response.json()) as GoogleBooksResponse;
  const bookItems = googleBookItems(payload);
  const isbnMatch = normalizedIsbn
    ? bookItems.find((item) =>
        hasMatchingIndustryIdentifier(item.volumeInfo?.industryIdentifiers, normalizedIsbn),
      )
    : undefined;
  const volumeMatch = bookItems.find((item) => {
    if (!book.volumeNumber || !item.volumeInfo?.title) return false;
    const parsed = parseSeriesTitle(item.volumeInfo.title);
    return (
      parsed.volumeNumber === book.volumeNumber &&
      isSameSeriesTitle(parsed.seriesTitle, book.seriesTitle)
    );
  });
  const volume = (isbnMatch ?? volumeMatch ?? bookItems[0])?.volumeInfo;
  if (!volume?.title) return null;

  return {
    title: volume.title,
    subtitle: volume.subtitle,
    author: normalizeAuthor(volume.authors?.join(', ')),
    publisher: volume.publisher,
    description: plainTextDescription(volume.description),
    thumbnailUrl: firstCoverUrl(
      volume.imageLinks?.large,
      volume.imageLinks?.medium,
      volume.imageLinks?.thumbnail,
      volume.imageLinks?.smallThumbnail,
    ),
    source: 'Google Books',
    checkedAt: new Date().toISOString(),
  };
}

async function lookupOpenBdVolumeDetails(
  book: Pick<Book, 'isbn'>,
): Promise<BookVolumeDetails | null> {
  if (!book.isbn) return null;

  const response = await fetchWithTimeout(
    `https://api.openbd.jp/v1/get?isbn=${encodeURIComponent(normalizeIsbn(book.isbn))}`,
  );
  if (!response.ok) return null;

  const item = ((await response.json()) as OpenBdResponse)[0];
  if (!item?.summary?.title) return null;
  const textContents = item.onix?.CollateralDetail?.TextContent ?? [];
  const preferredText =
    textContents.find((entry) => entry.TextType === '03' && entry.Text?.trim()) ??
    textContents.find((entry) => entry.Text?.trim());

  return {
    title: item.summary.title,
    author: normalizeAuthor(item.summary.author),
    publisher: item.summary.publisher,
    description: plainTextDescription(preferredText?.Text),
    thumbnailUrl: normalizeImageUrl(item.summary.cover),
    source: 'OpenBD',
    checkedAt: new Date().toISOString(),
  };
}

async function lookupRakutenBookVolumeDetails(
  book: Pick<Book, 'isbn' | 'title' | 'seriesTitle' | 'volumeNumber'>,
): Promise<BookVolumeDetails | null> {
  if (!supabase) return null;

  const path = 'BooksBook/Search/20170404';
  const queries = book.isbn ? [normalizeIsbn(book.isbn)] : buildVolumeTitleSearchQueries(book);

  let item: RakutenItem | undefined;
  for (const query of queries) {
    const searchParams = new URLSearchParams();
    if (book.isbn) searchParams.set('isbn', query);
    else searchParams.set('title', query);

    const response = await fetchRakutenWithTimeout(
      `https://openapi.rakuten.co.jp/services/api/${path}?${searchParams.toString()}`,
      { path, params: Object.fromEntries(searchParams.entries()) },
    );
    if (!response.ok) continue;

    const payload = (await response.json()) as RakutenBooksResponse;
    item = selectRakutenItem(payload.Items, {
      isbn: book.isbn,
      seriesTitle: book.seriesTitle,
      volumeNumber: book.volumeNumber,
    });
    if (item?.title) break;
  }
  if (!item?.title) return null;

  return {
    title: item.title,
    subtitle: item.subTitle,
    author: normalizeAuthor(item.author),
    publisher: item.publisherName,
    description: plainTextDescription(item.itemCaption),
    thumbnailUrl: firstCoverUrl(item.largeImageUrl, item.mediumImageUrl, item.smallImageUrl),
    source: 'Rakuten Books',
    checkedAt: new Date().toISOString(),
  };
}

export async function lookupBookVolumeDetails(
  book: Pick<Book, 'isbn' | 'title' | 'seriesTitle' | 'volumeNumber'>,
): Promise<BookVolumeDetails | null> {
  let details: BookVolumeDetails | null = null;

  try {
    details = await lookupGoogleBookVolumeDetails(book);
  } catch {
    details = null;
  }
  if (details?.description && details.publisher) return details;

  try {
    details = mergeVolumeDetails(details, await lookupOpenBdVolumeDetails(book));
  } catch {
    // Continue to Rakuten when OpenBD has no record or is temporarily unavailable.
  }
  if (details?.description && details.publisher) return details;

  try {
    details = mergeVolumeDetails(details, await lookupRakutenBookVolumeDetails(book));
  } catch {
    // A missing synopsis is a valid result; metadata already found above remains usable.
  }
  if (details?.description || !book.isbn) return details;

  try {
    details = mergeVolumeDetails(
      details,
      await lookupGoogleBookVolumeDetails({ ...book, isbn: undefined }),
    );
  } catch {
    // Keep the exact ISBN metadata when the final title-based fallback is unavailable.
  }
  if (details?.description) return details;

  try {
    details = mergeVolumeDetails(
      details,
      await lookupRakutenBookVolumeDetails({ ...book, isbn: undefined }),
    );
  } catch {
    // Publisher information can remain unavailable for books absent from every provider.
  }
  return details;
}

export async function lookupBookByTitle(title: string, fallbackIsbn?: string): Promise<BookInput | null> {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return null;
  let firstResult: BookInput | null = null;
  const expected = parseSeriesTitle(trimmedTitle);

  for (const query of buildTitleQueries(trimmedTitle)) {
    const rakutenResult = keepThumbnailOnlyForSafeMatch(
      await lookupRakutenBooksByTitle(query, expected),
      fallbackIsbn ?? '',
      expected,
    );
    if (rakutenResult?.thumbnailUrl) return rakutenResult;
    if (rakutenResult && !firstResult) firstResult = rakutenResult;

    const titleResult = await tryLookup(
      'Google Books',
      () =>
        lookupGoogleBooksByQuery(`intitle:${query}`, fallbackIsbn ?? '', {
          expectedSeriesTitle: expected.seriesTitle,
          expectedVolumeNumber: expected.volumeNumber,
        }),
      { silent: true },
    );
    const titleResultWithFallback = withIsbnCoverFallback(titleResult, fallbackIsbn);
    if (titleResultWithFallback?.thumbnailUrl) return titleResultWithFallback;
    if (titleResultWithFallback && !firstResult) firstResult = titleResultWithFallback;
  }

  return (
    withIsbnCoverFallback(firstResult, fallbackIsbn) ??
    withIsbnCoverFallback(
      await tryLookup('Google Books', () => lookupGoogleBooksByQuery(trimmedTitle, fallbackIsbn ?? ''), { silent: true }),
      fallbackIsbn,
    )
  );
}

export async function lookupBookDebugInfo(params: {
  isbn?: string;
  title: string;
}): Promise<BookLookupDebugEntry[]> {
  const entries: BookLookupDebugEntry[] = [];
  const trimmedTitle = params.title.trim();
  const normalizedIsbn = params.isbn ? normalizeIsbn(params.isbn) : '';
  const expected = parseSeriesTitle(trimmedTitle);
  const titleQueries = buildTitleQueries(trimmedTitle).slice(0, 1);

  entries.push(getRakutenConfigDebugEntry(trimmedTitle || normalizedIsbn));

  if (normalizedIsbn) {
    entries.push(await debugLookup('OpenBD', normalizedIsbn, () => lookupOpenBd(normalizedIsbn)));
    entries.push(await debugLookup('Rakuten ISBN', normalizedIsbn, () => lookupRakutenBooksByIsbn(normalizedIsbn)));
    entries.push(await debugLookup('Google ISBN', normalizedIsbn, () => lookupGoogleBooks(normalizedIsbn)));
  }

  for (const query of titleQueries) {
    entries.push(...(await debugRakutenTitleCandidates(query, expected)));
    entries.push(
      await debugLookup('Google Title', query, () =>
        lookupGoogleBooksByQuery(`intitle:${query}`, normalizedIsbn, {
          expectedSeriesTitle: expected.seriesTitle,
          expectedVolumeNumber: expected.volumeNumber,
        }),
      ),
    );
  }

  return entries.slice(0, 8);
}

async function debugLookup(
  provider: string,
  query: string,
  lookup: () => Promise<BookInput | null>,
): Promise<BookLookupDebugEntry> {
  try {
    return bookToDebugEntry(provider, query, await lookup());
  } catch (error) {
    return {
      provider,
      query,
      status: 'error',
      reason: error instanceof Error ? error.message : '不明なエラー',
    };
  }
}

async function debugRakutenTitleCandidates(
  query: string,
  expected: ExpectedBook,
): Promise<BookLookupDebugEntry[]> {
  if (!supabase) {
    return [
      {
        provider: 'Rakuten Title',
        query,
        status: 'miss',
        reason: 'Supabase Edge Function未設定',
      },
    ];
  }

  const booksCandidates = await debugRakutenEndpoint('Rakuten BooksBook', query, 'title', expected);
  const totalCandidates = await debugRakutenEndpoint('Rakuten BooksTotal', query, 'keyword', expected);
  return [...booksCandidates, ...totalCandidates].slice(0, 4);
}

async function debugRakutenEndpoint(
  provider: string,
  query: string,
  queryParamName: 'title' | 'keyword',
  expected: ExpectedBook,
): Promise<BookLookupDebugEntry[]> {
  try {
    const searchParams = new URLSearchParams();
    searchParams.set(queryParamName, query);
    const path =
      queryParamName === 'title'
        ? 'BooksBook/Search/20170404'
        : 'BooksTotal/Search/20170404';
    const response = await fetchRakutenWithTimeout(
      `https://openapi.rakuten.co.jp/services/api/${path}?${searchParams.toString()}`,
      { path, params: Object.fromEntries(searchParams.entries()) },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      const reason = errorBody.includes('specify valid applicationId')
        ? '楽天APP IDが無効扱いです。.envのEXPO_PUBLIC_RAKUTEN_APP_IDに楽天画面のアプリケーションIDを入れて、Expoを再起動してください。'
        : errorBody.slice(0, 120);
      return [
        {
          provider,
          query,
          status: 'error',
          reason: [`HTTP ${response.status}`, reason].filter(Boolean).join(': '),
        },
      ];
    }

    const payload = (await response.json()) as RakutenBooksResponse;
    const candidates = payload.Items?.map((entry) => entry.Item).filter((item): item is RakutenItem => !!item?.title) ?? [];
    const sortedCandidates = [...candidates].sort((left, right) => {
      const leftScore =
        (rakutenItemMatchesExpected(left, expected) ? 2 : 0) + (rakutenItemHasCover(left) ? 1 : 0);
      const rightScore =
        (rakutenItemMatchesExpected(right, expected) ? 2 : 0) + (rakutenItemHasCover(right) ? 1 : 0);
      return rightScore - leftScore;
    });

    if (sortedCandidates.length === 0) {
      return [
        {
          provider,
          query,
          status: 'miss',
          reason: '候補なし',
        },
      ];
    }

    return sortedCandidates.slice(0, 2).map((item) => rakutenItemToDebugEntry(provider, query, item));
  } catch (error) {
    return [
      {
        provider,
        query,
        status: 'error',
        reason: error instanceof Error ? error.message : '不明なエラー',
      },
    ];
  }
}

export async function lookupBookByIsbn(isbn: string): Promise<BookInput | null> {
  const normalizedIsbn = normalizeIsbn(isbn);
  if (!isBookIsbnBarcode(normalizedIsbn)) return null;

  const openBdResult = await tryLookup('OpenBD', () => lookupOpenBd(normalizedIsbn));
  const rakutenResult = await tryLookup('Rakuten Books', () => lookupRakutenBooksByIsbn(normalizedIsbn));
  const strictGoogleResult = await tryLookup('Google Books', () => lookupGoogleBooks(normalizedIsbn), {
    silent: true,
  });
  if (rakutenResult?.thumbnailUrl && rakutenResult.volumeNumber) return rakutenResult;

  if (openBdResult) {
    const openBdWithFallback = withIsbnCoverFallback(openBdResult, normalizedIsbn);
    if (openBdWithFallback?.thumbnailUrl && openBdWithFallback.volumeNumber) return openBdWithFallback;

    const titleFallback = keepThumbnailOnlyForSafeMatch(
      await lookupBookByTitle(openBdResult.title, normalizedIsbn),
      normalizedIsbn,
      openBdResult,
    );
    return withIsbnCoverFallback(
      mergeBookMetadataList(openBdResult, [rakutenResult, strictGoogleResult, titleFallback]),
      normalizedIsbn,
    );
  }

  if (rakutenResult?.thumbnailUrl) return rakutenResult;
  if (rakutenResult) {
    const titleFallback = keepThumbnailOnlyForSafeMatch(
      await lookupBookByTitle(rakutenResult.title, normalizedIsbn),
      normalizedIsbn,
      rakutenResult,
    );
    return withIsbnCoverFallback(mergeBookMetadata(rakutenResult, titleFallback), normalizedIsbn);
  }

  if (strictGoogleResult?.thumbnailUrl) return strictGoogleResult;
  if (strictGoogleResult) {
    const titleFallback = keepThumbnailOnlyForSafeMatch(
      await lookupBookByTitle(strictGoogleResult.title, normalizedIsbn),
      normalizedIsbn,
      strictGoogleResult,
    );
    return withIsbnCoverFallback(mergeBookMetadata(strictGoogleResult, titleFallback), normalizedIsbn);
  }

  return withIsbnCoverFallback(
    await tryLookup('Google Books', () => lookupGoogleBooksByQuery(normalizedIsbn, normalizedIsbn), {
      silent: true,
    }),
    normalizedIsbn,
  );
}

async function tryLookup(
  providerName: string,
  lookup: () => Promise<BookInput | null>,
  options: { silent?: boolean } = {},
) {
  try {
    return await lookup();
  } catch (error) {
    if (!options.silent) {
      console.warn(`${providerName} lookup failed`, error);
    }
    return null;
  }
}

async function fetchWithTimeout(url: string, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchRakutenWithTimeout(
  url: string,
  proxyRequest?: RakutenProxyRequest,
  timeoutMs = 12000,
): Promise<FetchLikeResponse> {
  const response = await fetchRakutenProxy(proxyRequest);
  if (!response) {
    return createJsonResponse(503, {
      error: 'RAKUTEN_PROXY_UNAVAILABLE',
      message: 'Supabase Edge Function rakuten-books is not available. Deploy it and set Supabase secrets.',
    });
  }
  if (response.status !== 429) return response;

  await new Promise((resolve) => setTimeout(resolve, 1200));
  return (
    (await fetchRakutenProxy(proxyRequest)) ??
    createJsonResponse(503, {
      error: 'RAKUTEN_PROXY_UNAVAILABLE',
      message: 'Supabase Edge Function rakuten-books is not available after retry.',
    })
  );
}

async function fetchRakutenProxy(proxyRequest?: RakutenProxyRequest): Promise<FetchLikeResponse | null> {
  if (!supabase || !proxyRequest) return null;

  try {
    const { data, error } = await supabase.functions.invoke<{
      ok: boolean;
      status: number;
      body: unknown;
      proxy?: RakutenProxyMetadata;
    }>('rakuten-books', {
      body: proxyRequest,
    });
    if (error) {
      return createJsonResponse(503, {
        error: 'RAKUTEN_PROXY_INVOCATION_FAILED',
        message: error.message,
      });
    }
    if (!data) {
      return createJsonResponse(503, {
        error: 'RAKUTEN_PROXY_EMPTY_RESPONSE',
      });
    }

    const body =
      data.ok || typeof data.body !== 'object' || data.body === null
        ? data.body
        : {
            ...(data.body as Record<string, unknown>),
            proxy: data.proxy ?? { version: 'unknown' },
          };

    return {
      ok: data.ok,
      status: data.status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown proxy error';
    console.warn('Rakuten proxy lookup failed', error);
    return createJsonResponse(503, {
      error: 'RAKUTEN_PROXY_INVOCATION_FAILED',
      message,
    });
  }
}

function createJsonResponse(status: number, body: unknown): FetchLikeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

export function buildPurchaseUrl(seriesTitle: string, volumeNumber?: number) {
  const query = [seriesTitle, volumeNumber ? `${volumeNumber}巻` : undefined, '本'].filter(Boolean);
  return `https://books.rakuten.co.jp/search?sitem=${encodeURIComponent(query.join(' '))}`;
}

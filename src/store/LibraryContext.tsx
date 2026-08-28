import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { BookLookupDebugEntry, lookupBookByIsbn, lookupBookByTitle, lookupBookDebugInfo } from '../lib/bookApis';
import { normalizeAuthor } from '../lib/bookMetadata';
import {
  findDuplicateBook as findDuplicate,
  normalizeBookInput,
} from '../lib/duplicate';
import { normalizeKanaReading } from '../lib/kana';
import { getKnownBookCoverOverride } from '../lib/knownBookOverrides';
import { parseSeriesTitle } from '../lib/series';
import { formatNetworkAwareError, isNetworkError } from '../lib/errorMessages';
import { normalizeVolumeKind } from '../lib/volumeKind';
import {
  buildSeriesGroups,
  buildSeriesItems,
  SeriesGroup,
} from '../lib/seriesSelectors';
import { supabase } from '../lib/supabase';
import { Book, BookInput, ReadingStatus, ShelfItem } from '../types';
import { useAuth } from './AuthContext';

type SupabaseClient = NonNullable<typeof supabase>;

const STORAGE_KEY = 'booknest.library.v1';
const METADATA_ENRICHMENT_CACHE_KEY = 'booknest.metadata-enrichment.v1';
const DEMO_USER_ID = 'local-user';
const BOOKS_FETCH_PAGE_SIZE = 1000;
const METADATA_ENRICHMENT_ERROR_RETRY_MS = 24 * 60 * 60 * 1000;
const METADATA_ENRICHMENT_MISS_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const METADATA_ENRICHMENT_SUCCESS_RETRY_MS = 30 * 24 * 60 * 60 * 1000;
const METADATA_ENRICHMENT_CACHE_LIMIT = 500;

type BookRow = {
  id: string;
  user_id: string;
  isbn: string | null;
  title: string;
  title_reading?: string | null;
  series_title: string;
  series_reading?: string | null;
  volume_number: number | null;
  volume_kind?: 'main' | 'extra' | null;
  author: string | null;
  publisher: string | null;
  published_date?: string | null;
  purchase_price?: number | null;
  list_price?: number | null;
  price_source?: 'rakuten' | 'google' | 'manual' | null;
  price_fetched_at?: string | null;
  thumbnail_url: string | null;
  status: ReadingStatus;
  created_at: string;
};

const BASE_BOOK_SELECT_COLUMNS =
  'id,user_id,isbn,title,series_title,volume_number,author,publisher,thumbnail_url,status,created_at';
const BOOK_SELECT_COLUMNS = `${BASE_BOOK_SELECT_COLUMNS},purchase_price,list_price,price_source,price_fetched_at,volume_kind,published_date,title_reading,series_reading`;

type SupabaseLikeError = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

type AddBookOptions = {
  allowDuplicate?: boolean;
};

type MetadataRepairResult = {
  title: string;
  lookupTitle: string;
  beforeThumbnailUrl?: string;
  afterThumbnailUrl?: string;
  seriesTitle?: string;
  volumeNumber?: number;
  volumeKind?: 'main' | 'extra';
  author?: string;
  publisher?: string;
  titleReading?: string | null;
  seriesReading?: string | null;
  publishedDate?: string | null;
  beforePurchasePrice?: number | null;
  afterPurchasePrice?: number | null;
  purchasePriceLookupAttempted?: boolean;
  purchasePriceUpdated?: boolean;
  debugEntries?: BookLookupDebugEntry[];
};

type MetadataRepairOptions = {
  preserveIdentity?: boolean;
  updatePurchasePrice?: boolean;
};

type LibraryContextValue = {
  books: Book[];
  loading: boolean;
  error: string | null;
  requiresAuth: boolean;
  localImportCount: number;
  seriesGroups: SeriesGroup[];
  refreshLibrary: () => void;
  addBook: (book: BookInput, options?: AddBookOptions) => Promise<Book>;
  addBookByIsbn: (isbn: string) => Promise<Book | null>;
  findDuplicateBook: (book: BookInput) => Book | undefined;
  migrateLocalBooks: () => Promise<number>;
  updateBook: (bookId: string, updates: Partial<BookInput>) => Promise<void>;
  renameSeries: (fromSeriesTitle: string, toSeriesTitle: string) => Promise<number>;
  deleteBook: (bookId: string) => Promise<void>;
  repairBookMetadata: (bookId: string, options?: MetadataRepairOptions) => Promise<MetadataRepairResult>;
  bulkUpdateStatus: (bookIds: string[], status: ReadingStatus) => Promise<void>;
  getSeriesItems: (seriesTitle: string) => ShelfItem[];
};

const LibraryContext = createContext<LibraryContextValue | null>(null);

type MetadataEnrichmentStatus = 'success' | 'miss' | 'error';

type MetadataEnrichmentCacheEntry = {
  lastAttemptAt: string;
  needsSignature: string;
  reasons: string[];
  status: MetadataEnrichmentStatus;
};

type MetadataEnrichmentCache = Record<string, MetadataEnrichmentCacheEntry>;

type MetadataEnrichmentTarget = {
  book: Book;
  cacheKey: string;
  needsSignature: string;
  reasons: string[];
};

function normalizeMetadataCacheKey(isbn: string) {
  return isbn.replace(/[^0-9X]/gi, '').toUpperCase();
}

function buildMetadataNeedsSignature(reasons: string[]) {
  return [...new Set(reasons)].sort().join('|');
}

function shouldSkipMetadataEnrichment(
  entry: MetadataEnrichmentCacheEntry | undefined,
  needsSignature: string,
  nowMs: number,
) {
  if (!entry || entry.needsSignature !== needsSignature) return false;
  const lastAttemptMs = Date.parse(entry.lastAttemptAt);
  if (!Number.isFinite(lastAttemptMs)) return false;
  const retryMs = entry.status === 'success'
    ? METADATA_ENRICHMENT_SUCCESS_RETRY_MS
    : entry.status === 'error'
      ? METADATA_ENRICHMENT_ERROR_RETRY_MS
      : METADATA_ENRICHMENT_MISS_RETRY_MS;
  return nowMs - lastAttemptMs < retryMs;
}

function pruneMetadataEnrichmentCache(cache: MetadataEnrichmentCache) {
  const entries = Object.entries(cache).sort(
    (left, right) => Date.parse(right[1].lastAttemptAt) - Date.parse(left[1].lastAttemptAt),
  );
  return Object.fromEntries(entries.slice(0, METADATA_ENRICHMENT_CACHE_LIMIT));
}

function parseMetadataEnrichmentCache(value: string | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as MetadataEnrichmentCache;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}
const now = () => new Date().toISOString();

function describeMetadataNeeds(book: Pick<Book, 'thumbnailUrl' | 'volumeNumber' | 'publisher' | 'seriesTitle' | 'title' | 'volumeKind'>) {
  const isExtraVolume = book.volumeKind === 'extra';
  return [
    !book.thumbnailUrl || isKnownUnavailableCoverUrl(book.thumbnailUrl) ? 'cover' : null,
    !isExtraVolume && !book.volumeNumber ? 'volume' : null,
    !book.publisher ? 'publisher' : null,
    book.seriesTitle.trim() === book.title.trim() ? 'series' : null,
  ].filter((reason): reason is string => !!reason);
}

function usableReading(value?: string | null) {
  return normalizeKanaReading(value);
}

async function safeLookupBookByIsbn(isbn: string, context?: { source: string; title?: string; reasons?: string[] }) {
  if (__DEV__) {
    console.info('[metadata] ISBN lookup started', {
      isbn,
      source: context?.source ?? 'unknown',
      title: context?.title,
      reasons: context?.reasons,
    });
  }

  try {
    return await lookupBookByIsbn(isbn);
  } catch (error) {
    console.warn('ISBN metadata lookup failed', {
      isbn,
      source: context?.source ?? 'unknown',
      title: context?.title,
      reasons: context?.reasons,
      error,
    });
    return null;
  }
}

function fromBookRow(row: BookRow): Book {
  const parsedTitle = parseSeriesTitle(row.title);
  const parsedSeries = parseSeriesTitle(row.series_title || row.title);
  const shouldRepairSeriesTitle =
    !row.series_title ||
    row.series_title.trim() === row.title.trim() ||
    !!parsedSeries.volumeNumber;

  return {
    id: row.id,
    userId: row.user_id,
    isbn: row.isbn ?? undefined,
    title: row.title,
    titleReading: normalizeKanaReading(row.title_reading),
    seriesTitle: shouldRepairSeriesTitle ? parsedSeries.seriesTitle || parsedTitle.seriesTitle : row.series_title,
    seriesReading: normalizeKanaReading(row.series_reading),
    volumeNumber: row.volume_number ?? parsedTitle.volumeNumber ?? parsedSeries.volumeNumber,
    volumeKind: normalizeVolumeKind(row.volume_kind, row.title),
    author: normalizeAuthor(row.author ?? undefined),
    publisher: row.publisher ?? undefined,
    publishedDate: row.published_date ?? undefined,
    purchasePrice: row.purchase_price ?? undefined,
    listPrice: row.list_price ?? undefined,
    priceSource: row.price_source ?? undefined,
    priceFetchedAt: row.price_fetched_at ?? undefined,
    thumbnailUrl: getKnownBookCoverOverride({ isbn: row.isbn, title: row.title }) ?? row.thumbnail_url?.replace(/^http:\/\//i, 'https://') ?? undefined,
    status: row.status,
    createdAt: row.created_at,
  };
}

function toBookInsert(bookInput: BookInput, userId: string, bookId: string) {
  const parsed = parseSeriesTitle(bookInput.title);
  const seriesTitle = bookInput.seriesTitle || parsed.seriesTitle;
  const volumeNumber = bookInput.volumeNumber ?? parsed.volumeNumber ?? null;

  return {
    id: bookId,
    user_id: userId,
    isbn: bookInput.isbn ?? null,
    title: bookInput.title,
    title_reading: normalizeKanaReading(bookInput.titleReading) ?? null,
    series_title: seriesTitle,
    series_reading: normalizeKanaReading(bookInput.seriesReading) ?? null,
    volume_number: volumeNumber,
    volume_kind: normalizeVolumeKind(bookInput.volumeKind, bookInput.title),
    author: bookInput.author ?? null,
    publisher: bookInput.publisher ?? null,
    published_date: bookInput.publishedDate ?? null,
    purchase_price: bookInput.purchasePrice ?? null,
    list_price: bookInput.listPrice ?? null,
    price_source: bookInput.priceSource ?? null,
    price_fetched_at: bookInput.priceFetchedAt ?? null,
    thumbnail_url: bookInput.thumbnailUrl?.replace(/^http:\/\//i, 'https://') ?? null,
    status: bookInput.status,
  };
}

function toBookUpdate(updates: Partial<BookInput>) {
  return {
    ...(updates.isbn !== undefined ? { isbn: updates.isbn || null } : {}),
    ...(updates.title !== undefined ? { title: updates.title } : {}),
    ...(updates.titleReading !== undefined ? { title_reading: normalizeKanaReading(updates.titleReading) ?? null } : {}),
    ...(updates.seriesTitle !== undefined ? { series_title: updates.seriesTitle } : {}),
    ...(updates.seriesReading !== undefined ? { series_reading: normalizeKanaReading(updates.seriesReading) ?? null } : {}),
    ...(updates.volumeNumber !== undefined ? { volume_number: updates.volumeNumber ?? null } : {}),
    ...(updates.volumeKind !== undefined ? { volume_kind: normalizeVolumeKind(updates.volumeKind, updates.title) } : {}),
    ...(updates.author !== undefined ? { author: updates.author || null } : {}),
    ...(updates.publisher !== undefined ? { publisher: updates.publisher || null } : {}),
    ...(updates.publishedDate !== undefined ? { published_date: updates.publishedDate || null } : {}),
    ...(updates.purchasePrice !== undefined ? { purchase_price: updates.purchasePrice ?? null } : {}),
    ...(updates.listPrice !== undefined ? { list_price: updates.listPrice ?? null } : {}),
    ...(updates.priceSource !== undefined ? { price_source: updates.priceSource ?? null } : {}),
    ...(updates.priceFetchedAt !== undefined ? { price_fetched_at: updates.priceFetchedAt ?? null } : {}),
    ...(updates.thumbnailUrl !== undefined ? { thumbnail_url: updates.thumbnailUrl || null } : {}),
    ...(updates.status !== undefined ? { status: updates.status } : {}),
  };
}

function normalizeReadingBookInput<T extends Partial<BookInput>>(input: T): T {
  return {
    ...input,
    ...(input.titleReading !== undefined ? { titleReading: normalizeKanaReading(input.titleReading) } : {}),
    ...(input.seriesReading !== undefined ? { seriesReading: normalizeKanaReading(input.seriesReading) } : {}),
  };
}

function normalizeBookReadings(book: Book): Book {
  return {
    ...book,
    titleReading: normalizeKanaReading(book.titleReading),
    seriesReading: normalizeKanaReading(book.seriesReading),
  };
}

function omitOptionalSchemaColumns<T extends {
  purchase_price?: unknown;
  list_price?: unknown;
  price_source?: unknown;
  price_fetched_at?: unknown;
  volume_kind?: unknown;
  published_date?: unknown;
  title_reading?: unknown;
  series_reading?: unknown;
}>(value: T) {
  const {
    purchase_price: _purchasePrice,
    list_price: _listPrice,
    price_source: _priceSource,
    price_fetched_at: _priceFetchedAt,
    volume_kind: _volumeKind,
    published_date: _publishedDate,
    title_reading: _titleReading,
    series_reading: _seriesReading,
    ...rest
  } = value;
  return rest;
}

function formatSupabaseError(error: unknown, fallback: string) {
  const supabaseError = error as SupabaseLikeError;
  if (supabaseError.code === '42501') {
    return '蔵書データへのアクセス権限がありません。Supabaseの権限設定を確認してください。';
  }
  if (supabaseError.code === '23505') {
    return '同じISBNの本がすでに登録されています。';
  }
  if (isNetworkError(error)) {
    return formatNetworkAwareError(error, fallback);
  }
  return fallback;
}

function isMissingOptionalSchemaColumnError(error: SupabaseLikeError) {
  const message = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`;
  return (
    message.includes('purchase_price') ||
    message.includes('list_price') ||
    message.includes('price_source') ||
    message.includes('price_fetched_at') ||
    message.includes('volume_kind') ||
    message.includes('published_date') ||
    message.includes('title_reading') ||
    message.includes('series_reading') ||
    error.code === 'PGRST204'
  );
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createUuid() {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid;

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isKnownUnavailableCoverUrl(url?: string) {
  return !!url && /imagenotavailable|no[_-]?image|noimage/i.test(url);
}

function buildMetadataLookupTitle(book: Pick<Book, 'title' | 'seriesTitle' | 'volumeNumber'>) {
  return book.volumeNumber ? `${book.seriesTitle} ${book.volumeNumber}巻` : book.title;
}

const initialBooks: Book[] = [
  {
    id: 'demo-1',
    userId: DEMO_USER_ID,
    isbn: '9784088820118',
    title: 'SPY x FAMILY 1',
    seriesTitle: 'SPY x FAMILY',
    volumeNumber: 1,
    author: 'Tatsuya Endo',
    thumbnailUrl: 'https://books.google.com/books/content?id=KqTNDwAAQBAJ&printsec=frontcover&img=1&zoom=1',
    status: 'read',
    createdAt: now(),
  },
  {
    id: 'demo-2',
    userId: DEMO_USER_ID,
    isbn: '9784088821207',
    title: 'SPY x FAMILY 2',
    seriesTitle: 'SPY x FAMILY',
    volumeNumber: 2,
    author: 'Tatsuya Endo',
    thumbnailUrl: 'https://books.google.com/books/content?id=0rLNDwAAQBAJ&printsec=frontcover&img=1&zoom=1',
    status: 'read',
    createdAt: now(),
  },
  {
    id: 'demo-3',
    userId: DEMO_USER_ID,
    isbn: '9784088825458',
    title: 'SPY x FAMILY 4',
    seriesTitle: 'SPY x FAMILY',
    volumeNumber: 4,
    author: 'Tatsuya Endo',
    thumbnailUrl: 'https://books.google.com/books/content?id=q5QLEAAAQBAJ&printsec=frontcover&img=1&zoom=1',
    status: 'unread',
    createdAt: now(),
  },
  {
    id: 'demo-4',
    userId: DEMO_USER_ID,
    isbn: '9784065214827',
    title: 'Blue Period 8',
    seriesTitle: 'Blue Period',
    volumeNumber: 8,
    author: 'Tsubasa Yamaguchi',
    thumbnailUrl: 'https://books.google.com/books/content?id=zMYPEAAAQBAJ&printsec=frontcover&img=1&zoom=1',
    status: 'reading',
    createdAt: now(),
  },
];

export function LibraryProvider({ children }: PropsWithChildren) {
  const { configured, initializing, user } = useAuth();
  const [books, setBooks] = useState<Book[]>(configured ? [] : initialBooks);
  const [hydrated, setHydrated] = useState(false);
  const [pendingLocalBooks, setPendingLocalBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [metadataEnrichmentCacheLoaded, setMetadataEnrichmentCacheLoaded] = useState(false);
  const enrichedIsbnsRef = useRef(new Set<string>());
  const metadataEnrichmentCacheRef = useRef<MetadataEnrichmentCache>({});
  const appStateRefreshAtRef = useRef(0);
  const requiresAuth = false;
  const refreshLibrary = useCallback(() => {
    setReloadNonce((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!configured || !user) return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      const currentTime = Date.now();
      if (currentTime - appStateRefreshAtRef.current < 5000) return;
      appStateRefreshAtRef.current = currentTime;
      refreshLibrary();
    });
    return () => subscription.remove();
  }, [configured, refreshLibrary, user]);
  useEffect(() => {
    AsyncStorage.getItem(METADATA_ENRICHMENT_CACHE_KEY)
      .then((storedCache) => {
        metadataEnrichmentCacheRef.current = parseMetadataEnrichmentCache(storedCache);
      })
      .finally(() => setMetadataEnrichmentCacheLoaded(true));
  }, []);
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((storedBooks) => {
        if (!storedBooks) return;
        const parsedBooks = (JSON.parse(storedBooks) as Book[]).map(normalizeBookReadings);
        if (configured) {
          const localBooks = parsedBooks.filter((book) => !book.id.startsWith('demo-'));
          setPendingLocalBooks(localBooks);
          if (!user) setBooks(localBooks);
        } else {
          setBooks(parsedBooks);
        }
      })
      .finally(() => setHydrated(true));
  }, [configured, user]);

  useEffect(() => {
    if ((configured && user) || !hydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(books));
  }, [books, configured, hydrated, user]);

  useEffect(() => {
    if (!configured || initializing) return;
    const client = supabase;
    if (!client || !user) {
      setBooks(pendingLocalBooks);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const userId = user.id;

    async function loadBooks(client: SupabaseClient) {
      try {
        const rows: BookRow[] = [];
        let page = 0;

        while (true) {
          const from = page * BOOKS_FETCH_PAGE_SIZE;
          const to = from + BOOKS_FETCH_PAGE_SIZE - 1;
          const initialResult = await client
            .from('books')
            .select(BOOK_SELECT_COLUMNS)
            .order('created_at', { ascending: false })
            .range(from, to);
          let data: unknown[] | null = initialResult.data;
          let fetchError = initialResult.error;

          if (fetchError && isMissingOptionalSchemaColumnError(fetchError)) {
            const fallbackResult = await client
              .from('books')
              .select(BASE_BOOK_SELECT_COLUMNS)
              .order('created_at', { ascending: false })
              .range(from, to);
            data = fallbackResult.data;
            fetchError = fallbackResult.error;
          }

          if (fetchError) {
            throw new Error(formatSupabaseError(fetchError, '蔵書を読み込めませんでした。'));
          }

          const pageRows = (data ?? []) as BookRow[];
          rows.push(...pageRows);
          if (pageRows.length < BOOKS_FETCH_PAGE_SIZE) break;
          page += 1;
        }

        const cloudBooks = rows.map(fromBookRow);
        const comparisonBooks = [...cloudBooks];
        const booksToImport: Book[] = [];

        for (const localBook of pendingLocalBooks) {
          const input = normalizeBookInput({
            isbn: localBook.isbn,
            title: localBook.title,
            titleReading: localBook.titleReading,
            seriesTitle: localBook.seriesTitle,
            volumeNumber: localBook.volumeNumber,
            author: localBook.author,
            seriesReading: localBook.seriesReading,
            publisher: localBook.publisher,
            publishedDate: localBook.publishedDate,
            purchasePrice: localBook.purchasePrice,
            listPrice: localBook.listPrice,
            priceSource: localBook.priceSource,
            priceFetchedAt: localBook.priceFetchedAt,
            thumbnailUrl: localBook.thumbnailUrl,
            status: localBook.status,
          });
          if (findDuplicate(comparisonBooks, input)) continue;

          const importedBook: Book = {
            ...input,
            id: createUuid(),
            userId,
            createdAt: localBook.createdAt || now(),
          };
          booksToImport.push(importedBook);
          comparisonBooks.push(importedBook);
        }

        if (booksToImport.length > 0) {
          const insertPayload = booksToImport.map((book) => toBookInsert(book, userId, book.id));
          let { error: insertError } = await client
            .from('books')
            .insert(insertPayload);
          if (insertError && isMissingOptionalSchemaColumnError(insertError)) {
            const fallbackResult = await client
              .from('books')
              .insert(insertPayload.map(omitOptionalSchemaColumns));
            insertError = fallbackResult.error;
          }
          if (insertError) {
            throw new Error(formatSupabaseError(insertError, 'ローカル蔵書を自動移行できませんでした。'));
          }

        }
        if (pendingLocalBooks.length > 0) {
          await AsyncStorage.removeItem(STORAGE_KEY);
          setPendingLocalBooks([]);
        }
        setBooks([...booksToImport, ...cloudBooks]);
      } catch (fetchError) {
        setError(formatNetworkAwareError(fetchError, '蔵書を読み込めませんでした。'));
      } finally {
        setLoading(false);
      }
    }

    loadBooks(client);
  }, [configured, initializing, pendingLocalBooks, reloadNonce, user]);

  useEffect(() => {
    if (!configured || !user || !supabase || !metadataEnrichmentCacheLoaded) return;
    const client = supabase;
    const userId = user.id;
    const nowMs = Date.now();

    const metadataTargets: MetadataEnrichmentTarget[] = books
      .flatMap((book) => {
        if (!book.isbn || enrichedIsbnsRef.current.has(book.isbn)) return [];
        const reasons = describeMetadataNeeds(book);
        if (reasons.length === 0) return [];

        const cacheKey = normalizeMetadataCacheKey(book.isbn);
        if (!cacheKey) return [];
        const needsSignature = buildMetadataNeedsSignature(reasons);
        if (shouldSkipMetadataEnrichment(metadataEnrichmentCacheRef.current[cacheKey], needsSignature, nowMs)) {
          return [];
        }

        return [{ book, cacheKey, needsSignature, reasons }];
      })
      .slice(0, 10);

    if (metadataTargets.length === 0) return;

    if (__DEV__) {
      console.info(
        '[metadata] auto enrichment targets',
        metadataTargets.map(({ book, reasons }) => ({
          isbn: book.isbn,
          title: book.title,
          seriesTitle: book.seriesTitle,
          reasons,
        })),
      );
    }

    metadataTargets.forEach(({ book }) => {
      if (book.isbn) enrichedIsbnsRef.current.add(book.isbn);
    });

    async function saveMetadataEnrichmentAttempt(target: MetadataEnrichmentTarget, status: MetadataEnrichmentStatus) {
      metadataEnrichmentCacheRef.current = pruneMetadataEnrichmentCache({
        ...metadataEnrichmentCacheRef.current,
        [target.cacheKey]: {
          lastAttemptAt: now(),
          needsSignature: target.needsSignature,
          reasons: target.reasons,
          status,
        },
      });
      await AsyncStorage.setItem(METADATA_ENRICHMENT_CACHE_KEY, JSON.stringify(metadataEnrichmentCacheRef.current));
    }

    async function enrichBooks() {
      for (const target of metadataTargets) {
        const { book, reasons } = target;
        if (!book.isbn) continue;

        try {
          const lookupTitle = buildMetadataLookupTitle(book);
          const metadata =
            (await safeLookupBookByIsbn(book.isbn, { source: 'library-auto-enrichment', title: book.title, reasons })) ??
            (await lookupBookByTitle(lookupTitle, book.isbn)) ??
            (lookupTitle === book.title ? null : await lookupBookByTitle(book.title, book.isbn));
          if (!metadata) {
            await saveMetadataEnrichmentAttempt(target, 'miss');
            continue;
          }

          const updates: Partial<BookInput> = {
            thumbnailUrl: metadata.thumbnailUrl ?? (isKnownUnavailableCoverUrl(book.thumbnailUrl) ? '' : book.thumbnailUrl),
            volumeNumber: book.volumeNumber ?? metadata.volumeNumber,
            author: metadata.author ?? book.author,
            publisher: metadata.publisher ?? book.publisher,
            titleReading: usableReading(metadata.titleReading) ?? usableReading(book.titleReading),
            seriesReading: usableReading(metadata.seriesReading) ?? usableReading(book.seriesReading),
            seriesTitle:
              book.seriesTitle.trim() === book.title.trim() || parseSeriesTitle(book.seriesTitle).volumeNumber
                ? metadata.seriesTitle
                : book.seriesTitle,
          };

          const query = client
            .from('books')
            .update(toBookUpdate(updates))
            .eq('user_id', userId);
          const { error: updateError } =
            isUuid(book.id) || !book.isbn ? await query.eq('id', book.id) : await query.eq('isbn', book.isbn);

          if (updateError) {
            if ((updates.purchasePrice !== undefined || updates.listPrice !== undefined || updates.priceSource !== undefined || updates.priceFetchedAt !== undefined || updates.volumeKind !== undefined || updates.publishedDate !== undefined || updates.titleReading !== undefined || updates.seriesReading !== undefined) && isMissingOptionalSchemaColumnError(updateError)) {
              throw new Error('購入価格を保存するにはSupabaseの最新migrationを適用してください。');
            }
            throw new Error(formatSupabaseError(updateError, 'Supabaseの更新に失敗しました。'));
          }

          await saveMetadataEnrichmentAttempt(target, 'success');
          setBooks((currentBooks) =>
            currentBooks.map((currentBook) =>
              currentBook.id === book.id ? { ...currentBook, ...updates } : currentBook,
            ),
          );
        } catch (metadataError) {
          await saveMetadataEnrichmentAttempt(target, 'error');
          console.warn('Failed to enrich book metadata', metadataError);
        }
      }
    }

    enrichBooks();
  }, [books, configured, metadataEnrichmentCacheLoaded, user]);

  const findDuplicateBook = useCallback(
    (bookInput: BookInput) => findDuplicate(books, bookInput),
    [books],
  );

  const addBook = useCallback(async (bookInput: BookInput, options: AddBookOptions = {}) => {
    const normalizedBookInput = normalizeReadingBookInput(normalizeBookInput(bookInput));
    if (!options.allowDuplicate && findDuplicate(books, normalizedBookInput)) {
      throw new Error('同じISBN、または同じシリーズ・巻数の本がすでに登録されています。');
    }

    if (configured) {
      if (!supabase || !user) {
        const book: Book = {
          ...normalizedBookInput,
          id: createId('book'),
          userId: DEMO_USER_ID,
          createdAt: now(),
        };
        setBooks((currentBooks) => [book, ...currentBooks]);
        setPendingLocalBooks((currentBooks) => [book, ...currentBooks]);
        return book;
      }
      const bookId = createUuid();

      const insertPayload = toBookInsert(normalizedBookInput, user.id, bookId);
      let { error: insertError } = await supabase
        .from('books')
        .insert(insertPayload);

      if (insertError && isMissingOptionalSchemaColumnError(insertError)) {
        const fallbackResult = await supabase
          .from('books')
          .insert(omitOptionalSchemaColumns(insertPayload));
        insertError = fallbackResult.error;
      }

      if (insertError) {
        if (insertError.code === '23505') {
          throw new Error('同じISBNの本がすでに登録されています。');
        }
        throw new Error(formatSupabaseError(insertError, 'Supabaseへの登録に失敗しました。'));
      }

      const book: Book = {
        ...normalizedBookInput,
        id: bookId,
        userId: user.id,
        createdAt: now(),
      };
      setBooks((currentBooks) => [book, ...currentBooks]);
      return book;
    }

    const book: Book = {
      ...normalizedBookInput,
      id: createId('book'),
      userId: DEMO_USER_ID,
      createdAt: now(),
    };

    setBooks((currentBooks) => [book, ...currentBooks]);
    return book;
  }, [books, configured, user]);

  const addBookByIsbn = useCallback(
    async (isbn: string) => {
      const bookInput = await lookupBookByIsbn(isbn);
      if (!bookInput) return null;
      return addBook(bookInput);
    },
    [addBook],
  );

  const migrateLocalBooks = useCallback(async () => {
    if (!supabase || !user) {
      throw new Error('ローカル蔵書を移行するにはログインしてください。');
    }

    const comparisonBooks = [...books];
    const booksToImport: Book[] = [];

    for (const localBook of pendingLocalBooks) {
      const input = normalizeBookInput({
        isbn: localBook.isbn,
        title: localBook.title,
        titleReading: localBook.titleReading,
        seriesTitle: localBook.seriesTitle,
        volumeNumber: localBook.volumeNumber,
        author: localBook.author,
        seriesReading: localBook.seriesReading,
        publisher: localBook.publisher,
        publishedDate: localBook.publishedDate,
        purchasePrice: localBook.purchasePrice,
        listPrice: localBook.listPrice,
        priceSource: localBook.priceSource,
        priceFetchedAt: localBook.priceFetchedAt,
        thumbnailUrl: localBook.thumbnailUrl,
        status: localBook.status,
      });
      if (findDuplicate(comparisonBooks, input)) continue;

      const importedBook: Book = {
        ...input,
        id: createUuid(),
        userId: user.id,
        createdAt: localBook.createdAt || now(),
      };
      booksToImport.push(importedBook);
      comparisonBooks.push(importedBook);
    }

    if (booksToImport.length > 0) {
      const insertPayload = booksToImport.map((book) => toBookInsert(book, user.id, book.id));
      let { error: insertError } = await supabase
        .from('books')
        .insert(insertPayload);
      if (insertError && isMissingOptionalSchemaColumnError(insertError)) {
        const fallbackResult = await supabase
          .from('books')
          .insert(insertPayload.map(omitOptionalSchemaColumns));
        insertError = fallbackResult.error;
      }
      if (insertError) {
        throw new Error(formatSupabaseError(insertError, 'ローカル蔵書をクラウドへ移行できませんでした。'));
      }
      setBooks((currentBooks) => [...booksToImport, ...currentBooks]);
    }

    await AsyncStorage.removeItem(STORAGE_KEY);
    setPendingLocalBooks([]);
    return booksToImport.length;
  }, [books, pendingLocalBooks, user]);

  const updateBook = useCallback(async (bookId: string, updates: Partial<BookInput>) => {
    const book = books.find((candidate) => candidate.id === bookId);
    const normalizedUpdates = normalizeReadingBookInput(updates);
    const changesIdentity =
      normalizedUpdates.isbn !== undefined ||
      normalizedUpdates.seriesTitle !== undefined ||
      normalizedUpdates.volumeNumber !== undefined;

    if (book && changesIdentity) {
      const duplicate = findDuplicate(
        books.filter((candidate) => candidate.id !== bookId),
        normalizeBookInput({ ...book, ...normalizedUpdates }),
      );
      if (duplicate) {
        throw new Error(`${duplicate.title} と同じシリーズ・巻数、またはISBNになっています。`);
      }
    }

    if (configured) {
      if (supabase && user) {
        const query = supabase.from('books').update(toBookUpdate(normalizedUpdates)).eq('user_id', user.id);
        const { error: updateError } =
          isUuid(bookId) || !book?.isbn ? await query.eq('id', bookId) : await query.eq('isbn', book.isbn);

        if (updateError) {
          if ((normalizedUpdates.purchasePrice !== undefined || normalizedUpdates.listPrice !== undefined || normalizedUpdates.priceSource !== undefined || normalizedUpdates.priceFetchedAt !== undefined || normalizedUpdates.volumeKind !== undefined || normalizedUpdates.publishedDate !== undefined || normalizedUpdates.titleReading !== undefined || normalizedUpdates.seriesReading !== undefined) && isMissingOptionalSchemaColumnError(updateError)) {
            throw new Error('購入価格を保存するにはSupabaseの最新migrationを適用してください。');
          }
          throw new Error(formatSupabaseError(updateError, 'Supabaseの更新に失敗しました。'));
        }
      }
    }

    setBooks((currentBooks) =>
      currentBooks.map((book) => (book.id === bookId ? { ...book, ...normalizedUpdates } : book)),
    );
    if (configured && !user) {
      setPendingLocalBooks((currentBooks) =>
        currentBooks.map((book) => (book.id === bookId ? { ...book, ...normalizedUpdates } : book)),
      );
    }
  }, [books, configured, user]);

  const deleteBook = useCallback(async (bookId: string) => {
    const book = books.find((candidate) => candidate.id === bookId);
    const normalizedTargetIsbn = book?.isbn?.replace(/[^0-9X]/gi, '').toUpperCase();
    const matchesDeleteTarget = (candidate: Book) =>
      candidate.id === bookId ||
      (!!normalizedTargetIsbn && candidate.isbn?.replace(/[^0-9X]/gi, '').toUpperCase() === normalizedTargetIsbn);

    if (configured) {
      if (supabase && user) {
        const query = supabase.from('books').delete().eq('user_id', user.id);
        const deleteConditions = [
          isUuid(bookId) ? `id.eq.${bookId}` : undefined,
          book?.isbn ? `isbn.eq.${book.isbn}` : undefined,
          normalizedTargetIsbn ? `isbn.eq.${normalizedTargetIsbn}` : undefined,
        ].filter((condition, index, conditions): condition is string => !!condition && conditions.indexOf(condition) === index);
        const { error: deleteError } =
          deleteConditions.length > 0 ? await query.or(deleteConditions.join(',')) : { error: null };

        if (deleteError) {
          throw new Error(formatSupabaseError(deleteError, 'Supabaseの削除に失敗しました。'));
        }
      }
    }

    setBooks((currentBooks) =>
      currentBooks.filter((currentBook) => !matchesDeleteTarget(currentBook)),
    );
    if (configured && !user) {
      setPendingLocalBooks((currentBooks) =>
        currentBooks.filter((currentBook) => !matchesDeleteTarget(currentBook)),
      );
    }
  }, [books, configured, user]);

  const renameSeries = useCallback(async (fromSeriesTitle: string, toSeriesTitle: string) => {
    const nextSeriesTitle = toSeriesTitle.trim();
    if (!nextSeriesTitle) throw new Error('シリーズ名を入力してください。');
    if (fromSeriesTitle === nextSeriesTitle) return 0;

    const targetBooks = books.filter((book) => book.seriesTitle === fromSeriesTitle);
    if (targetBooks.length === 0) throw new Error('対象のシリーズが見つかりません。');

    if (configured && supabase && user) {
      const { error: updateError } = await supabase
        .from('books')
        .update({ series_title: nextSeriesTitle })
        .eq('user_id', user.id)
        .eq('series_title', fromSeriesTitle);

      if (updateError) {
        throw new Error(formatSupabaseError(updateError, 'シリーズ名の更新に失敗しました。'));
      }
    }

    setBooks((currentBooks) =>
      currentBooks.map((book) =>
        book.seriesTitle === fromSeriesTitle ? { ...book, seriesTitle: nextSeriesTitle } : book,
      ),
    );
    if (configured && !user) {
      setPendingLocalBooks((currentBooks) =>
        currentBooks.map((book) =>
          book.seriesTitle === fromSeriesTitle ? { ...book, seriesTitle: nextSeriesTitle } : book,
        ),
      );
    }
    return targetBooks.length;
  }, [books, configured, user]);

  const repairBookMetadata = useCallback(async (bookId: string, options: MetadataRepairOptions = {}) => {
    const book = books.find((candidate) => candidate.id === bookId);
    if (!book) throw new Error('対象の本が見つかりません。');

    const lookupTitle = buildMetadataLookupTitle(book);
    const lookupSource = options.preserveIdentity ? 'home-reading-repair' : 'manual-metadata-repair';
    const metadata =
      (book.isbn ? await safeLookupBookByIsbn(book.isbn, { source: lookupSource, title: book.title, reasons: describeMetadataNeeds(book) }) : null) ??
      (await lookupBookByTitle(lookupTitle, book.isbn)) ??
      (lookupTitle === book.title ? null : await lookupBookByTitle(book.title, book.isbn));
    if (!metadata) throw new Error('書籍情報を再取得できませんでした。');

    const beforePurchasePrice = book.purchasePrice ?? null;
    const metadataListPrice = typeof metadata.listPrice === 'number' ? metadata.listPrice : null;
    const nextListPrice = metadataListPrice ?? book.listPrice ?? null;
    const shouldFillPurchasePrice =
      options.updatePurchasePrice && typeof book.purchasePrice !== 'number' && nextListPrice !== null;
    const shouldUpdateListPrice = metadataListPrice !== null && metadataListPrice !== (book.listPrice ?? null);
    const updates: Partial<BookInput> = {
      seriesTitle: options.preserveIdentity ? book.seriesTitle : metadata.seriesTitle,
      volumeNumber: options.preserveIdentity ? book.volumeNumber : metadata.volumeNumber,
      volumeKind: options.preserveIdentity ? book.volumeKind : normalizeVolumeKind(metadata.volumeKind, metadata.title),
      author: metadata.author ?? book.author,
      publisher: metadata.publisher ?? book.publisher,
      titleReading: usableReading(metadata.titleReading) ?? usableReading(book.titleReading) ?? usableReading(metadata.title) ?? usableReading(book.title),
      seriesReading: usableReading(metadata.seriesReading) ?? usableReading(book.seriesReading) ?? usableReading(metadata.seriesTitle) ?? usableReading(book.seriesTitle),
      thumbnailUrl: metadata.thumbnailUrl ?? book.thumbnailUrl,
      ...(shouldUpdateListPrice
        ? {
            listPrice: metadataListPrice,
            priceSource: metadata.priceSource ?? book.priceSource,
            priceFetchedAt: metadata.priceFetchedAt ?? new Date().toISOString(),
          }
        : {}),
      ...(shouldFillPurchasePrice ? { purchasePrice: nextListPrice } : {}),
    };
    const afterPurchasePrice = updates.purchasePrice ?? beforePurchasePrice;
    const debugEntries = metadata.thumbnailUrl
      ? []
      : await lookupBookDebugInfo({ isbn: book.isbn, title: lookupTitle });

    await updateBook(book.id, updates);

    return {
      title: metadata.title,
      lookupTitle,
      beforeThumbnailUrl: book.thumbnailUrl,
      afterThumbnailUrl: updates.thumbnailUrl,
      seriesTitle: updates.seriesTitle,
      volumeNumber: updates.volumeNumber,
      volumeKind: updates.volumeKind,
      author: updates.author,
      publisher: updates.publisher,
      titleReading: updates.titleReading,
      seriesReading: updates.seriesReading,
      beforePurchasePrice,
      afterPurchasePrice,
      purchasePriceLookupAttempted: !!options.updatePurchasePrice,
      purchasePriceUpdated: beforePurchasePrice !== afterPurchasePrice,
      debugEntries,
    };
  }, [books, updateBook]);

  const bulkUpdateStatus = useCallback(async (bookIds: string[], status: ReadingStatus) => {
    if (configured) {
      if (supabase && user) {
        const { error: updateError } = await supabase
          .from('books')
          .update({ status })
          .in('id', bookIds)
          .eq('user_id', user.id);

        if (updateError) {
          throw new Error(formatSupabaseError(updateError, 'Supabaseの一括更新に失敗しました。'));
        }
      }
    }

    const selected = new Set(bookIds);
    setBooks((currentBooks) =>
      currentBooks.map((book) => (selected.has(book.id) ? { ...book, status } : book)),
    );
    if (configured && !user) {
      setPendingLocalBooks((currentBooks) =>
        currentBooks.map((book) => (selected.has(book.id) ? { ...book, status } : book)),
      );
    }
  }, [configured, user]);

  const seriesGroups = useMemo(() => buildSeriesGroups(books), [books]);

  const getSeriesItems = useCallback(
    (seriesTitle: string) => buildSeriesItems(books, seriesTitle, DEMO_USER_ID),
    [books],
  );

  const value = useMemo(
    () => ({
      books,
      loading,
      error,
      requiresAuth,
      localImportCount: pendingLocalBooks.length,
      seriesGroups,
      refreshLibrary,
      addBook,
      addBookByIsbn,
      findDuplicateBook,
      migrateLocalBooks,
      updateBook,
      renameSeries,
      deleteBook,
      repairBookMetadata,
      bulkUpdateStatus,
      getSeriesItems,
    }),
    [
      addBook,
      addBookByIsbn,
      books,
      bulkUpdateStatus,
      deleteBook,
      error,
      findDuplicateBook,
      getSeriesItems,
      loading,
      migrateLocalBooks,
      pendingLocalBooks.length,
      refreshLibrary,
      repairBookMetadata,
      renameSeries,
      requiresAuth,
      seriesGroups,
      updateBook,
    ],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const context = useContext(LibraryContext);
  if (!context) {
    throw new Error('useLibrary must be used inside LibraryProvider');
  }

  return context;
}

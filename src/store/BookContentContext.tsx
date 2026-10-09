import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { contentLookupKey, resolveReviewedContent, ReviewedBookContent } from '../lib/reviewedBookContent';
import { queueBookContentReviews } from '../lib/bookContentReviewQueue';
import { supabase } from '../lib/supabase';
import { useAppSettings } from './AppSettingsContext';

const Context = createContext<{
  rows: ReviewedBookContent[];
  register: (key: string) => () => void;
  refresh: () => void;
} | null>(null);

export function BookContentProvider({ children }: PropsWithChildren) {
  const { hydrated, showBookContent } = useAppSettings();
  const activeKeys = useRef(new Map<string, number>());
  const [revision, setRevision] = useState(0);
  const [rows, setRows] = useState<ReviewedBookContent[]>([]);
  const refresh = useCallback(() => {
    setRows([]);
    setRevision((value) => value + 1);
  }, []);
  const register = useCallback((key: string) => {
    if (!key) return () => {};
    const count = activeKeys.current.get(key) ?? 0;
    activeKeys.current.set(key, count + 1);
    if (!count) setRevision((value) => value + 1);
    return () => {
      const remaining = (activeKeys.current.get(key) ?? 1) - 1;
      if (remaining) activeKeys.current.set(key, remaining);
      else activeKeys.current.delete(key);
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      // Drop approvals before backgrounding; a revoked review cannot flash on resume.
      refresh();
      if (state !== 'active') setRows([]);
    });
    const timer = setInterval(() => setRevision((value) => value + 1), 15_000);
    return () => { subscription.remove(); clearInterval(timer); };
  }, [refresh]);

  useEffect(() => {
    const client = supabase;
    if (!hydrated || !showBookContent || !client || AppState.currentState === 'background') {
      setRows([]);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    // All mounted covers share batched lookups, including books without an ISBN.
    const timer = setTimeout(() => {
      deadline = setTimeout(() => controller.abort(), 10_000);
      void (async () => {
        const keys = [...activeKeys.current.keys()];
        const collected: ReviewedBookContent[] = [];
        for (const [prefix, column] of [['isbn:', 'isbn13'], ['url:', 'cover_url']] as const) {
          const values = keys.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
          for (let offset = 0; offset < values.length; offset += 50) {
            const { data, error } = await client.from('reviewed_book_content')
              .select('isbn13, cover_url, description').eq('enabled', true)
              .in(column, values.slice(offset, offset + 50)).abortSignal(controller.signal);
            if (error) throw error;
            collected.push(...(data ?? []));
          }
        }
        if (!cancelled) {
          setRows(collected);
          const known = new Set(collected.map((row) => row.isbn13));
          void queueBookContentReviews(keys.filter((key) => key.startsWith('isbn:')).map((key) => key.slice(5)).filter((isbn) => !known.has(isbn)), controller.signal);
        }
      })().catch(() => {
        if (!cancelled) setRows([]);
      }).finally(() => { if (deadline) clearTimeout(deadline); });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); if (deadline) clearTimeout(deadline); controller.abort(); };
  }, [hydrated, revision, showBookContent]);

  return <Context.Provider value={{ rows, register, refresh }}>{children}</Context.Provider>;
}

export function useReviewedBookContent(isbn?: string, coverUrl?: string) {
  const context = useContext(Context);
  const { hydrated, showBookContent } = useAppSettings();
  const key = contentLookupKey(isbn, coverUrl);
  const register = context?.register;
  useEffect(() => register?.(hydrated && showBookContent ? key : ''), [hydrated, key, register, showBookContent]);
  return resolveReviewedContent(hydrated && showBookContent, key, context?.rows ?? []);
}

export function useRefreshBookContent() {
  return useContext(Context)?.refresh ?? (() => {});
}

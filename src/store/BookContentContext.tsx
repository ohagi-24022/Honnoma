import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { contentLookupKey, resolveReviewedContent, ReviewedBookContent } from '../lib/reviewedBookContent';
import { supabase } from '../lib/supabase';
import { useAppSettings } from './AppSettingsContext';

type ContentLookupState = 'loading' | 'ready' | 'error';

const Context = createContext<{
  rows: ReviewedBookContent[];
  lookupState: ContentLookupState;
  register: (key: string) => () => void;
  refresh: () => void;
} | null>(null);

export function BookContentProvider({ children }: PropsWithChildren) {
  const { hydrated, showBookContent } = useAppSettings();
  const activeKeys = useRef(new Map<string, number>());
  const [revision, setRevision] = useState(0);
  const [rows, setRows] = useState<ReviewedBookContent[]>([]);
  const [lookupState, setLookupState] = useState<ContentLookupState>('loading');
  const refresh = useCallback(() => {
    setRows([]);
    setLookupState('loading');
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
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') setRevision((value) => value + 1);
    }, 15_000);
    return () => { subscription.remove(); clearInterval(timer); };
  }, [refresh]);

  useEffect(() => {
    const client = supabase;
    if (!hydrated || !showBookContent || !client || AppState.currentState === 'background') {
      setRows([]);
      setLookupState('loading');
      return;
    }
    // Keep a successful result during a periodic read, as before, without
    // making every mounted cover render a loading/ready cycle.
    setLookupState(current => current === 'error' ? 'loading' : current);
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
          setRows(previous => previous.length === collected.length && previous.every((row, index) => {
            const next = collected[index];
            return row.isbn13 === next.isbn13 && row.cover_url === next.cover_url && row.description === next.description;
          }) ? previous : collected);
          setLookupState('ready');
        }
      })().catch(() => {
        if (!cancelled) { setRows([]); setLookupState('error'); }
      }).finally(() => { if (deadline) clearTimeout(deadline); });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); if (deadline) clearTimeout(deadline); controller.abort(); };
  }, [hydrated, revision, showBookContent]);

  const value = useMemo(() => ({ rows, lookupState, register, refresh }), [rows, lookupState, register, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
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

export function useBookContentLookupState(): ContentLookupState {
  return useContext(Context)?.lookupState ?? 'loading';
}

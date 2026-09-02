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

import { getStorageItemWithLegacy } from '../lib/asyncStorageCompat';
import { parseSeriesTitle } from '../lib/series';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

const LEGACY_GUEST_STORAGE_KEY = 'booknest.wishlist.v1.guest';
const GUEST_STORAGE_KEY = 'honnoma.wishlist.v1.guest';
const LEGACY_STORAGE_KEY_PREFIX = 'booknest.wishlist.v1';
const STORAGE_KEY_PREFIX = 'honnoma.wishlist.v1';

export type WishlistItem = {
  id: string;
  title: string;
  score: number;
  coverUrl?: string;
  cloudNormalizedTitle?: string;
  note?: string;
  purchaseUrl?: string;
  createdAt: string;
  updatedAt: string;
};

type WishlistInput = {
  title: string;
  score: number;
  coverUrl?: string;
  note?: string;
  purchaseUrl?: string;
};

type WishlistContextValue = {
  items: WishlistItem[];
  addItem: (input: WishlistInput) => void;
  deleteItem: (id: string) => void;
  updateItem: (id: string, input: Partial<WishlistInput>) => void;
};

type WantedMangaRow = {
  created_at?: string | null;
  cover_url?: string | null;
  id?: string | null;
  note?: string | null;
  normalized_title: string;
  purchase_url?: string | null;
  score: number;
  title: string;
  updated_at?: string | null;
};

const WishlistContext = createContext<WishlistContextValue | null>(null);

function createId() {
  return `wish-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function clampScore(score: number) {
  if (!Number.isFinite(score)) return 50;
  return Math.min(Math.max(Math.round(score), 1), 100);
}

function normalizeWantedTitle(title: string) {
  return parseSeriesTitle(title).seriesTitle
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u300c\u300d\u300e\u300f\u3010\u3011\uff3b\uff3d[\]\uff08\uff09()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getStorageKey(userId?: string) {
  return userId ? `${STORAGE_KEY_PREFIX}.${userId}` : GUEST_STORAGE_KEY;
}

function getLegacyStorageKey(userId?: string) {
  return userId ? `${LEGACY_STORAGE_KEY_PREFIX}.${userId}` : LEGACY_GUEST_STORAGE_KEY;
}

function toWishlistItem(row: WantedMangaRow): WishlistItem {
  const now = new Date().toISOString();
  return {
    id: row.id ?? `cloud-${row.normalized_title}`,
    title: row.title,
    score: clampScore(row.score),
    coverUrl: row.cover_url ?? undefined,
    cloudNormalizedTitle: row.normalized_title,
    note: row.note ?? undefined,
    purchaseUrl: row.purchase_url ?? undefined,
    createdAt: row.created_at ?? row.updated_at ?? now,
    updatedAt: row.updated_at ?? row.created_at ?? now,
  };
}

function mergeItems(localItems: WishlistItem[], cloudItems: WishlistItem[]) {
  const byTitle = new Map<string, WishlistItem>();
  for (const item of [...localItems, ...cloudItems]) {
    const key = normalizeWantedTitle(item.title);
    if (!key) continue;
    const current = byTitle.get(key);
    if (!current || item.updatedAt.localeCompare(current.updatedAt) >= 0) {
      byTitle.set(key, { ...item, cloudNormalizedTitle: item.cloudNormalizedTitle ?? current?.cloudNormalizedTitle });
    } else if (item.cloudNormalizedTitle && !current.cloudNormalizedTitle) {
      byTitle.set(key, { ...current, cloudNormalizedTitle: item.cloudNormalizedTitle });
    }
  }
  return [...byTitle.values()];
}

function parseStoredItems(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as WishlistItem[]) : [];
  } catch {
    return [];
  }
}

export function WishlistProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const storageKey = getStorageKey(user?.id);
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const hydratedStorageKeyRef = useRef<string | null>(null);
  const appStateRefreshAtRef = useRef(0);

  const persistCloudItem = useCallback(
    async (item: WishlistItem) => {
      if (!supabase || !user) return;
      const normalizedTitle = normalizeWantedTitle(item.title);
      if (!normalizedTitle) return;
      if (item.cloudNormalizedTitle && item.cloudNormalizedTitle !== normalizedTitle) {
        await supabase
          .from('wanted_manga')
          .delete()
          .eq('user_id', user.id)
          .eq('normalized_title', item.cloudNormalizedTitle);
      }
      const { error } = await supabase.from('wanted_manga').upsert(
        {
          note: item.note ?? null,
          cover_url: item.coverUrl ?? null,
          normalized_title: normalizedTitle,
          purchase_url: item.purchaseUrl ?? null,
          score: item.score,
          title: item.title,
          updated_at: item.updatedAt,
          user_id: user.id,
        },
        { onConflict: 'user_id,normalized_title' },
      );
      if (error) {
        console.warn('Failed to sync wanted manga item.', error.message);
      }
    },
    [user],
  );

  const deleteCloudItem = useCallback(
    async (item: WishlistItem) => {
      if (!supabase || !user) return;
      const normalizedTitle = normalizeWantedTitle(item.title);
      if (!normalizedTitle) return;
      const keys = [...new Set([normalizedTitle, item.cloudNormalizedTitle].filter(Boolean))];
      const { error } = await supabase.from('wanted_manga').delete().eq('user_id', user.id).in('normalized_title', keys);
      if (error) {
        console.warn('Failed to delete wanted manga item.', error.message);
      }
    },
    [user],
  );

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const previousStorageKey = hydratedStorageKeyRef.current;
      hydratedStorageKeyRef.current = null;
      setHydrated(false);
      if (previousStorageKey !== storageKey) setItems([]);
      const storedItems = await getStorageItemWithLegacy(storageKey, getLegacyStorageKey(user?.id));
      let nextItems = parseStoredItems(storedItems);

      if (supabase && user) {
        const { data, error } = await supabase
          .from('wanted_manga')
          .select('id,title,normalized_title,score,cover_url,note,purchase_url,created_at,updated_at')
          .eq('user_id', user.id);
        if (!error) {
          nextItems = mergeItems(nextItems, (data ?? []).map(toWishlistItem));
        }
      }

      if (cancelled) return;
      hydratedStorageKeyRef.current = storageKey;
      setItems(nextItems);
      setHydrated(true);
      await AsyncStorage.setItem(storageKey, JSON.stringify(nextItems));
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [refreshNonce, storageKey, user]);

  useEffect(() => {
    if (!hydrated || hydratedStorageKeyRef.current !== storageKey) return;
    AsyncStorage.setItem(storageKey, JSON.stringify(items));
  }, [hydrated, items, storageKey]);
  useEffect(() => {
    if (!user) return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      const currentTime = Date.now();
      if (currentTime - appStateRefreshAtRef.current < 5000) return;
      appStateRefreshAtRef.current = currentTime;
      setRefreshNonce((current) => current + 1);
    });
    return () => subscription.remove();
  }, [user]);

  const value = useMemo(
    () => ({
      items: [...items].sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt)),
      addItem: (input: WishlistInput) => {
        const title = input.title.trim();
        if (!title) return;
        const now = new Date().toISOString();
        setItems((current) => {
          const normalizedTitle = normalizeWantedTitle(title);
          const existing = current.find((item) => normalizeWantedTitle(item.title) === normalizedTitle);
          const nextItem: WishlistItem = existing
            ? {
                ...existing,
                coverUrl: input.coverUrl?.trim() || existing.coverUrl,
                note: input.note?.trim() || existing.note,
                purchaseUrl: input.purchaseUrl?.trim() || existing.purchaseUrl,
                score: clampScore(input.score),
                title,
                updatedAt: now,
              }
            : {
                id: createId(),
                title,
                score: clampScore(input.score),
                coverUrl: input.coverUrl?.trim() || undefined,
                note: input.note?.trim() || undefined,
                purchaseUrl: input.purchaseUrl?.trim() || undefined,
                createdAt: now,
                updatedAt: now,
              };

          void persistCloudItem(nextItem);
          return existing
            ? current.map((item) => (item.id === existing.id ? nextItem : item))
            : [nextItem, ...current];
        });
      },
      deleteItem: (id: string) => {
        setItems((current) => {
          const deletedItem = current.find((item) => item.id === id);
          if (deletedItem) void deleteCloudItem(deletedItem);
          return current.filter((item) => item.id !== id);
        });
      },
      updateItem: (id: string, input: Partial<WishlistInput>) => {
        setItems((current) =>
          current.map((item) => {
            if (item.id !== id) return item;
            const nextItem = {
              ...item,
              ...(input.title !== undefined ? { title: input.title.trim() || item.title } : {}),
              ...(input.score !== undefined ? { score: clampScore(input.score) } : {}),
              ...(input.coverUrl !== undefined ? { coverUrl: input.coverUrl.trim() || undefined } : {}),
              ...(input.note !== undefined ? { note: input.note.trim() || undefined } : {}),
              ...(input.purchaseUrl !== undefined
                ? { purchaseUrl: input.purchaseUrl.trim() || undefined }
                : {}),
              updatedAt: new Date().toISOString(),
            };
            if (normalizeWantedTitle(nextItem.title) !== normalizeWantedTitle(item.title)) {
              void deleteCloudItem(item);
            }
            void persistCloudItem(nextItem);
            return nextItem;
          }),
        );
      },
    }),
    [deleteCloudItem, items, persistCloudItem],
  );

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist() {
  const context = useContext(WishlistContext);
  if (!context) {
    throw new Error('useWishlist must be used inside WishlistProvider');
  }
  return context;
}

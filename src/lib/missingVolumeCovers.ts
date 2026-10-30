import type { BookFormat, BookInput } from '../types';
import { searchMissingVolumeBookCandidates } from './bookApis';
import { resolveBookFormat } from './bookFormat';
import { normalizeSeriesKey } from './series';
import { PENDING_BOOK_COVER_URL } from './reviewedBookContent';

export type MissingVolumeCover = { volumeNumber: number; isbn: string; thumbnailUrl: string };
type Request = { seriesTitles: string[]; volumes: number[]; publisher?: string; format?: BookFormat };
const cache = new Map<string, { expires: number; item?: MissingVolumeCover }>();
const pending = new Map<string, Promise<MissingVolumeCover[]>>();
const providerCache = new Map<string, { expires: number; books: BookInput[] }>();
const providerPending = new Map<string, Promise<BookInput[]>>();
const prefix = (request: Request) => JSON.stringify({names:[...new Set(request.seriesTitles)].sort(),publisher:request.publisher??'',format:request.format??'unknown'});

/** Source images are used only on the private series screen, never public rankings. */
export function selectMissingVolumeSourceCovers(books: BookInput[], request: Request): MissingVolumeCover[] {
  const names = new Set(request.seriesTitles.flatMap(name => [name, name.replace(/\s+[:：]\s+.*$/, '')]).map(normalizeSeriesKey));
  const byVolume = new Map<number, Map<string, MissingVolumeCover>>();
  for (const book of books) {
    const volume = book.volumeNumber, isbn = book.isbn;
    if (!volume || !request.volumes.includes(volume) || !isbn || !/^(978|979)\d{10}$/.test(isbn)
      || [...isbn].reduce((sum, n, i) => sum + Number(n) * (i % 2 ? 3 : 1), 0) % 10 !== 0
      || !names.has(normalizeSeriesKey(book.seriesTitle)) || !/^https:\/\//.test(book.thumbnailUrl ?? '')
      || book.volumeKind === 'extra' || /特装|限定|新装|完全版|愛蔵|合本|ファンブック|アンソロジー|文庫版|special\s*edition|limited\s*edition/i.test(book.title)) continue;
    if (/同人版/.test(book.title) && !request.seriesTitles.some(name => /同人版/.test(name))) continue;
    if (request.publisher && normalizeSeriesKey(book.publisher ?? '') !== normalizeSeriesKey(request.publisher)) continue;
    const format = resolveBookFormat(book);
    if (request.format && request.format !== 'unknown' && format !== request.format) continue;
    const options = byVolume.get(volume) ?? new Map<string, MissingVolumeCover>();
    options.set(isbn, { volumeNumber: volume, isbn, thumbnailUrl: book.thumbnailUrl! });
    byVolume.set(volume, options);
  }
  return [...byVolume.values()].filter(options => options.size === 1).map(options => [...options.values()][0]);
}

async function sourceBooks(request: Request, base: string) {
  const cached = providerCache.get(base);
  if (cached && cached.expires > Date.now()) return cached.books;
  if (!providerPending.has(base)) providerPending.set(base, searchMissingVolumeBookCandidates(request.seriesTitles[0])
    .then(books => {
      providerCache.set(base, { books, expires: Date.now() + (books.length ? 24 * 60 * 60 * 1000 : 5 * 60 * 1000) });
      if (providerCache.size > 100) providerCache.delete(providerCache.keys().next().value!);
      return books;
    }).finally(() => providerPending.delete(base)));
  return providerPending.get(base)!;
}

/** One bounded catalog request per visible page; no per-book provider searches. */
export async function loadMissingVolumeCovers(request: Request): Promise<MissingVolumeCover[]> {
  const volumes = [...new Set(request.volumes)].filter(v => Number.isInteger(v) && v > 0 && v <= 500).slice(0,10);
  const base = prefix(request);
  const missing = volumes.filter(v => (cache.get(`${base}:${v}`)?.expires ?? 0) <= Date.now());
  if (missing.length) {
    const key = `${base}:${missing.slice().sort((a,b)=>a-b).join(',')}`;
    if (!pending.has(key)) pending.set(key, (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        let catalog: MissingVolumeCover[] = [];
        try {
          const response = await fetch(new URL('/api/series-volume-covers', PENDING_BOOK_COVER_URL).toString(), {
            method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
            body:JSON.stringify({...request,seriesTitles:[...new Set(request.seriesTitles)].filter(t=>t.trim().length>=2).slice(0,8),volumes:missing}),
          });
          if (!response.ok) throw new Error('Catalog unavailable');
          const payload = await response.json() as {items?:MissingVolumeCover[]};
          if (!Array.isArray(payload.items)) throw new Error('Invalid catalog response');
          catalog = payload.items.filter(item => missing.includes(item.volumeNumber) && /^(978|979)\d{10}$/.test(item.isbn)
            && /^https:\/\//.test(item.thumbnailUrl));
        } catch { /* Private source lookup can still work when the admin catalog is unavailable. */ }
        const unresolved = missing.filter(v => !catalog.some(item => item.volumeNumber === v));
        let cacheMisses = true;
        const sources = unresolved.length ? await sourceBooks(request, base)
          .then(books => selectMissingVolumeSourceCovers(books, { ...request, volumes: unresolved }))
          .catch(() => { cacheMisses = false; return []; }) : [];
        const valid = [...catalog, ...sources];
        for (const v of missing) {
          const item = valid.find(item=>item.volumeNumber===v);
          if (!item && !cacheMisses) continue;
          cache.set(`${base}:${v}`,{item,expires:Date.now()+(item?24*60*60*1000:5*60*1000)});
        }
        if (cache.size>1000) for(const k of [...cache.keys()].slice(0,cache.size-1000))cache.delete(k);
        return valid;
      } finally { clearTimeout(timeout); }
    })().finally(()=>pending.delete(key)));
    await pending.get(key);
  }
  return volumes.flatMap(v => { const item=cache.get(`${base}:${v}`)?.item; return item?[item]:[]; });
}

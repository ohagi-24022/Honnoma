import type { BookFormat } from '../types';
import { PENDING_BOOK_COVER_URL } from './reviewedBookContent';

export type MissingVolumeCover = { volumeNumber: number; isbn: string; thumbnailUrl: string };
type Request = { seriesTitles: string[]; volumes: number[]; publisher?: string; format?: BookFormat };
const cache = new Map<string, { expires: number; item?: MissingVolumeCover }>();
const pending = new Map<string, Promise<MissingVolumeCover[]>>();
const prefix = (request: Request) => JSON.stringify({names:[...new Set(request.seriesTitles)].sort(),publisher:request.publisher??'',format:request.format??'unknown'});

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
        const response = await fetch(new URL('/api/series-volume-covers', PENDING_BOOK_COVER_URL).toString(), {
          method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
          body:JSON.stringify({...request,seriesTitles:[...new Set(request.seriesTitles)].filter(t=>t.trim().length>=2).slice(0,8),volumes:missing}),
        });
        if (!response.ok) throw new Error('Catalog unavailable');
        const payload = await response.json() as {items?:MissingVolumeCover[]};
        if (!Array.isArray(payload.items)) throw new Error('Invalid catalog response');
        const valid = payload.items.filter(item => missing.includes(item.volumeNumber) && /^(978|979)\d{10}$/.test(item.isbn)
          && /^https:\/\//.test(item.thumbnailUrl));
        for (const v of missing) {
          const item = valid.find(item=>item.volumeNumber===v);
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

import { env } from './env';

const requested = new Map<string, number>();
export async function queueBookContentReviews(isbns: string[], signal?: AbortSignal) {
  const now = Date.now();
  for (const [isbn, expiry] of requested) if (expiry <= now) requested.delete(isbn);
  const pending = [...new Set(isbns)].filter(isbn => /^(978|979)\d{10}$/.test(isbn) && !requested.has(isbn));
  const configured = env.metadataOverrideApiUrl;
  let endpoint = 'https://shushukaadmin.onrender.com/api/book-content-review';
  if (configured) {
    try { const url = new URL(configured); if (url.protocol === 'https:') endpoint = `${url.origin}/api/book-content-review`; } catch { /* Use the public server endpoint. */ }
  }
  for (let index = 0; index < pending.length; index += 20) {
    const batch = pending.slice(index, index + 20);
    batch.forEach(isbn => requested.set(isbn, now + 300_000));
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isbns: batch }), signal });
      if (!response.ok) batch.forEach(isbn => requested.delete(isbn));
    } catch { batch.forEach(isbn => requested.delete(isbn)); }
  }
}

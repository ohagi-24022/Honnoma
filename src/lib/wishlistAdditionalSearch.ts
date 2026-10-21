import {searchSeriesCandidates, type SeriesSearchCandidate} from './bookApis';
import {PENDING_BOOK_COVER_URL} from './reviewedBookContent';
import {normalizeSeriesKey} from './series';
import {supabase} from './supabase';

export const wishlistSearchKey=(query:string)=>query.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const requests=new Map<string,Promise<SeriesSearchCandidate[]>>();
/** A button-triggered request; the server also deduplicates across sessions/devices. */
export function searchWishlistAgain(query:string):Promise<SeriesSearchCandidate[]>{
  const key=wishlistSearchKey(query);
  if(requests.has(key))return requests.get(key)!;
  const request=(async()=>{
    const session=await supabase?.auth.getSession();
    const token=session?.data.session?.access_token;
    if(!token)throw new Error('追加検索はログイン後に利用できます。');
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),25000);
    let queries:string[];
    try{
      const response=await fetch(new URL('/api/wishlist-search',PENDING_BOOK_COVER_URL).toString(),{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({query:query.trim()}),signal:controller.signal});
      const body=await response.json() as {queries?:unknown;error?:string};
      if (response.status === 429 && body.error === 'limited') { requests.delete(key); throw Object.assign(new Error('本日の追加検索の上限に達しました。時間をおいてお試しください。'), { retryable: true }); }
      if(!response.ok||!Array.isArray(body.queries))throw new Error(body.error==='limited'?'本日の追加検索の上限に達しました。時間をおいてお試しください。':body.error==='processing'?'同じ作品名を確認中です。しばらくしてから画面を開き直してください。':'追加検索を利用できませんでした。入力を変えて通常検索をお試しください。');
      if(body.queries.length>2||!body.queries.every(q=>typeof q==='string'&&q.length<=80))throw new Error('追加検索の結果を確認できませんでした。');
      queries=body.queries as string[];
    }finally{clearTimeout(timeout);}
    const results=await Promise.allSettled(queries.map(searchSeriesCandidates));
    const bySeries=new Map<string,SeriesSearchCandidate>();
    for(const result of results)if(result.status==='fulfilled')for(const item of result.value){const k=normalizeSeriesKey(item.seriesTitle);if(!bySeries.has(k))bySeries.set(k,item);}
    return [...bySeries.values()].slice(0,8);
  })();
  requests.set(key,request);
  // Failures stay memoized too: an uncertain network outcome must not cause another AI call.
  return request;
}

const comparable=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[\s・･:：\-–—_'"“”‘’()[\]{}「」『』【】〈〉《》!?！？。.．〜～]/g,'').replace(/僕モブを/g,'僕を');
const publisherKey=value=>comparable(value).replace(/squareenix/g,'スクウェアエニックス');
export function parseCatalogVolume(info){
  const title=String(info.title??'').normalize('NFKC').trim();
  if(/文庫|特装|限定|新装|完全版|愛蔵|合本|ファンブック|アンソロジー|公式ガイド|データブック/.test(title)||info.volume_kind==='extra')return null;
  const end=title.match(/^(.*?)\s*(?:[.．]?\s*(?:volume|vol\.?)[ \t]*|第\s*|\(\s*)?(\d+)\s*(?:巻|\))?$/i);
  const middle=title.match(/^(.*?)\s+(\d+)\s+[〜~～](.+)[〜~～]$/);
  const volume=Number(info.volume_number??end?.[2]??middle?.[2]);
  const series=info.series_title??(middle?middle[1]+middle[3]:end?.[1]?.trim());
  return series&&Number.isInteger(volume)&&volume>0&&volume<=500?{series,volume}:null;
}
export function selectSeriesVolumeCovers(rows,covers,{seriesTitles,volumes,publisher='',format='unknown'}){
  const names=new Set(seriesTitles.map(comparable));const wanted=new Set(volumes);
  const approved=new Map(covers.filter(row=>row.enabled&&/^https:\/\//.test(row.cover_url??'')).map(row=>[row.isbn13,row.cover_url]));
  const candidates=new Map();
  for(const row of rows){
    const info=row.metadata??row.candidate;if(!info)continue;
    const parsed=parseCatalogVolume(info);const isbn=row.normalized_isbn??row.isbn13;
    if(!parsed||!names.has(comparable(parsed.series))||!wanted.has(parsed.volume)||!approved.has(isbn))continue;
    if(publisher&&publisherKey(info.publisher)!==publisherKey(publisher))continue;
    const labels=`${info.imprint??''} ${info.subtitle??''} ${info.title??''}`;
    const detected=info.book_format??(/小説|ノベライズ|文庫|JUMP\s*j\s*BOOKS/i.test(labels)?'novel':/コミックス?|漫画|マンガ/.test(labels)?'comic':'unknown');
    if(format!=='unknown'&&detected!=='unknown'&&detected!==format)continue;
    const list=candidates.get(parsed.volume)??new Map();list.set(isbn,{volumeNumber:parsed.volume,isbn,thumbnailUrl:approved.get(isbn)});candidates.set(parsed.volume,list);
  }
  return [...candidates.values()].filter(list=>list.size===1).map(list=>[...list.values()][0]);
}
export function registerSeriesVolumeCovers(app,db,allowed){
  app.options('/api/series-volume-covers',(_req,res)=>res.set('Access-Control-Allow-Origin','*').set('Access-Control-Allow-Headers','Content-Type').sendStatus(204));
  app.post('/api/series-volume-covers',async(req,res)=>{
    res.set('Access-Control-Allow-Origin','*');
    if(!db)return res.status(503).json({error:'Unavailable'});
    if(!allowed(req))return res.status(429).json({error:'Rate limited'});
    const {seriesTitles,volumes,publisher='',format='unknown'}=req.body??{};
    if(!Array.isArray(seriesTitles)||!seriesTitles.length||seriesTitles.length>8||!seriesTitles.every(t=>typeof t==='string'&&t.trim().length>=2&&t.length<=200)
      ||!Array.isArray(volumes)||!volumes.length||volumes.length>10||!volumes.every(v=>Number.isInteger(v)&&v>0&&v<=500)
      ||typeof publisher!=='string'||publisher.length>200||!['comic','novel','unknown'].includes(format))return res.status(400).json({error:'Invalid series request'});
    try{
      // Match a conservative title prefix, then compare complete normalized names below.
      const prefixes=[...new Set(seriesTitles.map(t=>t.normalize('NFKC').replace(/^[【「『\[\s]+/,'').split(/[\s:：!！?？(（]/)[0]).filter(t=>t.length>=2))];
      if(!prefixes.length)return res.json({items:[]});
      const literal=t=>'"%'+t.replace(/[\\%_]/g,'\\$&').replaceAll('"','\\"')+'%"';
      const filters=prefixes.map(t=>'title.ilike.'+literal(t)).join(',');
      const [jobs,confirmed]=await Promise.all([
        db.from('book_content_review_jobs').select('isbn13,candidate').or(filters).not('candidate','is',null).order('isbn13').limit(500),
        db.from('confirmed_book_metadata').select('normalized_isbn,metadata').eq('enabled',true).in('metadata->>volume_number',volumes.map(String)).limit(500),
      ]);
      if(jobs.error||confirmed.error)throw new Error('Catalog unavailable');
      const rows=[...(confirmed.data??[]),...(jobs.data??[])];const ids=[...new Set(rows.map(r=>r.normalized_isbn??r.isbn13))];
      const covers=ids.length?await db.from('reviewed_book_content').select('isbn13,enabled,cover_url').eq('enabled',true).in('isbn13',ids):{data:[]};
      if(covers.error)throw new Error('Covers unavailable');
      return res.json({items:selectSeriesVolumeCovers(rows,covers.data??[],{seriesTitles,volumes,publisher,format})});
    }catch{return res.status(503).json({error:'Catalog unavailable'});}
  });
}

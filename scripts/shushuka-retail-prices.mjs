import {randomBytes} from 'node:crypto';
import {validIsbn} from './shushuka-content-review.mjs';

export async function retrieveRetailPrice(db,isbn){
  if(!validIsbn(isbn))return 'invalid';
  const {data:cached,error}=await db.from('book_metadata_cache').select('list_price').eq('normalized_isbn',isbn).maybeSingle();
  if(error)throw new Error('Price cache unavailable');
  if(!cached)return 'missing';
  if(cached.list_price!==null&&cached.list_price!==undefined)return 'skipped';
  const result=await db.functions.invoke('rakuten-books',{signal:AbortSignal.timeout(8000),body:{
    path:'BooksBook/Search/20170404',params:{isbn,hits:'1',format:'json',outOfStockFlag:'1'},
  }});
  if(result.error||result.data?.ok===false)throw new Error('Price provider unavailable');
  // BooksBook is the printed-book catalog; never borrow ebook/used prices or another edition.
  const item=result.data?.body?.Items?.map(x=>x.Item??x).find(x=>x.isbn===isbn);
  const price=item?.itemPrice;
  if(!Number.isInteger(price)||price<=0||price>1000000)return 'missing';
  const saved=await db.rpc('fill_missing_book_retail_price',{p_isbn:isbn,p_price:price});
  if(saved.error)throw new Error('Price save failed');
  return saved.data?'acquired':'skipped';
}
export async function retrieveRetailPrices(db,isbns){
  const outcomes=[];
  // Bound parallel provider requests even for an administrator's bulk action.
  const pending=[...new Set(isbns)].slice(0,5);
  while(pending.length){
    outcomes.push(...await Promise.all(pending.splice(0,2).map(async isbn=>{
      try{return {isbn,result:await retrieveRetailPrice(db,isbn)};}catch{return {isbn,result:'failed'};}
    })));
  }
  return outcomes;
}
export function registerRetailPriceAdmin(app,db){
  const csrf=randomBytes(32).toString('hex');
  app.post('/cache/prices',async(req,res)=>{
    if(!db)return res.sendStatus(503);
    if(req.body?.csrf!==csrf)return res.status(403).send('ページを開き直してください。');
    const isbns=Array.isArray(req.body.isbn)?req.body.isbn:[req.body.isbn];
    if(!isbns.length||isbns.length>5||!isbns.every(validIsbn))return res.status(400).send('ISBNを確認してください。');
    const outcomes=await retrieveRetailPrices(db,isbns);
    const query=new URLSearchParams({q:String(req.body.q??'').slice(0,100)});
    for(const state of ['acquired','missing','failed','skipped'])query.set('price_'+state,String(outcomes.filter(x=>x.result===state).length));
    res.redirect(303,'/cache?'+query);
  });
  return csrf;
}

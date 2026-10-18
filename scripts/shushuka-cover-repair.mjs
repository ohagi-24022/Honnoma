import {createHash} from 'node:crypto';
import {fetchCover,validIsbn} from './shushuka-content-review.mjs';

// Run only for explicitly requested ISBNs. Never replace an approved/public image.
export async function repairPendingCover(db,isbn,readImage=fetchCover){
 if(!validIsbn(isbn))return 'invalid';
 const {data:job,error}=await db.from('book_content_review_jobs').select('candidate,content_hash,adult_only,cover_status,status').eq('isbn13',isbn).maybeSingle();
 if(error)throw error;
 if(!job?.candidate?.cover_url||job.status!=='pending_review'||job.cover_status!=='unreviewed'||job.adult_only===true)return 'skipped';
 if(job.candidate.cover_repair_context==='server-v1')return 'already-repaired';
 const {data:published,error:readError}=await db.from('reviewed_book_content').select('isbn13').eq('isbn13',isbn).eq('enabled',true).maybeSingle();
 if(readError)throw readError;if(published)return 'skipped';
 const image=await readImage(job.candidate.cover_url);
 const candidate={...job.candidate,cover_reference_before_server_repair:{cover_url:job.candidate.cover_url,cover_hash:job.candidate.cover_hash},cover_hash:image.hash,cover_repair_context:'server-v1'};
 const hash=createHash('sha256').update(JSON.stringify(candidate)).digest('hex');
 let update=db.from('book_content_review_jobs').update({candidate,content_hash:hash,reason:'本番サーバーで表紙候補を再取得。分類・公開許可は維持。',updated_at:new Date().toISOString()})
   .eq('isbn13',isbn).eq('content_hash',job.content_hash).eq('cover_status','unreviewed').eq('status','pending_review');
 update=job.adult_only===null?update.is('adult_only',null):update.eq('adult_only',false);
 const result=await update.select('isbn13');if(result.error)throw result.error;
 return result.data?.length?'repaired':'changed';
}
export async function repairRequestedCovers(db,value,log=console.info){
 if(!db||!value)return;
 const isbns=[...new Set(String(value).split(',').map(x=>x.trim()).filter(validIsbn))].slice(0,25);
 const counts={};
 for(const isbn of isbns){let outcome;try{outcome=await repairPendingCover(db,isbn);}catch{outcome='failed';}counts[outcome]=(counts[outcome]??0)+1;}
 log('Requested cover repair complete '+JSON.stringify(counts));
}

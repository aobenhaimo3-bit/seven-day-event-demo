import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {plain,monthSample} from './collect-voa.mjs';
import {matchesTerms} from './collect-voa-supplement.mjs';
import {containerHtml} from './collect-conversation-supplement.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),OUT=path.join(ROOT,'local-data/expansion/2026-11-04');
const hash=s=>createHash('sha256').update(s).digest('hex');
export const QUERIES={S016:['Syria','Syrian','Damascus'],S017:['Congo','Congolese','DRC','Rwanda'],S018:['Yemen','Houthi','Red Sea']};
export function memoText(html){
 const cleaned=html.replace(/<(?:figure|iframe|script|style)\b[\s\S]*?<\/(?:figure|iframe|script|style)>/gi,'').replace(/<img\b[^>]*>/gi,'');
 const removed=[];
 const blocks=[...cleaned.matchAll(/<(p|li|h[2-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(m=>({html:m[0],text:plain(m[2])})).filter(b=>{
  if(!b.text||/^(?:READ|READ ALSO|WATCH|OPINION|EXCLUSIVE|RELATED):/i.test(b.text))return false;
  const links=[...b.html.matchAll(/<a\b[^>]*href=["'](https:\/\/www\.middleeastmonitor\.com\/\d{8}-[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const centered=/^<p\b[^>]*(?:text-align\s*:\s*center|align\s*=\s*["']center["'])/i.test(b.html);
  // Only an entire centered, bold internal headline is a related-story module.
  // Ordinary prose containing links and external source quotations remain intact.
  if(centered&&links.length===1&&plain(links[0][2])===b.text&&/<(?:b|strong)\b/i.test(b.html)){
   removed.push({text:b.text,url:links[0][1],reason:'standalone_centered_bold_related_article'});return false;
  }
  return true;
 });
 return {text:blocks.map(b=>b.text).join('\n\n'),article_html:blocks.map(b=>b.html).join('\n'),removed_related_blocks:removed};
}
export function parseMemo(post,page,retrievedAt,windows){
 const body=memoText(post.content?.rendered||'');
 const authorsBlock=containerHtml(page,'div','memo-news-author-content');
 const authorEntries=[...authorsBlock.matchAll(/<a\b[^>]*href=["'](https:\/\/www\.middleeastmonitor\.com\/authors\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m=>({url:m[1],name:plain(m[2])})).filter(x=>x.name);
 const unique=new Map(authorEntries.map(x=>[x.url,x.name]));
 const signed=unique.size>0,authors=signed?[...unique.values()]:['Middle East Monitor (unsigned)'];
 const agency=/\b(?:Reuters|Associated Press|Agence France|AFP|Anadolu|AP|AA)\b/i.test(authors.join(' '));
 const leadAgency=!signed&&(/\b(?:Reuters|Anadolu(?: Agency)?|Associated Press|Agence France[- ]Presse|AFP|AP)\b/i.test(body.text.split('\n\n')[0])||(/\b(?:Reuters|Anadolu(?: Agency)?|Associated Press|Agence France[- ]Presse|AFP)\s+(?:has\s+)?(?:reports?|reported)\b/i.test(body.text.slice(0,2000))||/\breported\s+(?:by\s+)?(?:Reuters|Anadolu(?: Agency)?|Associated Press|AFP)\b/i.test(body.text.split('\n\n')[0])||/\b(?:respond|response)\b.{0,80}\brequest for comment from\s+(?:Reuters|AFP|Anadolu)\b/i.test(body.text)));
 const republication=/\b(?:originally published|republished|reprinted|reproduced)\b.{0,140}\b(?:by|from|courtesy|permission)\b/i.test(body.text);
 const license=/creativecommons\.org\/licenses\/by-nc-sa\/4\.0\//i.test(page)&&/Unless otherwise stated in the article above/i.test(page);
 const date=/^\d{4}-\d{2}-\d{2}T/.test(post.date_gmt||post.date||'')?(post.date_gmt||post.date).slice(0,10):null;
 const visibleDateText=plain(containerHtml(page,'div','memo-news-date')).split(/\s+at\s+/i)[0];
 const visibleTime=Date.parse(visibleDateText+' UTC'),visibleDate=Number.isFinite(visibleTime)?new Date(visibleTime).toISOString().slice(0,10):null;
 const title=plain(post.title?.rendered||'');
 const windowIds=windows.filter(w=>date&&date>=w.start&&date<=w.end&&matchesTerms(title+' '+body.text.slice(0,800),QUERIES[w.reference_case]).length).map(w=>w.id);
 const reason=!license?'article_license_unverified':agency?'agency_byline':leadAgency?'agency_report_attribution':republication?'third_party_republication':!date?'missing_publication_date':visibleDate!==date?'api_and_visible_publication_date_mismatch':body.text.length<400?'missing_or_short_body':!windowIds.length?'outside_window_or_neutral_lead_terms':null;
 const quotedSources=[...new Set(body.text.match(/Reuters|Associated Press|Agence France[- ]Presse|AFP|Anadolu/gi)||[])];
 return {news_id:'MEMO-'+post.id,publisher:'Middle East Monitor',editorial_origin:agency?authors.join('; '):leadAgency?'External news agency attributed in lead':'Middle East Monitor',origin_verification:agency||leadAgency?'external_agency_attributed':signed?'named_byline_publisher_attribution':'publisher_attribution_only',canonical_url:post.link,title,text:reason?'':body.text,article_html:reason?'':body.article_html,published_date:date,authors,author_urls:[...unique.keys()],byline_status:signed?'named':'unsigned',author_verification:{kind:signed?'visible_article_byline':'publisher_unsigned_byline',source_url:post.link,display_names:authors},source_type:signed?'publisher_named_news':'publisher_unsigned_news',genre:(post.class_list||[]).some(c=>/^category-(?:opinion|opinion-pieces|reviews|commentary)$/.test(c))?'analysis':'news_reporting',license:'CC BY-NC-SA 4.0',license_url:'https://creativecommons.org/licenses/by-nc-sa/4.0/',license_source_url:post.link,article_license_verified:license,retrieved_at:retrievedAt,source_modified_at:post.modified_gmt||post.modified||null,window_ids:windowIds,query_terms:[...new Set(windows.filter(w=>windowIds.includes(w.id)).flatMap(w=>matchesTerms(title+' '+body.text.slice(0,800),QUERIES[w.reference_case])))],content_sha256:reason?null:hash(body.text),full_text_status:reason?'excluded':'available',exclusion_reason:reason,source_links:[...new Set([...body.article_html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map(m=>m[1]))],quoted_source_mentions:quotedSources,removed_related_blocks:body.removed_related_blocks,labels:null,review_status:'pending',relevance_verified:false,factual_independence_verified:false,historical_snapshot_verified:false,wp_internal_editor_id:post.author,publication_date_source:'WordPress date_gmt (public API)',visible_publication_date:visibleDate,public_article_date_verified:visibleDate===date,source_genre_categories:(post.class_list||[]).filter(c=>c.startsWith('category-'))};
}
async function main(){
 const plan=JSON.parse(await fs.readFile(path.join(ROOT,'research/data-expansion-plan.json'),'utf8'));
 const windows=plan.windows.filter(w=>['cross-S016','cross-S018','cross-S017','calendar-S017'].includes(w.id));
 const cacheDir=path.join(OUT,'memo-supplement-cache');await fs.mkdir(cacheDir,{recursive:true});const requests=[];
 async function get(url){const file=path.join(cacheDir,hash(url)+'.txt');try{return {text:await fs.readFile(file,'utf8'),at:(await fs.stat(file)).mtime.toISOString()};}catch{}if(process.argv.includes('--cache-only'))throw Error('Cache-only mode: missing '+url);for(let attempt=1;attempt<=3;attempt++){try{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});requests.push({url,http_status:r.status,attempt,at:new Date().toISOString()});if(!r.ok)throw Error('HTTP '+r.status);const text=await r.text();await fs.writeFile(file,text);return {text,at:new Date().toISOString()};}catch(e){if(attempt===3)throw e;await new Promise(r=>setTimeout(r,300*attempt));}}}
 const posts=new Map(),discovery=[];
 for(const w of windows)for(const term of QUERIES[w.reference_case])for(let page=1;page<=3;page++){
  const url='https://www.middleeastmonitor.com/wp-json/wp/v2/posts?'+new URLSearchParams({search:term,after:w.start+'T00:00:00',before:w.end+'T23:59:59',per_page:'100',page:String(page),orderby:'date',order:'asc',_fields:'id,date,date_gmt,modified,modified_gmt,link,title,content,author,class_list'});
  try{const raw=await get(url),rows=JSON.parse(raw.text);if(!Array.isArray(rows))throw Error('not array');discovery.push({window_id:w.id,term,page,rows:rows.length});for(const p of rows)posts.set(p.id,p);if(rows.length<100)break;}catch(e){discovery.push({window_id:w.id,term,page,error:e.message});break;}
 }
 const chosen=new Map();for(const w of windows){const pool=[...posts.values()].filter(p=>(p.date_gmt||p.date).slice(0,10)>=w.start&&(p.date_gmt||p.date).slice(0,10)<=w.end&&matchesTerms(plain(p.title.rendered)+' '+memoText(p.content.rendered).text.slice(0,800),QUERIES[w.reference_case]).length);const sampled=monthSample(pool.map(p=>({...p,url:p.link,lastmod:p.date_gmt||p.date})),w.id==='cross-S018'?80:40,plan.seed+'|MEMO-supplement-v1|'+w.id);for(const p of sampled)chosen.set(p.id,p);discovery.push({window_id:w.id,eligible_neutral_lead:pool.length,fixed_selected:sampled.length});}
 if(process.argv.includes('--reparse-existing')){const prior=(await fs.readFile(path.join(OUT,'memo-supplement-candidates.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);chosen.clear();for(const r of prior){const id=Number(r.news_id.replace('MEMO-','')),post=posts.get(id);if(!post)throw Error('Missing cached post for fixed candidate '+id);chosen.set(id,post);}}
 const queue=[...chosen.values()],records=[];async function worker(){while(queue.length){const p=queue.shift();try{const got=await get(p.link);records.push(parseMemo(p,got.text,got.at,windows));}catch(e){const r=parseMemo(p,'',new Date().toISOString(),windows);r.exclusion_reason='fetch_failed: '+e.message;records.push(r);}if(records.length%20===0)console.log('MEMO processed',records.length,'/',chosen.size);}}
 await Promise.all([worker(),worker(),worker()]);records.sort((a,b)=>a.canonical_url.localeCompare(b.canonical_url));
 await fs.writeFile(path.join(OUT,'memo-supplement-candidates.jsonl'),records.map(r=>JSON.stringify(r)).join('\n')+'\n');
 const counts=windows.map(w=>({window_id:w.id,available:records.filter(r=>r.full_text_status==='available'&&r.window_ids.includes(w.id)).length}));
 await fs.writeFile(path.join(OUT,'memo-supplement-log.json'),JSON.stringify({created_at:new Date().toISOString(),cache_only:process.argv.includes('--cache-only'),fixed_existing_candidate_reparse:process.argv.includes('--reparse-existing'),removed_related_blocks:records.reduce((n,r)=>n+(r.removed_related_blocks?.length||0),0),policy:'Fixed country/region API searches, original windows; max 3 API pages of 100 per term; title/first800 neutral-term filter; seeded calendar-month round robin, cross-S018 cap80 and other windows cap40. No outcome scores. Each public article page must contain own CC BY-NC-SA4 notice. Visible bylines only; internal WP editor identities are never treated as authors. Agency bylines, lead agency reports and republication declarations excluded; ordinary cited sources preserved and not claimed independent.',discovery,counts,requests},null,2));console.log(JSON.stringify({total:records.length,available:records.filter(r=>r.full_text_status==='available').length,counts}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();

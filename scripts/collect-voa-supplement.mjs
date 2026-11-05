import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArticle } from './collect-voa.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const OUT=path.join(ROOT,'local-data/expansion/2026-11-04');
const hash=s=>createHash('sha256').update(s).digest('hex');
export const TERMS={
  S016:['Syria','Syrian','Damascus','Aleppo'],
  S017:['Congo','Congolese','DRC','DR Congo','Democratic Republic','M23','Rwanda','Rwandan','Goma','Kinshasa'],
  S018:['Yemen','Yemeni','Houthi','Houthis','Red Sea','Aden','Hodeidah','Sanaa'],
  S019:['Gaza','Israel','Israeli','Palestine','Palestinian'],
};
export function matchesTerms(value,terms) {
  const normalized=String(value).normalize('NFKC').toLowerCase().replace(/[-_\s]+/g,' ');
  return terms.filter(term=>new RegExp('(?<![a-z])'+term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![a-z])').test(normalized));
}
export function verifiedWindows(record,windows) {
  return windows.filter(w=>record.published_date&&record.published_date>=w.start&&record.published_date<=w.end&&matchesTerms(record.title+' '+record.text,TERMS[w.reference_case]||w.terms).length).map(w=>w.id);
}
export function selectSupplement(pools,seed,cap=300,perWindow=150) {
  const sorted=pools.map(p=>({...p,rows:[...p.rows].sort((a,b)=>hash(`${seed}|${p.id}|${a.url}`).localeCompare(hash(`${seed}|${p.id}|${b.url}`))).slice(0,perWindow)}));
  const result=new Map();
  while(result.size<cap&&sorted.some(p=>p.rows.length)) for(const p of sorted) {
    const item=p.rows.shift();if(!item)continue;
    if(!result.has(item.url))result.set(item.url,{...item,discovery_window_ids:[]});
    result.get(item.url).discovery_window_ids.push(p.id);
    if(result.size===cap)break;
  }
  return [...result.values()];
}
export function supplementParse(html,url,retrievedAt,windows) {
  const record=parseArticle(html,url,retrievedAt);
  // Keep the original parser's strict wire exclusions and add AP abbreviations/partner declarations.
  if(record.full_text_status==='available'&&/(?:\b(?:information|report|material|compiled|adapted)\w*\b.{0,100}\bAP\b|\bAP\b.{0,80}\bcontribut|\b(?:republished|reprinted|reproduced)\b.{0,100}\b(?:permission|courtesy|from)\b|\bin partnership with\b|\b(?:Reuters|Associated Press|AFP)\b.{0,30}\bquoted\b|\b(?:told|interview with)\s+(?:the\s+)?(?:Associated Press|Reuters|AFP)\b)/i.test(record.text)) {
    record.full_text_status='excluded';record.exclusion_reason='wire_or_partner_contribution';record.text='';record.content_sha256=null;
  }
  record.window_ids=verifiedWindows(record,windows);
  if(record.full_text_status==='available'&&!record.window_ids.length){record.full_text_status='excluded';record.exclusion_reason='publication_date_or_neutral_terms_outside_windows';record.text='';record.content_sha256=null;}
  record.query_terms=[...new Set(windows.filter(w=>record.window_ids.includes(w.id)).flatMap(w=>matchesTerms(record.title+' '+record.text,TERMS[w.reference_case])))];
  record.label_status='pending';
  return record;
}
async function main(){
  const plan=JSON.parse(await fs.readFile(path.join(ROOT,'research/data-expansion-plan.json'),'utf8'));
  const windows=plan.windows.filter(w=>TERMS[w.reference_case]);
  const old=(await fs.readFile(path.join(OUT,'voa-candidates.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  const oldUrls=new Set(old.map(r=>r.canonical_url));
  const frozenFile=path.join(OUT,'samples-calendar-source-expansion-v2.jsonl');
  const frozenBefore=hash(await fs.readFile(frozenFile));
  const cacheDir=path.join(OUT,'voa-supplement-cache');await fs.mkdir(cacheDir,{recursive:true});
  const logs=[];
  async function cached(url){for(const dir of ['voa-cache','voa-supplement-cache']){const file=path.join(OUT,dir,hash(url)+'.txt');try{return {html:await fs.readFile(file,'utf8'),at:(await fs.stat(file)).mtime.toISOString()};}catch{}}return null;}
  async function fetchPage(url){const hit=await cached(url);if(hit){logs.push({url,status:'cache_hit'});return hit;}for(let attempt=1;attempt<=3;attempt++){try{const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP '+r.status);const html=await r.text(),at=new Date().toISOString();await fs.writeFile(path.join(cacheDir,hash(url)+'.txt'),html);logs.push({url,status:'fetched',attempt,at});return {html,at};}catch(e){logs.push({url,status:'failed',attempt,message:e.message});if(attempt===3)throw e;await new Promise(r=>setTimeout(r,300*attempt));}}}
  const urls=new Map();
  for(let n=1;n<=6;n++){const u=`https://www.voanews.com/sitemap_415_${n}.xml.gz`;const c=await cached(u);if(!c)throw Error('Required existing sitemap cache missing: '+u);for(const m of c.html.matchAll(/<url>([\s\S]*?)<\/url>/g)){const url=m[1].match(/<loc>(.*?)<\/loc>/)?.[1],lastmod=m[1].match(/<lastmod>(.*?)<\/lastmod>/)?.[1];if(url&&lastmod&&/\/a\/[^/]+\/\d+\.html/.test(url))urls.set(url,{url,lastmod,article_id:Number(url.match(/\/(\d+)\.html/)[1]),sitemap_shard:n});}}
  const seed=plan.seed+'|voa-supplement-v1';
  const pools=windows.map(w=>{
    const ids=old.filter(r=>r.published_date>=w.start&&r.published_date<=w.end).map(r=>Number(r.news_id.replace('VOA-',''))).filter(Number.isFinite);
    // Numeric article IDs are discovery hints only; allow delayed page modifications without equating lastmod with publication.
    const bounds=ids.length?[Math.min(...ids)-25000,Math.max(...ids)+25000]:null;
    const rows=[...urls.values()].filter(r=>!oldUrls.has(r.url)&&matchesTerms(r.url,TERMS[w.reference_case]).length&&((r.lastmod.slice(0,10)>=w.start&&r.lastmod.slice(0,10)<=w.end)||(bounds&&r.article_id>=bounds[0]&&r.article_id<=bounds[1])));
    return {id:w.id,rows,id_discovery_bounds:bounds};
  }).sort((a,b)=>{const score=id=>id.includes('S017')?0:id.includes('S018')?1:2;return score(a.id)-score(b.id)||a.id.localeCompare(b.id);});
  const chosen=selectSupplement(pools,seed),queue=[...chosen],records=[];
  // Reuse old fetched candidates only where expanded neutral aliases discover new window memberships; never rewrite old records.
  for(const row of old.filter(r=>r.full_text_status==='available')){const newIds=verifiedWindows(row,windows).filter(id=>!row.window_ids.includes(id));if(newIds.length){const got=await cached(row.canonical_url);if(!got)continue;const checked=supplementParse(got.html,row.canonical_url,got.at,windows);records.push({...checked,window_ids:checked.full_text_status==='available'?newIds:[],discovery_window_ids:newIds,discovery_method:'existing_candidate_new_window_membership'});}}
  async function worker(){while(queue.length){const item=queue.shift();try{const got=await fetchPage(item.url);records.push({...supplementParse(got.html,item.url,got.at,windows),discovery_window_ids:item.discovery_window_ids,discovery_lastmod:item.lastmod,discovery_sitemap_shard:item.sitemap_shard,discovery_method:'neutral_url_and_lastmod_or_numeric_id_hint'});}catch(e){records.push({...parseArticle('',item.url,new Date().toISOString()),discovery_window_ids:item.discovery_window_ids,exclusion_reason:'fetch_failed: '+e.message,label_status:'pending'});}if(records.length%20===0)console.log('VOA supplement processed',chosen.length-queue.length,'/',chosen.length);}}
  await Promise.all([worker(),worker(),worker()]);
  records.sort((a,b)=>a.canonical_url.localeCompare(b.canonical_url));
  await fs.writeFile(path.join(OUT,'voa-supplement-candidates.jsonl'),records.map(r=>JSON.stringify(r)).join('\n')+'\n');
  const frozenAfter=hash(await fs.readFile(frozenFile));if(frozenAfter!==frozenBefore)throw Error('Frozen v2 changed during collection; investigate externally modified file');
  const log={created_at:new Date().toISOString(),seed,new_article_url_limit:300,per_window_candidate_cap:150,chosen_new_article_urls:chosen.length,terms:TERMS,frozen_v2_sha256_before:frozenBefore,frozen_v2_sha256_after:frozenAfter,discovery:pools.map(p=>({window_id:p.id,candidates:p.rows.length,id_discovery_bounds:p.id_discovery_bounds})),counts:windows.map(w=>({window_id:w.id,new_available:records.filter(r=>r.full_text_status==='available'&&r.window_ids.includes(w.id)).length})),limitations:['Not an exhaustive archive. Discovery uses fixed cached sitemap shards 1–6, expanded neutral URL terms, and either matching lastmod dates or numeric article-ID bounds inferred from prior verified dated articles ±25000. IDs/lastmod never supply publication labels.','At most 150 seeded-ranked candidates per window and 300 new article URLs overall, round-robin across windows; no outcome keywords or detector scores.','Current historical pages are not authenticated publication-time snapshots. Full text remains unreviewed; calendar strata are not negative labels.','Original 116 v2 samples and original candidate files were not rewritten.'],requests:logs};
  await fs.writeFile(path.join(OUT,'voa-supplement-log.json'),JSON.stringify(log,null,2));console.log(JSON.stringify({records:records.length,available:records.filter(r=>r.full_text_status==='available').length,counts:log.counts}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();

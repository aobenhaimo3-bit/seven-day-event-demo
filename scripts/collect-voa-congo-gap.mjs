import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {plain,parseArticle} from './collect-voa.mjs';
import {containerHtml} from './collect-conversation-supplement.mjs';
import {matchesTerms} from './collect-voa-supplement.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),OUT=path.join(ROOT,'local-data/expansion/2026-11-04');
const hash=s=>createHash('sha256').update(s).digest('hex');
export const TERMS=['Congo','Congolese','DRC','DR Congo','Democratic Republic','M23','Rwanda','Rwandan','Tshisekedi','Kagame','MONUSCO','Kivu','Bukavu','Lubumbashi','Kinshasa','Goma'];
export function recoverClaimReview(html,url,retrievedAt){
 const docs=[...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>(.*?)<\/script>/gs)].flatMap(m=>{try{return [JSON.parse(m[1])];}catch{return [];}});
 const ld=docs.find(d=>d['@type']==='ClaimReview');if(!ld)return null;
 const byline=/By\s*<a\b[^>]*href="(\/author\/[^"\s]+)"[^>]*>(.*?)<\/a>/is.exec(html);
 if(!byline||!/^Voice of America/.test(ld.publisher?.name||''))return null;
 const author={name:plain(byline[2]),url:'https://www.voanews.com'+byline[1]};
 // ClaimReview has a quoted-claim .wsw before the article body. Scope extraction to the actual article.
 const body=containerHtml(html,'div','content-floated-wrap');
 const text=[...body.replace(/<script\b[\s\S]*?<\/script>/gi,'').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m=>plain(m[1])).filter(p=>p&&!/^(Share|Print)$/.test(p)).join('\n\n');
 const normalizedMetadata={...ld,'@type':'NewsArticle',author};
 const row=parseArticle('<script type="application/ld+json">'+JSON.stringify(normalizedMetadata)+'</script>'+body,url,retrievedAt);
 const contribution=/\b(?:some (?:information|material)|reporting|additional reporting)\b.{0,100}\b(?:from|by)\b.{0,30}\b(?:Reuters|Associated Press|AFP|Anadolu)\b|\b(?:Reuters|Associated Press|AFP|Anadolu)\b.{0,40}\bcontributed\b|\b(?:republished|reprinted|reproduced)\b/i.test(text);
 // Mentioning a Reuters report being fact-checked is not a declaration of syndicated authorship.
 if(row.exclusion_reason==='wire_agency_contribution'&&!contribution&&text.length>=400){row.full_text_status='available';row.exclusion_reason=null;row.text=text;row.content_sha256=hash(text);}
 const visible=html.match(/<time\b[^>]*datetime="([^"]+)"/i)?.[1];
 if(!visible||!Number.isFinite(Date.parse(visible))||new Date(visible).toISOString().slice(0,10)!==row.published_date){row.full_text_status='excluded';row.exclusion_reason='visible_and_metadata_date_mismatch';}
 const inWindow=row.published_date>='2024-01-01'&&row.published_date<='2024-03-31';
 const terms=matchesTerms(row.title,TERMS);
 if(!inWindow||!terms.length){row.full_text_status='excluded';row.exclusion_reason='outside_fixed_window_or_neutral_title_scope';}
 if(contribution){row.full_text_status='excluded';row.exclusion_reason='explicit_wire_contribution_or_republication';}
 if(row.full_text_status==='excluded'){row.text='';row.content_sha256=null;}
 return {...row,window_ids:inWindow&&terms.length?['calendar-S017']:[],query_terms:terms,source_type:'fact_check_analysis',genre:'fact_check_analysis',source_metadata_schema:'ClaimReview',source_claim_review:{claim:ld.claimReviewed,claim_source:ld.itemReviewed?.mainEntityOfPage,source_verdict:ld.reviewRating?.alternateName},author_verification:{kind:'visible_article_byline',source_url:url,display_names:[author.name]},public_article_date_verified:visible?new Date(visible).toISOString().slice(0,10)===row.published_date:false,quoted_source_mentions:[...new Set(text.match(/Reuters|Associated Press|AFP|Anadolu/g)||[])],review_status:'pending',labels:null,factual_independence_verified:false,historical_snapshot_verified:false,discovery_method:'neutral_calendar_search_recovers_previously_unsupported_ClaimReview_schema'};
}
async function main(){
 const files=['voa-candidates.jsonl','voa-supplement-candidates.jsonl'],old=(await Promise.all(files.map(async f=>(await fs.readFile(path.join(OUT,f),'utf8')).trim().split('\n').map(JSON.parse)))).flat(),ids=new Set(old.map(r=>r.news_id));
 const seed='seven-day-calendar-source-v3-congo-gap-v1',remaining=new Map();
 for(let n=1;n<=6;n++){const xml=await fs.readFile(path.join(OUT,'voa-cache',hash(`https://www.voanews.com/sitemap_415_${n}.xml.gz`)+'.txt'),'utf8');for(const m of xml.matchAll(/<url>(.*?)<\/url>/gs)){const url=m[1].match(/<loc>(.*?)<\/loc>/)?.[1],lastmod=m[1].match(/<lastmod>(.*?)<\/lastmod>/)?.[1],id=url?.match(/\/(\d+)\.html/)?.[1];if(id&&!ids.has('VOA-'+id)&&matchesTerms(url,TERMS).length&&((lastmod>='2024-01-01'&&lastmod<'2024-04-01')||(Number(id)>=7394960&&Number(id)<=7575484)))remaining.set(id,{url,lastmod,id});}}
 const records=[],recoveryInspected=[];
 for(const prior of old.filter(r=>r.full_text_status==='excluded'))for(const dir of ['voa-cache','voa-supplement-cache']){const file=path.join(OUT,dir,hash(prior.canonical_url)+'.txt');let html;try{html=await fs.readFile(file,'utf8');}catch{continue;}const record=recoverClaimReview(html,prior.canonical_url,(await fs.stat(file)).mtime.toISOString());if(record&&record.window_ids.length){recoveryInspected.push({id:record.news_id,prior_reason:prior.exclusion_reason,new_status:record.full_text_status});records.push(record);}break;}
 const unique=[...new Map(records.map(r=>[r.news_id,r])).values()].sort((a,b)=>hash(seed+'|'+a.canonical_url).localeCompare(hash(seed+'|'+b.canonical_url))).slice(0,60);
 await fs.writeFile(path.join(OUT,'voa-congo-gap-candidates.jsonl'),unique.map(r=>JSON.stringify(r)).join('\n')+(unique.length?'\n':''));
 await fs.writeFile(path.join(OUT,'voa-congo-gap-log.json'),JSON.stringify({created_at:new Date().toISOString(),seed,window:{id:'calendar-S017',start:'2024-01-01',end:'2024-03-31'},reason:'Follow-up after fixed 300-URL supplement and stricter source/scope checks left one calendar Congo slot; no dates or labels relaxed.',terms:TERMS,new_url_cap:60,remaining_cached_sitemap_unrequested_neutral_candidates:remaining.size,remaining_candidates:[...remaining.values()],new_http_article_requests:0,cached_schema_recoveries:recoveryInspected,available:unique.filter(r=>r.full_text_status==='available').length,web_search_followup:{basis:'Official VOA domain, neutral country/place/person terms and Jan/Feb/Mar 2024. Some queries additionally constrained named VOA authors or excluded wire bylines; no event outcomes used.',queries:['site:voanews.com Congo January 2024 By','site:voanews.com Congolese February 2024 By','site:voanews.com Rwanda March 2024 By','site:voanews.com Kivu 2024 March','site:voanews.com/a/ Congo March 2024 -Associated Press -Agence France-Presse -Reuters','site:voanews.com/a/ Rwanda February 2024 -Associated Press -Agence France-Presse -Reuters','site:voanews.com/a/ Kivu 2024 January -Associated Press -Reuters','site:voanews.com/a/ Congo February 2024 Lisa Schlein','site:voanews.com Rwanda March 2024','site:voanews.com Congo February 2024 Mohammed Yusuf','site:voanews.com Congo March 2024 Muvunyi','site:voanews.com Kagame January 2024','site:voanews.com Kinshasa 2024 March By','site:voanews.com Bukavu 2024 February','site:voanews.com Rwanda 2024 March Emilie','site:voanews.com Congolese 2024 February Kate Bartlett'],recovery_url:'https://www.voanews.com/a/fact-check-african-stream-falsely-claims-that-us-arms-congo-s-m23-rebels/7510198.html',other_relevant_results:['https://www.voanews.com/a/republic-of-congo-s-traditional-fish-smoking-threatens-forests/7439641.html','https://www.voanews.com/a/un-says-floods-in-republic-of-congo-leave-350-000-in-need/7447183.html','https://www.voanews.com/a/eastern-drc-hopes-for-peace-during-tshisekedi-s-second-term/7440503.html','https://www.voanews.com/a/uncertainties-remain-with-renegotiated-chinese-mining-deal-in-drc-/7458908.html','https://www.voanews.com/a/mini-summit-discusses-peace-efforts-for-east-democratic-republic-of-congo-/7491551.html','https://www.voanews.com/amp/dr-congo-facing-alarming-levels-of-violence-hunger-poverty-disease-/7539028.html'],note:'Other results were already requested, outside Q1, wire-attributed, video-only or Congo-Brazzaville; no observed search absence interpreted as a negative event.'},limitations:['This is analysis/fact-check journalism, not independently verified field reporting.','Source claim-review verdict is retained only as source metadata; dataset event labels remain null.','Current historical text is not authenticated publication-time content.','An existing excluded cache entry was recovered; this is not a newly discovered independent story. Original candidate files and frozen samples are untouched.']},null,2));
 console.log(JSON.stringify(unique.map(r=>({id:r.news_id,title:r.title,date:r.published_date,authors:r.authors,status:r.full_text_status,reason:r.exclusion_reason,chars:r.text.length}))));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();

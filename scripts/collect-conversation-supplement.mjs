import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {plain} from './collect-voa.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const OUT=path.join(ROOT,'local-data/expansion/2026-11-04');
const hash=s=>createHash('sha256').update(s).digest('hex');
// Discovered using neutral Congo/Congolese/DRC/Rwanda plus fixed calendar months.
// Exact-title followups verify origin/date only; inaccessible domains are not retried through alternate routes.
export const SOURCES=[
 {url:'https://www.wits.ac.za/news/latest-news/opinion/2024/2024-11/war-and-the-supernatural-in-congo.html',container:'news-fulltext',tag:'article',republication_date:'2024-11-06',original_date:null},
 {url:'https://theafricanmirror.africa/thought-leadership/rwandan-backed-m23-rebel-group-seeks-local-power-in-drc-not-just-control-over-mining-operations-2/',container:'entry-content',tag:'div',republication_date:'2025-01-29',original_date:'2024-10-24',date_evidence:'https://www.ecoi.net/en/file/local/2121008/2024_12_The_Democratic_Republic_of_the_Congo_DRC_Goma.pdf',date_evidence_note:'Irish Refugee Documentation Centre country information report, 27 Dec 2024, page 1 footnote 1 explicitly cites Conversation 24 October 2024 and matching title.'},
 {url:'https://www.ein.org.uk/blog/even-many-critics-rwanda-deportation-policy-are-missing-point-why-its-wrong',container:'blog__body',tag:'div',republication_date:'2024-02-06',original_date:'2024-02-05',date_evidence:'https://seapn.org.uk/wp-content/uploads/Networkebulletin-no-393.pdf',date_evidence_note:'Network e-bulletin 393, page 5, cites The Conversation 5 Feb 2024 and original article ID 221425.'},
 {url:'https://www.ein.org.uk/blog/rwanda-asylum-deportation-plan-faces-more-delays-how-did-we-get-here',container:'blog__body',tag:'div',republication_date:'2024-03-22',original_date:null},
 {url:'https://www.thenewworld.co.uk/the-governments-rwanda-plan-is-not-deterring-refugees-from-coming-to-the-uk/',container:'entry-content',tag:'div',republication_date:'2024-03-24',original_date:'2024-03-21',date_evidence:'https://researchbriefings.files.parliament.uk/documents/CBP-10185/CBP-10185.pdf',date_evidence_note:'UK Parliament research briefing, page 14 footnote 56, identifies Sophie Watt, The Conversation, 21 March 2024 and original title.'},
];
export function containerHtml(html,tag,token){
 const pattern=new RegExp(`<${tag}\\b[^>]*class=["'][^"']*\\b${token}\\b[^"']*["'][^>]*>`,'i'),m=pattern.exec(html);if(!m)return '';
 const rest=html.slice(m.index+m[0].length);let depth=1;for(const t of rest.matchAll(new RegExp(`<\\/?${tag}\\b[^>]*>`,'gi'))){depth+=/^<\//.test(t[0])?-1:1;if(depth===0)return rest.slice(0,t.index);}return '';
}
export function parseReprint(html,spec,retrievedAt){
 const full=containerHtml(html,spec.tag,spec.container);
 const sourceMatch=[...html.matchAll(/<a\b[^>]*href=["'](https:\/\/theconversation\.com\/[^"']+)["'][^>]*>\s*(?:<[^>]+>\s*)*original article/gi)].at(-1);
 const origin=sourceMatch?.[1]||null;
 const authorMatches=[...html.matchAll(/<a\b[^>]*href=["'](https:\/\/theconversation\.com\/profiles\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
 const authorMap=new Map(authorMatches.map(m=>[m[1],plain(m[2])]));
 const withoutMedia=full.replace(/<(?:figure|script|style)\b[\s\S]*?<\/(?:figure|script|style)>/gi,'').replace(/<img\b[^>]*>/gi,'');
 const blocks=[...withoutMedia.matchAll(/<(p|h[2-6]|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(m=>plain(m[2])).filter(Boolean);
 const text=blocks.join('\n\n');
 const title=plain(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||'');
 const attribution=/republished from[\s\S]{0,200}The Conversation[\s\S]{0,100}Creative Commons license/i.test(html);
 // Do not silently assert CC BY-ND 4.0 when only unspecified Creative Commons text is accessible.
 const exactLicense=html.match(/https?:\/\/creativecommons\.org\/licenses\/by-nd\/4\.0\/?/i)?.[0]||null;
 const reason=!origin?'missing_original_article_link':!attribution?'missing_republication_permission':!text||text.length<400?'missing_full_body':!authorMap.size?'missing_named_authors':!spec.original_date?'original_publication_date_unverified':!exactLicense?'specific_license_version_unverified':null;
 const windowIds=spec.original_date?(spec.original_date>='2024-01-01'&&spec.original_date<='2024-03-31'?['calendar-S017']:spec.original_date>='2024-10-23'&&spec.original_date<='2025-01-22'?['cross-S017']:[]):[];
 return {news_id:'TC-'+(origin?.match(/-(\d+)$/)?.[1]||hash(spec.url).slice(0,12)),publisher:'The Conversation',editorial_origin:'The Conversation',source_type:'academic_analysis',genre:'analysis',canonical_url:origin||spec.url,retrieval_url:spec.url,title,text,article_html:withoutMedia,published_date:spec.original_date,original_publication_date_verified:Boolean(spec.original_date),publication_date_evidence_url:spec.date_evidence||null,publication_date_evidence_note:spec.date_evidence_note||null,republication_date:spec.republication_date,authors:[...authorMap.values()],author_urls:[...authorMap.keys()],license:exactLicense?'CC BY-ND 4.0':'Creative Commons (specific version unverified)',license_url:exactLicense||'https://theconversation.com/republishing-guidelines',license_source_url:spec.url,license_version_verified:Boolean(exactLicense),retrieved_at:retrievedAt,source_modified_at:null,window_ids:windowIds,query_terms:['Congo','Congolese','DRC','Rwanda'],content_sha256:text?hash(text):null,full_text_status:reason?'excluded':'available',exclusion_reason:reason,source_links:[...new Set([...full.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map(m=>m[1]))],labels:null,review_status:'pending',historical_snapshot_verified:false};
}
async function main(){
 const dir=path.join(OUT,'conversation-supplement-cache');await fs.mkdir(dir,{recursive:true});const rows=[],requests=[];
 for(const spec of SOURCES){const file=path.join(dir,hash(spec.url)+'.html');try{let html,at;try{html=await fs.readFile(file,'utf8');at=(await fs.stat(file)).mtime.toISOString();requests.push({url:spec.url,status:'cached'});}catch{const response=await fetch(spec.url,{signal:AbortSignal.timeout(20000)});requests.push({url:spec.url,http_status:response.status});if(!response.ok)throw Error('HTTP '+response.status);html=await response.text();at=new Date().toISOString();await fs.writeFile(file,html);}rows.push(parseReprint(html,spec,at));}catch(e){rows.push({...parseReprint('',spec,new Date().toISOString()),exclusion_reason:'fetch_failed: '+e.message});}}
 await fs.writeFile(path.join(OUT,'conversation-supplement-candidates.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
 await fs.writeFile(path.join(OUT,'conversation-supplement-log.json'),JSON.stringify({created_at:new Date().toISOString(),requests,blocked_origins:[{domain:'theconversation.com',evidence:'web tool robots non-retryable refusal; no direct-fetch bypass attempted'},{domain:'modernghana.com',evidence:'HTTP 403 on two discovered reprints; stopped'}],official_policy_evidence:'https://cdn.theconversation.com/static_files/files/1797/The_Conversation_Global_Editorial_Guidelines_2021.pdf',policy_note:'Official editorial guidelines establish free Creative Commons republication, but the current official BY-ND terms could not be read. Article-level unspecified CC statements do not independently verify license version. Unverified original dates or exact licenses remain excluded.',search_basis:'Neutral Congo/Congolese/DRC/Rwanda with original window months; title followups solely for source/date verification. No event classification labels supplied.',rows:rows.map(r=>({id:r.news_id,title:r.title,status:r.full_text_status,reason:r.exclusion_reason,date:r.published_date,windows:r.window_ids,text_length:r.text.length}))},null,2));
 console.log(JSON.stringify(rows.map(r=>({id:r.news_id,status:r.full_text_status,reason:r.exclusion_reason,text_length:r.text.length}))));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();

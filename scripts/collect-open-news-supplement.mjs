// Reconstruct openly licensed African Arguments articles from preserved web.open full-page
// responses. Discovery is a finite search-index pool, NOT an exhaustive publisher archive.
// No network calls occur here; search queries and original responses are private cache files.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
export const LICENSE='CC BY-NC-SA 4.0';
export const LICENSE_SOURCE='https://africanarguments.org/write-for-us/';
export function plain(s){return s.replace(/【\d+†([^†】]+)(?:†[^】]*)?】/g,'$1').replace(/^#{1,6}\s+/,'').replace(/\u00a0/g,' ').trim();}
export function parseCachedPage(parts){
 const lines=new Map();
 for(const part of parts)for(const m of part.matchAll(/^L(\d+): ?(.*)$/gm)){
  const n=Number(m[1]);if(lines.has(n)&&lines.get(n)!==m[2])throw new Error(`Page changed between retrievals at line ${n}`);lines.set(n,m[2]);
 }
 const ids=[...lines.keys()].sort((a,b)=>a-b);
 const titleAt=ids.find(i=>/^# \S/.test(lines.get(i)));
 if(titleAt===undefined)return {reason:'full_article_heading_missing'};
 const byAt=ids.find(i=>i>titleAt&&/^By /.test(lines.get(i)));
 const dateAt=ids.find(i=>i>titleAt&&/^[A-Z][a-z]+ \d{1,2}, 20\d{2}$/.test(lines.get(i)));
 const endAt=ids.find(i=>i>(dateAt??titleAt)&&/^(?:Previous Article|Next Article|Tags|### 【\d+†Uncategorised)/.test(lines.get(i)));
 const title=plain(lines.get(titleAt)),authors=byAt===undefined?[]:[plain(lines.get(byAt)).replace(/^By /,'')];
 const parsedDate=dateAt===undefined?NaN:Date.parse(lines.get(dateAt)+' 00:00:00 GMT');
 const published_date=Number.isFinite(parsedDate)?new Date(parsedDate).toISOString().slice(0,10):null;
 if(!published_date||!authors.length)return {title,authors,published_date,reason:'date_or_author_missing'};
 if(endAt===undefined)return {title,authors,published_date,reason:'full_article_end_missing'};
 for(let i=titleAt;i<endAt;i++)if(!lines.has(i))return {title,authors,published_date,reason:'incomplete_page_lines'};
 const body=[];
 for(let i=dateAt+1;i<endAt;i++){
  const s=lines.get(i); if(!s.trim()||/^\d+$/.test(s.trim())||/【\d+†Image(?::|】)/.test(s))continue;
  // Preserve article prose; drop explicitly credited image captions, not paragraphs about photographs.
  if(/(?:Photo (?:credit|courtesy)|Credit:|Courtesy:|Photo:)/i.test(s))continue;
  body.push(plain(s));
 }
 const text=body.join('\n\n');
 const notice=text.match(/[^\n]*(?:originally published|republished|adapted version|reprinted|republishing)[^\n]*/gi)??[];
 const reason=text.length<500?'empty_or_media_only':notice.some(s=>!/(?:on|by) African Arguments\b/.test(s))?'third_party_republication_notice':null;
 return {title,authors,published_date,text,reason};
}
export function matchWindows(article,windows){
 if(!article.published_date)return [];
 const content=`${article.title}\n${article.text??''}`;
 return windows.filter(w=>article.published_date>=w.start&&article.published_date<=w.end&&w.terms.some(t=>new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'i').test(content)));
}
async function main(){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const dir=path.join(root,'local-data/expansion/2026-11-04'),cache=path.join(dir,'open-news-supplement-cache');
 const plan=JSON.parse(await fs.readFile(path.join(root,'research/data-expansion-plan.json'),'utf8'));
 const windows=plan.windows.filter(w=>/S017|S018/.test(w.id));
 const manifest=JSON.parse(await fs.readFile(path.join(cache,'manifest.json'),'utf8'));
 const policy=await fs.readFile(path.join(cache,'license-policy.txt'),'utf8');
 if(!policy.includes('Attribution-NonCommercial-ShareAlike 4.0'))throw new Error('Missing verified official license evidence');
 const records=[],details=[];
 for(const item of manifest){
  const parts=[await fs.readFile(path.join(cache,item.cache),'utf8')];
  try{parts.push(await fs.readFile(path.join(cache,item.cache.replace('.txt','-tail.txt')),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const article=parseCachedPage(parts),matched=matchWindows(article,windows);
  const reason=article.reason??(matched.length?null:'outside_fixed_windows_or_no_neutral_term');
  const text=reason?'':article.text;
  const record={news_id:'AA-'+sha(item.url).slice(0,16),publisher:'African Arguments',editorial_origin:'African Arguments',source_type:'editorial_analysis',canonical_url:item.url,title:article.title??'',text,published_date:article.published_date,authors:article.authors??[],author_urls:[],license:LICENSE,license_url:'https://creativecommons.org/licenses/by-nc-sa/4.0/',license_source_url:LICENSE_SOURCE,retrieved_at:item.retrieved_at,source_modified_at:null,window_ids:matched.map(w=>w.id),query_terms:[...new Set(matched.flatMap(w=>w.terms))],content_sha256:sha(text),full_text_status:reason?'excluded':'available',exclusion_reason:reason,genre:'mixed_reporting_commentary',source_links:[item.url]};
  record.author_verification={kind:'article_byline',source_url:item.url,display_names:record.authors};
  records.push(record);details.push({news_id:record.news_id,cache:item.cache,status:record.full_text_status,reason,body_chars:text.length});
 }
 records.sort((a,b)=>a.canonical_url.localeCompare(b.canonical_url));
 await fs.writeFile(path.join(dir,'open-news-supplement-candidates.jsonl'),records.map(r=>JSON.stringify(r)).join('\n')+'\n');
 const log={source:'African Arguments',license:LICENSE,license_source_url:LICENSE_SOURCE,license_conditions:['Noncommercial use only; not public domain.','Attribute authors and African Arguments with link to original.','Preserve original prose; share-alike applies.','Public republication is not authorized by this research export.'],method:'Fixed country/region terms and date windows in search-index queries; all returned 2024/2025 URLs in potentially applicable months were opened. Complete numbered article lines required; never use search snippets as full text.',limitations:['Publisher API and month archives returned HTTP 403. Search-index recall is incomplete.','Rendered full-page text is cached, not original HTML; link labels retained, unresolved target URLs not fabricated.','Publisher mixes reporting and expert analysis. No relevance or event gold labels assigned.','Discovery query terms do not establish dyad relevance; title/lead and human review still required.','Original publisher pages contain unrelated promotional footer links, excluded at explicit article boundary.'],rejected_sources:[{name:'IPS',url:'https://www.ipsnews.net/reprinting-articles/',reason:'Written permission required; no full text collected.'},{name:'The New Humanitarian',url:'https://www.thenewhumanitarian.org/republish',reason:'Article-specific republication HTML required; direct endpoint returned HTTP 403. Not counted as supplemental full text.'}],total:records.length,available:records.filter(r=>r.full_text_status==='available').length,windows:windows.map(w=>({id:w.id,available:records.filter(r=>r.full_text_status==='available'&&r.window_ids.includes(w.id)).length})),details};
 await fs.writeFile(path.join(dir,'open-news-supplement-collector-log.json'),JSON.stringify(log,null,2));console.log(JSON.stringify(log,null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e);process.exitCode=1;});

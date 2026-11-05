import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const dateValid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export function shingles(text){const words=text.toLowerCase().match(/[a-z0-9]+/g)||[];return new Set(words.slice(0,-4).map((_,i)=>words.slice(i,i+5).join(' ')));}
export function auditExpansion(rows){
 const errors=[],flags=[],duplicates=[],nearDuplicates=[];
 const add=(list,r,code,detail)=>list.push({pair_id:r.pair_id,code,detail});
 const seenIds=new Set(),byHash=new Map(),byUrl=new Map();
 for(const r of rows){const n=r.news||{},w=r.sampling_window||{};const text=n.text||'';
  if(seenIds.has(r.pair_id))add(errors,r,'duplicate_pair_id',r.pair_id);seenIds.add(r.pair_id);
  if(!dateValid(n.published_date)||n.published_date<w.start||n.published_date>w.end)add(errors,r,'invalid_or_out_of_window_date',n.published_date);
  if(sha(text)!==n.content_sha256)add(errors,r,'content_hash_mismatch',n.content_sha256);
  if(r.labels!==null||r.review_status!=='pending'||r.relevance_verified===true||r.negative_label_verified===true)add(flags,r,'review_state_requires_provenance','Audit never assigns or changes labels.');
  if(n.source_modified_at){const day=n.source_modified_at.slice(0,10);if(day>n.published_date)add(flags,r,'modified_after_publication',n.source_modified_at);if(day<n.published_date)add(flags,r,'modified_before_publication',n.source_modified_at);if(Boolean(r.modified_after_publication_day)!==(day>n.published_date))add(errors,r,'modified_flag_inconsistent',day);}
  if(!r.historical_snapshot_verified)add(flags,r,'historical_snapshot_unverified','Current retrieved text is not verified publication-day content.');
  for(const [key,map,value] of [['content',byHash,n.content_sha256],['url',byUrl,n.canonical_url]]){if(map.has(value))duplicates.push({kind:key,pair_ids:[map.get(value),r.pair_id],value});else map.set(value,r.pair_id);}
  if(!n.title?.trim()||text.length<200)add(errors,r,'empty_or_short_content',{chars:text.length});
  const bad=text.match(/\uFFFD|[\u0000-\u0008\u000B\u000C\u000E-\u001F]|Ã.|Â |â€|<\/?(?:script|iframe|div|p)\b|&(?:nbsp|amp|quot);/g);
  if(bad)add(flags,r,'encoding_or_markup_candidate',bad.slice(0,8));
  const origin=text.match(/.{0,80}(?:originally (?:co[- ]?)?published|co[- ]published|republished|reprinted|reproduced|adapted from|translated from|courtesy of|Reuters contributed|Associated Press contributed).{0,180}/gi);
  if(origin)add(flags,r,'origin_statement_needs_review',origin.slice(0,5));
  if(n.byline_status==='unsigned'||n.origin_verification==='publisher_attribution_only')add(flags,r,'unsigned_publisher_origin_needs_review','Publisher attribution and article license are recorded; individual authorship and independent factual origin are not verified.');
  if(n.reuse_caveat)add(flags,r,'source_reuse_caveat',n.reuse_caveat);
  if(n.source_type==='think_tank_analysis')add(flags,r,'analysis_not_field_reporting','Separate institutional analysis from news reporting in future evaluations.');
  const terms=r.sampling_aliases||w.terms||[];const re=new RegExp('\\b(?:'+terms.map(escape).join('|')+')\\b','i');
  const hitParas=text.split(/\n+/).filter(p=>re.test(p));
  if(!re.test(n.title||''))add(flags,r,'case_term_absent_from_title',{title:n.title,matching_paragraphs:hitParas.length,first_context:hitParas[0]?.slice(0,500)||null});
  if(!hitParas.length&&!re.test(n.title||''))add(flags,r,'no_case_term_in_title_or_body',terms);
  if(/\b(?:dans|pour|avec|mais|leur|nous|vous)\b/i.test(text)&&/(?:é|è|à|ç)/i.test(text))add(flags,r,'possible_multilingual_quote','French-language heuristic; proper names and translated quotes can legitimately trigger it.');
 }
 const unique=[...new Map(rows.map(r=>[r.news.content_sha256,r])).values()];const sets=unique.map(r=>shingles(r.news.text));
 for(let i=0;i<unique.length;i++)for(let j=i+1;j<unique.length;j++){const a=sets[i],b=sets[j];if(Math.min(a.size,b.size)<40)continue;let common=0;for(const x of a)if(b.has(x))common++;const containment=common/Math.min(a.size,b.size),jaccard=common/(a.size+b.size-common);if(containment>=0.65||jaccard>=0.5)nearDuplicates.push({pair_ids:[unique[i].pair_id,unique[j].pair_id],containment,jaccard});}
 const counts={};for(const f of flags)counts[f.code]=(counts[f.code]||0)+1;
 return {audit_kind:'mechanical_screening_not_human_annotation',rows:rows.length,unique_urls:byUrl.size,unique_content_hashes:byHash.size,errors,flag_counts:counts,flags,duplicates,near_duplicates:nearDuplicates,limitations:['Flags are review candidates, not truth labels or automatic exclusions.','No web snapshot/date/origin verification performed.','Lexical relevance cannot establish actor relationships or scope.','Near-duplicate comparison is within this file only; rewritten syndication may escape it.','Language heuristic does not validate English quality.']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const filename=process.argv[2];if(!filename)throw Error('Usage: node scripts/audit-expansion.mjs <samples.jsonl>');
 const input=fs.readFileSync(filename);const rows=input.toString('utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
 console.log(JSON.stringify({input_sha256:sha(input),...auditExpansion(rows)},null,2));
}

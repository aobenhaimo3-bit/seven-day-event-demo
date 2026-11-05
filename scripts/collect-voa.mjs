import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'local-data/expansion/2026-11-04');
const hash = value => createHash('sha256').update(value).digest('hex');
export function plain(html) {
  return html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1),16) : Number(n))).replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, s => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '})[s]).replace(/\s+/g,' ').trim();
}
function bodyContainer(html) {
  const start = /<div\b[^>]*class=["'][^"']*\bwsw\b[^"']*["'][^>]*>/i.exec(html);
  if (!start) return '';
  const rest = html.slice(start.index + start[0].length);
  let depth = 1;
  for (const m of rest.matchAll(/<\/?div\b[^>]*>/gi)) {
    depth += /^<\//.test(m[0]) ? -1 : 1;
    if (!depth) return rest.slice(0,m.index);
  }
  return '';
}
export function parseArticle(html, url, retrievedAt) {
  const nodes = [];
  function walk(v) { if (!v || typeof v !== 'object') return; if (Array.isArray(v)) return v.forEach(walk); nodes.push(v); if(v['@graph']) walk(v['@graph']); }
  for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { try {walk(JSON.parse(m[1]));} catch {} }
  const ld = nodes.find(x=>[].concat(x['@type'] || []).includes('NewsArticle')) || {};
  const authors = [].concat(ld.author || []).map(x=>typeof x === 'string' ? {name:x} : x);
  const body = bodyContainer(html);
  const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m=>plain(m[1])).filter(x=>x&&!/^(?:Share|Print)$/.test(x));
  const text = paragraphs.join('\n\n');
  const date = ld.datePublished ? new Date(ld.datePublished) : null;
  const wireAuthor = /\b(?:Reuters|Associated Press|Agence France|AFP|AP)\b/i.test(authors.map(x=>x.name).join(' '));
  const wireContribution = /(?:\b(?:Reuters|Associated Press|Agence France[- ]Presse|AFP)\b.{0,100}\b(?:contribut|report|provid)|\b(?:report|information|material|compiled|adapted)\w*\b.{0,100}\b(?:Reuters|Associated Press|Agence France[- ]Presse|AFP)\b)/i.test(text);
  const knownAuthor = authors.length && authors.every(x=>x.name && /^https:\/\/(?:www\.)?voanews\.com\/author\//.test(x.url || ''));
  let reason = !ld.headline ? 'missing_newsarticle_metadata' : !date || !Number.isFinite(+date) ? 'missing_valid_publication_date' : wireAuthor ? 'wire_agency_byline' : !knownAuthor ? 'unverified_original_author' : wireContribution ? 'wire_agency_contribution' : /content_type:\s*"(?:video|audio)"/.test(html) ? 'non_text_media' : text.length < 400 ? 'missing_or_short_article_body' : null;
  const canonical = ld.url || ld.mainEntityOfPage?.['@id'] || (typeof ld.mainEntityOfPage === 'string' ? ld.mainEntityOfPage : url);
  return {news_id:'VOA-'+(url.match(/\/(\d+)\.html/)?.[1] || hash(url).slice(0,16)),publisher:'Voice of America',editorial_origin:'Voice of America',canonical_url:canonical,title:plain(ld.headline || ''),text:reason ? '' : text,published_date:date && Number.isFinite(+date) ? date.toISOString().slice(0,10) : null,authors:authors.map(x=>x.name).filter(Boolean),author_urls:authors.map(x=>x.url).filter(Boolean),license:'Public domain (VOA original text)',license_url:'https://www.voanews.com/p/5338.html',license_source_url:'https://www.voanews.com/p/5338.html',retrieved_at:retrievedAt,source_modified_at:ld.dateModified || null,window_ids:[],query_terms:[],content_sha256:reason ? null : hash(text),full_text_status:reason ? 'excluded':'available',exclusion_reason:reason,genre:'news_reporting',source_links:[...body.matchAll(/href=["'](https?:\/\/[^"']+)["']/g)].map(x=>x[1])};
}
export function monthSample(items, limit, seed) {
  const groups = new Map();
  for(const item of items) {const month=item.lastmod.slice(0,7); if(!groups.has(month)) groups.set(month,[]); groups.get(month).push(item);}
  for(const a of groups.values()) a.sort((a,b)=>hash(seed+'|'+a.url).localeCompare(hash(seed+'|'+b.url)));
  const months=[...groups.keys()].sort(), result=[];
  while(result.length<limit) {let added=false; for(const m of months) {const v=groups.get(m).shift(); if(v) {result.push(v);added=true;} if(result.length===limit)break;} if(!added)break;}
  return result;
}
async function main() {
  const plan=JSON.parse(await fs.readFile(path.join(ROOT,'research/data-expansion-plan.json'),'utf8'));
  await fs.mkdir(path.join(OUT,'voa-cache'),{recursive:true});
  const logs=[];
  async function get(url) {
    const filename=path.join(OUT,'voa-cache',hash(url)+'.txt');
    try {const text=await fs.readFile(filename,'utf8');logs.push({url,status:'cache_hit',original_retrieval_at:(await fs.stat(filename)).mtime.toISOString()});return text;}catch{}
    for(let attempt=1;attempt<=3;attempt++) {try {const response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('HTTP '+response.status);const bytes=Buffer.from(await response.arrayBuffer());const text=(bytes[0]===31&&bytes[1]===139?gunzipSync(bytes):bytes).toString();await fs.writeFile(filename,text);logs.push({url,status:'fetched',attempt,at:new Date().toISOString()});return text;}catch(e){logs.push({url,status:'failed',attempt,error:e.message});if(attempt===3)throw e;await new Promise(r=>setTimeout(r,300*attempt));}}
  }
  // Fixed discovery extent: first six sitemap shards, neutral URL terms and lastmod only.
  const pool=new Map();
  for(let n=1;n<=6;n++) {const url=`https://www.voanews.com/sitemap_415_${n}.xml.gz`;try {const xml=await get(url);for(const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)){const u=m[1].match(/<loc>(.*?)<\/loc>/)?.[1];const lastmod=m[1].match(/<lastmod>(.*?)<\/lastmod>/)?.[1];if(u&&lastmod&&/\/a\/[^/]+\/\d+\.html/.test(u))pool.set(u,{url:u,lastmod});}}catch(e){console.log('Sitemap failed',n,e.message);}}
  const chosen=new Map(), discovery=[];
  for(const window of plan.windows){const candidates=[...pool.values()].filter(item=>item.lastmod.slice(0,10)>=window.start&&item.lastmod.slice(0,10)<=window.end&&window.terms.some(term=>item.url.toLowerCase().includes(term.toLowerCase().replaceAll(' ','-'))));const selected=monthSample(candidates,30,plan.seed+'|'+window.id+'|Voice of America');discovery.push({window_id:window.id,candidate_count:candidates.length,selected_count:selected.length});for(const item of selected){if(!chosen.has(item.url))chosen.set(item.url,{...item,windows:[]});chosen.get(item.url).windows.push(window);}}
  const queue=[...chosen.values()], records=[];
  async function worker(){while(queue.length){const item=queue.shift();try{const html=await get(item.url);const retrievedAt=(await fs.stat(path.join(OUT,'voa-cache',hash(item.url)+'.txt'))).mtime.toISOString();const record=parseArticle(html,item.url,retrievedAt);record.window_ids=item.windows.filter(w=>record.published_date>=w.start&&record.published_date<=w.end).map(w=>w.id);record.query_terms=[...new Set(item.windows.flatMap(w=>w.terms.filter(term=>item.url.toLowerCase().includes(term.toLowerCase().replaceAll(' ','-')))))];record.discovery_window_ids=item.windows.map(w=>w.id);record.discovery_lastmod=item.lastmod;if(!record.window_ids.length){record.full_text_status='excluded';record.exclusion_reason='publication_date_outside_discovery_windows';record.text='';record.content_sha256=null;}records.push(record);}catch(e){records.push({...parseArticle('',item.url,new Date().toISOString()),discovery_window_ids:item.windows.map(w=>w.id),exclusion_reason:'fetch_failed: '+e.message});}console.log('VOA progress',records.length,'/',chosen.size);}}
  await Promise.all([worker(),worker(),worker()]);records.sort((a,b)=>a.canonical_url.localeCompare(b.canonical_url));
  await fs.writeFile(path.join(OUT,'voa-candidates.jsonl'),records.map(x=>JSON.stringify(x)).join('\n')+'\n');
  await fs.writeFile(path.join(OUT,'voa-collection-log.json'),JSON.stringify({created_at:new Date().toISOString(),policy:'Fixed shards 1-6; neutral URL terms; lastmod discovery only; 30 per window balanced by discovery month and seeded SHA. This is not an exhaustive publication-date archive. Article publication dates independently verified. No event labels inferred.',discovery,counts:plan.windows.map(w=>({window_id:w.id,available:records.filter(r=>r.window_ids.includes(w.id)&&r.full_text_status==='available').length,target:8})),requests:logs},null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();

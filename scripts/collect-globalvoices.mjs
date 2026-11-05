import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
export function decodeHtml(s) {
  const entities = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',rsquo:'’',lsquo:'‘',ldquo:'“',rdquo:'”',ndash:'–',mdash:'—',hellip:'…',copy:'©',eacute:'é'};
  return s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if(e[0] !== '#') return entities[e] ?? all;
    const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2),16) : Number(e.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
  });
}
// Token stack preserves nested paragraph text while excluding entire caption/media subtrees.
export function extractArticle(html) {
  const stack = [], out = [], links = [];
  const voids = new Set(['img','br','hr','source','track','input','meta','link','wbr','area','base','embed']);
  for (const tok of html.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g) ?? []) {
    if (tok.startsWith('<!--')) continue;
    if (!tok.startsWith('<')) { if (!stack.some(x=>x.skip)) out.push(decodeHtml(tok)); continue; }
    const match = tok.match(/^<\s*(\/?)\s*([\w-]+)/); if (!match) continue;
    const [,closing,raw] = match, tag = raw.toLowerCase();
    if(closing) { const i=stack.findLastIndex(x=>x.tag===tag); if(i>=0) stack.splice(i); if(/^(p|div|li|h[1-6]|blockquote|tr)$/.test(tag)) out.push('\n\n'); continue; }
    const skip = stack.some(x=>x.skip) || /^(script|style|figure|figcaption|iframe|video|audio|object|embed|noscript|svg)$/.test(tag) || /class\s*=\s*["'][^"']*(?:wp-caption|wp-block-embed|twitter-tweet|instagram-media|fb-post)[^"']*["']/i.test(tok);
    if(!skip && tag==='a') { const href=tok.match(/href\s*=\s*["']([^"']+)["']/i)?.[1]; if(href && /^https?:\/\//i.test(href)) links.push(decodeHtml(href)); }
    if(!skip && tag==='br') out.push('\n');
    if(!voids.has(tag) && !/\/\s*>$/.test(tok)) stack.push({tag,skip});
  }
  return {text:out.join('').replace(/[\t \r\u00a0]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim(),source_links:[...new Set(links)]};
}
export function exclusionReason(text, url) {
  if(!text.trim()) return 'empty_body';
  if(new URL(url).hostname !== 'globalvoices.org') return 'non_english_site';
  if(/(?:content[ -](?:sharing|partnership) (?:agreement|partnership)|content sharing partnership|media partnership agreement|reproduced (?:here )?with permission)/i.test(text)) return 'third_party_republication_notice';
  if(/\b(?:article|story|post|report)\b[^\n]{0,240}\bwith permission from\s+(?!Global Voices\b)/i.test(text)) return 'third_party_republication_notice';
  if(/\b(?:article|story|post|report)\b[^\n]{0,160}\bcourtesy of\b/i.test(text)) return 'third_party_republication_notice';
  const notice = text.match(/[^\n]*(?:(?:originally|initially|first)\s+(?:published|appeared)|republish(?:ed|ing)|reprint(?:ed|ing)|reproduced with permission)[^\n]*/gi) ?? [];
  if(notice.some(s=> {
    const trigger=s.search(/(?:originally|initially|first)\s+(?:published|appeared)|republish(?:ed|ing)|reprint(?:ed|ing)|reproduced with permission/i);
    const attributed=/\b(?:article|post|story|report|version)\b/i.test(s.slice(0,trigger)) || /republish(?:ed|ing)|reprint(?:ed|ing)|reproduced with permission/i.test(s);
    return attributed && (!/(?:on|by|in|at) Global Voices\b/i.test(s) || /(?:originally|initially|first)\s+(?:published|appeared)\s+(?:in|by|on|at)\s+(?!Global Voices\b)/i.test(s));
  })) return 'third_party_republication_notice';
  if(/all rights reserved|not (?:covered|available) (?:by|under) (?:the )?creative commons/i.test(text)) return 'license_exception_needs_review';
  const words=text.toLowerCase().match(/[a-z]+/g) ?? [];
  const en=words.filter(w=>/^(the|and|of|to|in|is|that|for|on|with|was|as|are|by|from|this|it|has|have)$/.test(w)).length;
  if(words.length<30 || en/words.length<0.06) return 'language_or_text_length_needs_review';
  return null;
}
export function extractAuthors(html) {
  const header=html.split(/id=['"]post-header-credit['"]/i)[1]?.split(/class=['"]post-translations/i)[0] ?? '';
  const names=[],urls=[];
  for(const m of header.matchAll(/<div\b[^>]*class=['"](?:contributor-name|text-credits-section)['"][^>]*>([\s\S]*?)<\/div>/gi)) {
    if(!/Written(?:\s*\([^)]*\))?\s+by/i.test(m[1])) continue;
    for(const a of m[1].matchAll(/<a\b[^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi)) {
      const name=extractArticle(a[2]).text;
      if(name && !urls.includes(a[1])) {names.push(name);urls.push(decodeHtml(a[1]));}
    }
  }
  return {names,urls};
}
export function queryUrl(window, term, page=1) {
  const end = new Date(`${window.end}T00:00:00Z`); end.setUTCDate(end.getUTCDate()+1);
  // WP after/before are exclusive. Start one second earlier, then filter local publication dates below.
  const start=new Date(`${window.start}T00:00:00Z`); start.setUTCSeconds(-1);
  const params=new URLSearchParams({search:term,after:start.toISOString().slice(0,19),before:end.toISOString().slice(0,19),per_page:'100',page:String(page),orderby:'id',order:'asc',_fields:'id,date,date_gmt,modified,modified_gmt,link,title,content,author'});
  return `https://globalvoices.org/wp-json/wp/v2/posts?${params}`;
}
async function main() {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const plan=JSON.parse(await fs.readFile(path.join(root,'research/data-expansion-plan.json'),'utf8'));
  const dir=path.join(root,'local-data/expansion/2026-11-04'), cache=path.join(dir,'globalvoices-cache');
  await fs.mkdir(cache,{recursive:true});
  const logs=[];
  async function get(url) {
    const key=hash(url), bodyPath=path.join(cache,key+'.body'), metaPath=path.join(cache,key+'.json');
    try { const meta=JSON.parse(await fs.readFile(metaPath,'utf8')); if(meta.status===200) return {...meta,body:await fs.readFile(bodyPath,'utf8')}; } catch {}
    if(process.argv.includes('--cache-only')) throw new Error(`Missing successful cache for ${url}`);
    for(let attempt=1;attempt<=3;attempt++) {
      try {
        const {stdout}=await run(process.platform==='win32'?'curl.exe':'curl',['--location','--max-time','25','--silent','--show-error','--dump-header',path.join(cache,key+'.headers'),url],{maxBuffer:30*1024*1024,encoding:'utf8'});
        const headers=await fs.readFile(path.join(cache,key+'.headers'),'utf8');
        const status=Number([...headers.matchAll(/HTTP\/\S+ (\d+)/g)].at(-1)?.[1]);
        const meta={url,status,retrieved_at:new Date().toISOString(),total_pages:Number(headers.match(/x-wp-totalpages:\s*(\d+)/i)?.[1]??0)};
        await fs.writeFile(bodyPath,stdout); await fs.writeFile(metaPath,JSON.stringify(meta,null,2));
        if(status!==200) throw new Error(`HTTP ${status}`);
        return {...meta,body:stdout};
      } catch(e) { logs.push({url,attempt,error:e.message}); if(attempt===3) throw e; await new Promise(r=>setTimeout(r,attempt*400)); }
    }
  }
  const candidates=new Map();
  for(const w of plan.windows) for(const term of w.terms) {
    let page=1,total=1,count=0;
    do {
      const response=await get(queryUrl(w,term,page)); const posts=JSON.parse(response.body);
      if(!Array.isArray(posts)) throw new Error('Unexpected API response');
      total=response.total_pages || (posts.length===100?page+1:page);
      for(const post of posts) {
        const date=post.date.slice(0,10); if(date<w.start || date>w.end) continue;
        count++;
        if(!candidates.has(post.id)) candidates.set(post.id,{post,at:response.retrieved_at,windows:new Set(),terms:new Set()});
        candidates.get(post.id).windows.add(w.id); candidates.get(post.id).terms.add(term);
      }
      page++;
    } while(page<=total);
    logs.push({window_id:w.id,term,pages:page-1,matched:count});
    await fs.writeFile(path.join(dir,'globalvoices-collector-log.json'),JSON.stringify(logs,null,2));
    console.log(`${w.id} ${term}: ${count}`);
  }
  const records=[], queue=[...candidates.values()];
  async function processArticle({post,at,windows,terms}) {
    let author={names:[],urls:[]};
    // Public users API requires authentication; public article headers preserve coauthor attribution.
    try {author=extractAuthors((await get(post.link)).body);} catch(e) {logs.push({news_id:post.id,author_error:e.message});}
    const extracted=extractArticle(post.content.rendered); let reason=exclusionReason(extracted.text,post.link);
    if(!author.names.length) reason ??= 'author_attribution_missing';
    records.push({news_id:`GV-${post.id}`,publisher:'Global Voices',editorial_origin:'Global Voices',canonical_url:post.link,title:extractArticle(post.title.rendered).text,text:reason?'':extracted.text,published_date:post.date.slice(0,10),authors:author.names,author_urls:author.urls,license:'CC BY 3.0',license_url:'https://creativecommons.org/licenses/by/3.0/',license_source_url:'https://globalvoices.org/about/global-voices-attribution-policy/',retrieved_at:at,source_modified_at:post.modified_gmt?post.modified_gmt+'Z':post.modified,window_ids:[...windows].sort(),query_terms:[...terms].sort(),content_sha256:hash(reason?'':extracted.text),full_text_status:reason?'excluded':'available',exclusion_reason:reason,genre:'mixed_reporting_commentary',source_links:extracted.source_links});
  }
  await Promise.all(Array.from({length:4},async()=>{while(queue.length){await processArticle(queue.shift()); if(records.length%40===0) console.log(`Author headers: ${records.length}/${candidates.size}`);}}));
  records.sort((a,b)=>a.news_id.localeCompare(b.news_id));
  await fs.writeFile(path.join(dir,'globalvoices-candidates.jsonl'),records.map(r=>JSON.stringify(r)).join('\n')+'\n');
  const summary={unique:records.length,available:records.filter(r=>r.full_text_status==='available').length,windows:plan.windows.map(w=>({id:w.id,candidates:records.filter(r=>r.window_ids.includes(w.id)).length,available:records.filter(r=>r.window_ids.includes(w.id)&&r.full_text_status==='available').length})),exclusions:records.filter(r=>r.exclusion_reason).map(r=>({id:r.news_id,reason:r.exclusion_reason}))};
  logs.push({summary}); await fs.writeFile(path.join(dir,'globalvoices-collector-log.json'),JSON.stringify(logs,null,2)); console.log(JSON.stringify(summary,null,2));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(e=>{console.error(e);process.exitCode=1;});

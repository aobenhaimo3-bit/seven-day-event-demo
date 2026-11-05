import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {EXPANSION_ROOT,sha256,sourceAuthorized,assertFrozenSamplesUnchanged} from './prepare-expansion.mjs';
import {auditExpansion,shingles} from './audit-expansion.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const norm=s=>String(s).normalize('NFKC').replace(/\s+/gu,' ').trim().toLowerCase();
const read=f=>fs.readFileSync(f,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dayValid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const host=u=>{try{return new URL(u).hostname.replace(/^www\./,'');}catch{return '';}};
export function neutralFocus(n,w,plan){
  const titleOnly=plan.title_focus_cases?.includes(w.reference_case);
  const value=norm(`${n.title||''} ${titleOnly?'':String(n.text||'').slice(0,800)}`).replace(/[-_]/g,' ');
  const context=norm(`${n.title||''} ${String(n.text||'').slice(0,800)}`);
  if(plan.required_context_terms?.[w.reference_case]&&!plan.required_context_terms[w.reference_case].some(t=>new RegExp('(?<![a-z])'+norm(t).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![a-z])','i').test(context)))return false;
  if(w.reference_case==='S018'&&!/\b(?:Yemen|Yemeni|Houthis?|Aden|Hodeidah|Sanaa)\b/i.test(`${n.title||''} ${n.text||''}`))return false;
  return (plan.terms[w.reference_case]||w.terms).some(t=>new RegExp('(?<![a-z])'+norm(t).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![a-z])','i').test(value));
}
export function authorizedSupplement(n){
  if(['Global Voices','Voice of America'].includes(n.publisher))return sourceAuthorized(n)
    &&host(n.canonical_url)===(n.publisher==='Global Voices'?'globalvoices.org':'voanews.com');
  if(!Array.isArray(n.authors)||!n.authors.length||n.authors.some(a=>/\b(?:Reuters|Associated Press|Agence France|Anadolu|AFP|AP)\b/i.test(a)))return false;
  const byline=n.author_verification?.source_url===n.canonical_url
    &&JSON.stringify(n.author_verification?.display_names)===JSON.stringify(n.authors)
    &&['article_byline','visible_article_byline','publisher_unsigned_byline'].includes(n.author_verification?.kind);
  if(!n.author_urls?.length&&!byline)return false;
  if(n.publisher==='ISS Today')return n.editorial_origin==='Institute for Security Studies'
    &&host(n.canonical_url)==='issafrica.org'&&n.license_url==='https://creativecommons.org/licenses/by/4.0/'
    &&n.license_source_url==='https://issafrica.org/terms-of-use'&&n.source_type==='think_tank_analysis'
    &&Boolean(n.reuse_caveat);
  const mongabayJoint=n.publisher==='Mongabay'&&n.editorial_origin==='Mongabay / Environmental Reporting Collective'
    &&n.collaborating_sources?.some(s=>s==='Environmental Reporting Collective'||s.name==='Environmental Reporting Collective'&&s.evidence_url===n.canonical_url);
  if(n.editorial_origin!==n.publisher&&!mongabayJoint)return false;
  if(n.publisher==='GroundUp')return host(n.canonical_url)==='groundup.org.za'
    &&n.license==='CC BY-ND 4.0'&&n.license_url==='https://creativecommons.org/licenses/by-nd/4.0/'
    &&n.license_source_url===n.canonical_url&&n.article_license_verified===true;
  if(n.publisher==='Mongabay')return host(n.canonical_url)==='news.mongabay.com'
    &&n.license==='CC BY-ND 4.0'&&n.license_url==='https://creativecommons.org/licenses/by-nd/4.0/'
    &&n.license_source_url==='https://news.mongabay.com/copyright/creative-commons/'&&Array.isArray(n.source_links);
  if(n.publisher==='Middle East Monitor')return host(n.canonical_url)==='middleeastmonitor.com'
    &&n.license==='CC BY-NC-SA 4.0'&&n.license_url==='https://creativecommons.org/licenses/by-nc-sa/4.0/'
    &&n.license_source_url===n.canonical_url&&n.article_license_verified===true&&byline;
  if(n.publisher==='African Arguments')return host(n.canonical_url)==='africanarguments.org'
    &&n.license==='CC BY-NC-SA 4.0'&&n.license_url==='https://creativecommons.org/licenses/by-nc-sa/4.0/'
    &&['https://africanarguments.org/write-for-us/','https://africanarguments.org/about-african-arguments/our-philosophy/'].includes(n.license_source_url);
  if(n.publisher==='Common Dreams')return host(n.canonical_url)==='commondreams.org'
    &&n.license==='CC BY-NC-ND 3.0 US'&&n.license_url==='https://creativecommons.org/licenses/by-nc-nd/3.0/us/'
    &&n.license_source_url==='https://www.commondreams.org/republish-our-work'
    &&Array.isArray(n.source_links);
  if(n.publisher==='The Conversation')return host(n.canonical_url)==='theconversation.com'
    &&n.license_url==='https://creativecommons.org/licenses/by-nd/4.0/'
    &&n.license_source_url==='https://theconversation.com/republishing-guidelines'
    &&n.original_publisher_verified===true;
  return false;
}
export function supplementEligible(n,w,plan){
 return !plan.screening_decisions?.some(d=>d.news_id===n.news_id&&d.window_id===w.id&&d.disposition==='exclude')
  &&plan.sources.includes(n.publisher)&&n.full_text_status==='available'&&typeof n.text==='string'&&n.text.trim().length>=400
  &&dayValid(n.published_date)&&n.published_date>=w.start&&n.published_date<=w.end
  &&n.window_ids?.includes(w.id)&&/^https:\/\//.test(n.canonical_url||'')
  &&n.authors?.every(a=>typeof a==='string'&&a.trim())&&n.retrieved_at
  &&n.content_sha256===sha256(n.text)&&neutralFocus(n,w,plan)&&authorizedSupplement(n);
}
export function nearDuplicate(a,b){
 if(Math.min(a.size,b.size)<40)return false;
 if(a.size>b.size)[a,b]=[b,a];
 // Jaccard >= .5 implies containment >= 2/3, so the .65 containment rule subsumes it.
 const threshold=Math.ceil(a.size*0.65);let shared=0,remaining=a.size;
 for(const word of a){remaining--;if(b.has(word))shared++;if(shared>=threshold)return true;if(shared+remaining<threshold)return false;}
 return false;
}
export function buildSupplement(base,candidates,originalPlan,plan,existing=[]){
 if(!Number.isInteger(plan.target_per_window)||plan.target_per_window<1)throw Error('Invalid per-window target');
 if(new Set(originalPlan.windows.map(w=>w.id)).size!==originalPlan.windows.length)throw Error('Duplicate sampling window');
 if(base.some(r=>!originalPlan.windows.some(w=>w.id===r.sampling_window.id)))throw Error('Base contains an unplanned window');
 const selected=[...base],rejected=[],coverage=[],candidateScreening=[];
 const usedUrls=new Set([...base.map(r=>r.news.canonical_url),...existing.map(r=>r.canonical_url||r.url)].filter(Boolean));
 const usedTexts=new Set([...base.map(r=>r.news.text),...existing.map(r=>r.text)].map(t=>sha256(norm(t))));
 const usedTitles=new Set([...base.map(r=>r.news.title),...existing.map(r=>r.title)].filter(Boolean).map(norm));
 const selectedSets=[...base.map(r=>r.news.text),...existing.map(r=>r.text)].filter(Boolean).map(shingles);
 const rank=(n,w)=>sha256(`${plan.seed}|${w.id}|${n.publisher}|${n.canonical_url}`);
 for(const w of originalPlan.windows){
  const inWindow=candidates.filter(n=>n.full_text_status==='available'&&dayValid(n.published_date)&&n.published_date>=w.start&&n.published_date<=w.end&&n.window_ids?.includes(w.id));
  candidateScreening.push({window_id:w.id,available_candidate_records:inWindow.length,neutral_focus_records:inWindow.filter(n=>neutralFocus(n,w,plan)).length,source_authorized_records:inWindow.filter(authorizedSupplement).length,eligible_records:inWindow.filter(n=>supplementEligible(n,w,plan)).length});
  let pool=candidates.filter(n=>supplementEligible(n,w,plan));
  const urls=new Map();
  for(const n of pool){const prior=urls.get(n.canonical_url);if(prior&&prior.content_sha256!==n.content_sha256)throw Error('Conflicting candidate snapshots: '+n.canonical_url);urls.set(n.canonical_url,n);}
  pool=[...urls.values()].sort((a,b)=>rank(a,w).localeCompare(rank(b,w)));
  const monthUses=new Map();const before=selected.filter(r=>r.sampling_window.id===w.id).length;
  while(selected.filter(r=>r.sampling_window.id===w.id).length<plan.target_per_window&&pool.length){
   const counts=p=>selected.filter(r=>r.sampling_window.id===w.id&&r.news.publisher===p).length;
   pool.sort((a,b)=>counts(a.publisher)-counts(b.publisher)||(monthUses.get(a.publisher+'|'+a.published_date.slice(0,7))||0)-(monthUses.get(b.publisher+'|'+b.published_date.slice(0,7))||0)||a.published_date.slice(0,7).localeCompare(b.published_date.slice(0,7))||rank(a,w).localeCompare(rank(b,w)));
   const n=pool.shift(),key=sha256(norm(n.text)),set=shingles(n.text);
   const reason=usedUrls.has(n.canonical_url)?'existing_url':usedTexts.has(key)?'existing_normalized_text':usedTitles.has(norm(n.title))?'existing_normalized_title':selectedSets.some(s=>nearDuplicate(s,set))?'strong_text_near_duplicate':null;
   if(reason){rejected.push({window_id:w.id,news_id:n.news_id,url:n.canonical_url,reason});continue;}
   usedUrls.add(n.canonical_url);usedTexts.add(key);usedTitles.add(norm(n.title));selectedSets.push(set);
   const month=n.publisher+'|'+n.published_date.slice(0,7);monthUses.set(month,(monthUses.get(month)||0)+1);
   selected.push({schema_version:1,pair_id:`EXP-${w.id}::${n.news_id}`,sampling_window:{...w},sampling_aliases:plan.terms[w.reference_case]||w.terms,split:'unassigned',review_status:'pending',labels:null,reviews:[],relevance_verified:false,negative_label_verified:false,historical_snapshot_verified:false,modified_after_publication_day:Boolean(n.source_modified_at&&n.source_modified_at.slice(0,10)>n.published_date),news:{...n},content_group:key,supplement_version:plan.version});
  }
  const now=selected.filter(r=>r.sampling_window.id===w.id);
  coverage.push({window_id:w.id,stratum:w.stratum,base_pairs:before,added_pairs:now.length-before,target:plan.target_per_window,selected:now.length,shortage:Math.max(0,plan.target_per_window-now.length),by_publisher:Object.fromEntries([...new Set(now.map(r=>r.news.publisher))].sort().map(p=>[p,now.filter(r=>r.news.publisher===p).length])),verified_case_relevant:now.filter(r=>r.relevance_verified).length});
 }
 assertFrozenSamplesUnchanged(base,selected.slice(0,base.length));
 const originalPublisherCoverage=originalPlan.windows.flatMap(w=>originalPlan.sources.map(p=>{const count=selected.filter(r=>r.sampling_window.id===w.id&&r.news.publisher===p).length;return {window_id:w.id,publisher:p,target:originalPlan.target_per_source_window,selected:count,shortage:Math.max(0,originalPlan.target_per_source_window-count)};}));
 return {selected,report:{version:plan.version,target_pairs:originalPlan.windows.length*plan.target_per_window,base_pairs:base.length,added_pairs:selected.length-base.length,selected_pairs:selected.length,unique_news:new Set(selected.map(r=>r.news.canonical_url)).size,remaining_window_shortage:coverage.reduce((s,c)=>s+c.shortage,0),coverage,candidate_screening:candidateScreening,original_publisher_coverage:originalPublisherCoverage,original_publisher_shortage:originalPublisherCoverage.reduce((s,c)=>s+c.shortage,0),rejected_new_candidates:rejected,used_for_training:false,labels:'all_new_pending_null',historical_snapshots_verified:0,limitations:['Window totals count unreviewed candidate pairs, not verified case coverage or independent events.','Original GV/VOA quotas are separate from expanded-panel totals.','The delivered v2 is retained including known relevance/origin audit concerns; see audit flags before use.','Search-index and sitemap discovery are incomplete and source selection is not representative.','New full text is the current retrieved version, not an authenticated historical snapshot.']}};
}
export function supplementCatalog(rows,report,audit){
 const flags=new Map();for(const f of audit.flags){if(!flags.has(f.pair_id))flags.set(f.pair_id,[]);flags.get(f.pair_id).push(f.code);}
 const options=[...new Set(rows.map(r=>r.news.publisher))].sort().map(p=>`<option>${esc(p)}</option>`).join('');
 const cards=rows.map(r=>`<article data-source="${esc(r.news.publisher)}" data-window="${esc(r.sampling_window.id)}" data-batch="${r.supplement_version?'new':'base'}"><h2>${esc(r.news.title)}</h2><p>${esc(r.pair_id)} · ${esc(r.news.published_date)} · ${esc(r.news.publisher)} · ${esc(r.news.genre||'体裁待审')}</p><p>${r.supplement_version?'本轮新增':'保留 v2'}；${esc(r.sampling_window.topic)}；相关性及标签待人工审核。</p><p>作者 ${esc(r.news.authors.join('、'))} · <a href="${esc(r.news.canonical_url)}">原文</a> · <a href="${esc(r.news.license_url)}">${esc(r.news.license)}</a></p><p class="flag">检查提示：${esc((flags.get(r.pair_id)||[]).join('；')||'未触发机械标记')}</p><details><summary>阅读原文</summary><div class="text">${esc(r.news.text)}</div><p>正文仅进行文字提取和空白规范化，图片、图注、嵌入媒体不在此许可与文本范围内；未改写正文。署名及原文许可如上。仅供非商业研究审核，各文章保留原许可。</p><details><summary>原文引用链接</summary>${(r.news.source_links||[]).map(l=>{const url=typeof l==='string'?l:l.url||l.href;return /^https?:\/\//.test(url||'')?`<p><a href="${esc(url)}">${esc(typeof l==='string'?url:l.text||l.label||url)}</a></p>`:'';}).join('')}</details></details></article>`).join('\n');
 return `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>补充样本 v3 — 待审核</title><style>body{max-width:1080px;margin:32px auto;padding:0 20px;font:16px/1.65 system-ui;background:#f4f6f8;color:#263445}header,article{padding:24px;margin:16px 0;background:white;border:1px solid #d7dfe8;border-radius:8px}h2{font-size:21px}.text{white-space:pre-wrap;font-family:Georgia,serif}a,summary{color:#1c619c}summary{cursor:pointer}.flag{color:#835617;font-size:14px}select{font:inherit;margin:6px;padding:6px}article[hidden]{display:none}</style><header><h1>补充样本 v3：人工审核入口</h1><p>保留 ${report.base_pairs} 条，新增 ${report.added_pairs} 条，共 ${report.selected_pairs} 个组合、${report.unique_news} 篇独立新闻。窗口总量仍缺 ${report.remaining_window_shortage} 条；原媒体配额仍缺 ${report.original_publisher_shortage} 条。</p><p>全部待人工审核。一般日历对照不表示和平期或负例；计数不等于已验证案例覆盖。旧数据发现的问题保留在质量报告中。</p><select id="source"><option value="">全部媒体</option>${options}</select><select id="window"><option value="">全部窗口</option>${report.coverage.map(w=>`<option>${esc(w.window_id)}</option>`).join('')}</select><select id="batch"><option value="">全部批次</option><option value="new">本轮新增</option><option value="base">原 v2</option></select><p id="count"></p></header>${cards}<script>const filters=['source','window','batch'].map(id=>document.getElementById(id));function filter(){let n=0;for(const a of document.querySelectorAll('article')){a.hidden=filters.some(f=>f.value&&a.dataset[f.id]!==f.value);if(!a.hidden)n++;}document.getElementById('count').textContent='当前显示 '+n+' 条';}filters.forEach(f=>f.onchange=filter);filter();</script></html>`;
}
export function prepareSupplement(){
 const oldPlanFile=path.join(ROOT,'research/data-expansion-plan.json'),planFile=path.join(ROOT,'research/data-expansion-supplement-plan.json');
 const oldPlan=JSON.parse(fs.readFileSync(oldPlanFile)),plan=JSON.parse(fs.readFileSync(planFile));
 const screeningFile=path.join(ROOT,'research/data-expansion-screening-decisions.json');
 if(fs.existsSync(screeningFile))plan.screening_decisions=JSON.parse(fs.readFileSync(screeningFile)).decisions;
 const baseFile=path.join(EXPANSION_ROOT,`samples-${plan.base_version}.jsonl`);
 if(sha256(fs.readFileSync(baseFile))!==plan.base_sha256)throw Error('Frozen v2 changed; do not replace it.');
 const files=['globalvoices-candidates.jsonl','voa-candidates.jsonl','voa-supplement-candidates.jsonl','open-news-supplement-candidates.jsonl','common-dreams-supplement-candidates.jsonl','conversation-supplement-candidates.jsonl','iss-supplement-candidates.jsonl','memo-supplement-candidates.jsonl','mongabay-supplement-candidates.jsonl','voa-congo-gap-candidates.jsonl','groundup-supplement-candidates.jsonl'].filter(f=>fs.existsSync(path.join(EXPANSION_ROOT,f)));
 const candidates=files.flatMap(f=>read(path.join(EXPANSION_ROOT,f)));
 const existing=['train_pairs.jsonl','validation_pairs.jsonl'].flatMap(f=>read(path.join(ROOT,'local-data',f)).map(r=>r.news));
 const {selected,report}=buildSupplement(read(baseFile),candidates,oldPlan,plan,existing);
 report.candidate_records=candidates.length;
 const tally=values=>Object.fromEntries([...new Set(values)].sort().map(v=>[v,values.filter(x=>x===v).length]));
 Object.assign(report,{selected_pairs_by_publisher:tally(selected.map(r=>r.news.publisher)),added_pairs_by_publisher:tally(selected.filter(r=>r.supplement_version).map(r=>r.news.publisher)),selected_pairs_by_stratum:tally(selected.map(r=>r.sampling_window.stratum)),new_pairs_by_genre:tally(selected.filter(r=>r.supplement_version).map(r=>r.news.genre||'unspecified'))});
 Object.assign(report,{base_sha256:sha256(fs.readFileSync(baseFile)),plan_sha256:sha256(fs.readFileSync(planFile)),source_files:files.map(f=>({name:f,sha256:sha256(fs.readFileSync(path.join(EXPANSION_ROOT,f)))})),protected_files:Object.fromEntries(['local-data/evaluation/review.jsonl','artifacts/research-model.json','local-data/train_pairs.jsonl','local-data/validation_pairs.jsonl'].map(f=>[f,sha256(fs.readFileSync(path.join(ROOT,f)))]))});
 report.scope_screening_decisions=plan.screening_decisions||[];
 if(fs.existsSync(screeningFile))report.scope_screening_sha256=sha256(fs.readFileSync(screeningFile));
 if(!/^[a-z0-9.-]+$/i.test(plan.version))throw Error('Invalid output version');
 const audit=auditExpansion(selected),out=path.join(EXPANSION_ROOT,`samples-${plan.version}.jsonl`);
 for(const d of plan.screening_decisions||[]){if(d.disposition==='review'){
  const row=selected.find(r=>r.news.news_id===d.news_id&&r.sampling_window.id===d.window_id);
  if(row){audit.flags.push({pair_id:row.pair_id,code:'scope_review_required',detail:d.reason});audit.flag_counts.scope_review_required=(audit.flag_counts.scope_review_required||0)+1;}
 }}
 const findingsFile=path.join(ROOT,'research/data-quality-findings.json');
 if(fs.existsSync(findingsFile)){
  const review=JSON.parse(fs.readFileSync(findingsFile));
  if(review.input_sha256!==report.base_sha256)throw Error('Quality findings refer to another v2 snapshot');
  audit.priority_review=review.findings.filter(f=>selected.some(r=>r.pair_id===f.pair_id));
  for(const f of audit.priority_review){audit.flags.push(f);audit.flag_counts[f.code]=(audit.flag_counts[f.code]||0)+1;}
  report.priority_quarantine_pairs=audit.priority_review.length;
  report.inventory_after_priority_quarantine=selected.length-audit.priority_review.length;
  report.quality_findings_sha256=sha256(fs.readFileSync(findingsFile));
 }
 if(audit.errors.length)throw Error('Supplement audit errors: '+JSON.stringify(audit.errors));
 if(fs.existsSync(out))assertFrozenSamplesUnchanged(read(out),selected);
 fs.writeFileSync(out,selected.map(r=>JSON.stringify(r)).join('\n')+'\n');
 report.selected_file=path.basename(out);report.selected_sha256=sha256(fs.readFileSync(out));
 report.audit={errors:audit.errors.length,flag_counts:audit.flag_counts,near_duplicates:audit.near_duplicates.length};
 const resultDir=path.resolve(ROOT,'../../outputs/数据补充与人工审核');fs.mkdirSync(resultDir,{recursive:true});
 fs.writeFileSync(path.join(EXPANSION_ROOT,'catalog-v3.html'),supplementCatalog(selected,report,audit));
  fs.copyFileSync(path.join(EXPANSION_ROOT,'catalog-v3.html'),path.join(resultDir,'补充样本-v3.html'));
 fs.writeFileSync(path.join(resultDir,'audit-expansion-v3.json'),JSON.stringify({input_sha256:report.selected_sha256,...audit},null,2)+'\n');
  const table=report.coverage.map(c=>`<tr><td>${esc(c.window_id)}</td><td>${c.base_pairs}</td><td>${c.added_pairs}</td><td>${c.selected}</td><td>${c.shortage}</td><td>${esc(Object.entries(c.by_publisher).map(([p,n])=>p+' '+n).join('；'))}</td></tr>`).join('');
  const priority=(audit.priority_review||[]).map(f=>`<li><b>${esc(f.pair_id)}</b><p>${esc(f.detail)}</p><a href="${esc(f.url)}">核对原文</a></li>`).join('');
  fs.writeFileSync(path.join(resultDir,'数据质量复查-v3.html'),`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>数据质量复查 v3</title><style>body{font:16px/1.7 system-ui;color:#233348;max-width:1180px;margin:32px auto;padding:0 24px}table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:10px;border:1px solid #d6dee8;text-align:left}th{background:#edf2f7}h1{font-size:28px}h2{font-size:21px;margin-top:30px}a{color:#1762a0}.note{padding:16px;background:#fff3d9;border-left:4px solid #b98730}code{overflow-wrap:anywhere}</style><h1>补充新闻数据质量复查 · v3</h1><p>新增 <b>${report.added_pairs}</b> 条，累计 ${report.selected_pairs} 个案例—新闻组合、${report.unique_news} 篇独立新闻。窗口总量缺口 ${report.remaining_window_shortage}；原 GV/VOA 各 8 条的媒体配额仍缺 ${report.original_publisher_shortage}，没有被新来源替代后宣称完成。</p><p><a href="补充样本-v3.html">打开全部样本、来源和全文</a> · <a href="audit-expansion-v3.json">查看机器审计明细</a></p><p class="note">全体候选仍待人工审核，当前模型及固定 60 篇审核新闻未改变。4 条旧记录有明确优先隔离问题，扣除后库存为 ${report.inventory_after_priority_quarantine} 条；其余记录也不能据此视为已获人工认可。一般日历层不是和平期或负例。</p><h2>窗口及来源</h2><table><thead><tr><th>窗口</th><th>原有</th><th>新增</th><th>合计</th><th>剩余</th><th>实际来源</th></tr></thead><tbody>${table}</tbody></table><h2>检查结果</h2><p>日期窗口、正文哈希和记录状态等机械检查：${audit.errors.length} 个硬错误。批内近重复：${audit.near_duplicates.length} 组；已有共享正文保留共同内容组。新增候选还与 train/validation 做精确及强近重复比较。</p><ul>${Object.entries(audit.flag_counts).map(([k,v])=>`<li>${esc(k)}：${v} 条</li>`).join('')}</ul><h2>优先隔离审核</h2><ol>${priority}</ol><h2>已经修复的采集问题</h2><p>清除推荐文章标题、图注、语言导航和转载政策；排除整篇通讯社归因稿；补足联合采写声明及正文链接。新闻、评论、事实核查与机构分析保留各自体裁，不能混算独立采写或独立事件。</p><h2>使用边界</h2><p>当前文本是抓取时网页版本，历史时点快照均未验证。发表后修改、同一事件不同报道、共同消息来源、样本来源偏差仍须处理。不得将缺稿、未审核、不确定或普通日期自动当负标签。本次没有据此重训或宣称准确率改善。</p><p>本地文件 SHA256：<code>${esc(report.selected_sha256)}</code>。原 v2、固定审核集和模型哈希详见研究目录的 data-expansion-report-v3.json。</p></html>`);
 fs.writeFileSync(path.join(ROOT,'research/data-expansion-report-v3.json'),JSON.stringify({...report,selected:selected.map(r=>({pair_id:r.pair_id,window:r.sampling_window.id,publisher:r.news.publisher,date:r.news.published_date,url:r.news.canonical_url,sha256:r.news.content_sha256,content_group:r.content_group}))},null,2)+'\n');
 console.log(JSON.stringify({selected:report.selected_pairs,added:report.added_pairs,shortage:report.remaining_window_shortage,coverage:report.coverage,audit:report.audit},null,2));
 return {selected,report,audit};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))prepareSupplement();

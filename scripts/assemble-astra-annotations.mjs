import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SECONDARY_AGENT,validateSecondaryInputs} from './prepare-astra-secondary.mjs';
export const FIELDS=['relevance','action','threat','posture','cooperation'];
const ROOT=fileURLToPath(new URL('../',import.meta.url));
export const DIR=path.join(ROOT,'local-data/model-annotation/astra-v1');
const sha=s=>createHash('sha256').update(s).digest('hex');
const norm=s=>String(s).normalize('NFKC').replace(/\s+/gu,' ').trim();
const read=f=>fs.readFileSync(f,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const allowedRowFields=new Set(['schema_version','pair_id','source_sha256','reviewer_type','model_id','agent_id','completed_at','review_status','labels','confidence','evidence','notes','uncertainties','quality_flags','read_complete','review_round']);
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export function validateSource(input){
 const c=input?.source?.case,n=input?.source?.news;
 if(!validDate(n?.date)||!validDate(c?.news_start)||!validDate(c?.news_end)||c.news_start>c.news_end||n.date<c.news_start||n.date>c.news_end)throw Error('Invalid publication date or source sampling window: '+input?.pair_id);
 if(sha(JSON.stringify(input.source))!==input.source_sha256||(input.original_source_sha256&&input.original_source_sha256!==input.source_sha256))throw Error('Source content/hash mismatch: '+input.pair_id);
}
export function validateProtocol(contents,expectedHash){if(sha(contents)!==expectedHash)throw Error('Annotation protocol changed');}
export function validateSecondaryReviewer(rows){if(rows.some(r=>r.agent_id!==SECONDARY_AGENT))throw Error('Wrong secondary reviewer agent');}
export function validateAnnotation(row,input){
 if(Object.keys(row).some(k=>!allowedRowFields.has(k)))throw Error('Unknown annotation fields or human review structure: '+row.pair_id);
 validateSource(input);
 if(!input||row.pair_id!==input.pair_id||row.source_sha256!==input.source_sha256)throw Error('Annotation input/hash mismatch: '+row.pair_id);
 if(row.reviewer_type!=='model'||row.model_id!=='gpt-6-astra'||!/^\/root\/astra_/.test(row.agent_id||''))throw Error('Must retain truthful Astra model provenance: '+row.pair_id);
 if(!row.completed_at||!/(Z|[+-]\d\d:\d\d)$/.test(row.completed_at)||!Number.isFinite(Date.parse(row.completed_at)))throw Error('Missing real completion timestamp: '+row.pair_id);
 if(!row.labels||Object.keys(row.labels).some(f=>!FIELDS.includes(f))||FIELDS.some(f=>![true,false,null].includes(row.labels[f])))throw Error('Missing or invalid label: '+row.pair_id);
 if(row.labels.relevance===false&&FIELDS.slice(1).some(f=>row.labels[f]!==false))throw Error('Irrelevant row has an in-scope event: '+row.pair_id);
 if(FIELDS.slice(1).some(f=>row.labels[f]===true)&&row.labels.relevance!==true)throw Error('Positive event lacks confirmed model relevance: '+row.pair_id);
 const uncertain=FIELDS.some(f=>row.labels[f]===null);
 if(row.review_status!==(uncertain?'model_uncertain':'model_annotated'))throw Error('Model status/uncertainty mismatch: '+row.pair_id);
 if(!['high','medium','low'].includes(row.confidence)||typeof row.notes!=='string'||!row.notes.trim())throw Error('Missing annotation explanation: '+row.pair_id);
 if(!Array.isArray(row.uncertainties)||uncertain&&!row.uncertainties.length||!Array.isArray(row.quality_flags)||[...row.uncertainties,...row.quality_flags].some(v=>typeof v!=='string'))throw Error('Missing or invalid uncertainty/quality arrays: '+row.pair_id);
 if(!Array.isArray(row.evidence)||!row.evidence.length)throw Error('Missing source evidence: '+row.pair_id);
 const text=norm(input.source.news.title+'\n'+input.source.news.text),covered=new Set();
 for(const e of row.evidence){
  if(Object.keys(e).some(k=>!['fields','quote','actor','target','event_date','temporal_basis','assertion'].includes(k))||['actor','target','temporal_basis','assertion'].some(k=>e[k]!=null&&typeof e[k]!=='string'))throw Error('Invalid evidence metadata: '+row.pair_id);
  if(!Array.isArray(e.fields)||!e.fields.length||e.fields.some(f=>!FIELDS.includes(f)))throw Error('Invalid evidence fields: '+row.pair_id);
  if(typeof e.quote!=='string'||!norm(e.quote)||!text.includes(norm(e.quote)))throw Error('Evidence not found in source: '+row.pair_id+' '+e.quote);
  for(const f of e.fields)covered.add(f);
  if(e.event_date!==null&&e.event_date!==undefined){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(e.event_date)||!Number.isFinite(Date.parse(e.event_date))||new Date(e.event_date).toISOString().slice(0,10)!==e.event_date)throw Error('Invented/invalid event date: '+row.pair_id);
   if(e.fields.some(f=>f!=='relevance'&&row.labels[f]===true)){
    const age=(Date.parse(input.source.news.date)-Date.parse(e.event_date))/86400000;
    if(!Number.isFinite(age)||age<0||age>7)throw Error('Positive event evidence outside seven-day window: '+row.pair_id);
   }
  }
 }
 if(!covered.has('relevance'))throw Error('Missing relevance field evidence: '+row.pair_id);
 for(const f of FIELDS.slice(1))if(row.labels[f]===true&&!covered.has(f))throw Error('Positive event missing field evidence: '+row.pair_id+' '+f);
 if(Object.hasOwn(row,'human_reviewer')||['human-reviewed','adjudicated'].includes(row.review_status))throw Error('Model result cannot claim human review');
 return {evidence_words:row.evidence.reduce((s,e)=>s+norm(e.quote).split(/\s+/u).length,0)};
}
export function validateSet(rows,inputs){
 const map=new Map(inputs.map(r=>[r.pair_id,r])),seen=new Set(),warnings=[];
 if(rows.length!==inputs.length)throw Error(`Incomplete annotation set ${rows.length}/${inputs.length}`);
 for(const row of rows){if(seen.has(row.pair_id))throw Error('Duplicate annotation: '+row.pair_id);seen.add(row.pair_id);const r=validateAnnotation(row,map.get(row.pair_id));if(r.evidence_words>25)warnings.push({pair_id:row.pair_id,code:'long_quote_review',words:r.evidence_words});}
 return {validated:rows.length,warnings};
}
export function summarize(rows){
 return {count:rows.length,uncertain_records:rows.filter(r=>FIELDS.some(f=>r.labels[f]===null)).length,labels:Object.fromEntries(FIELDS.map(f=>[f,{yes:rows.filter(r=>r.labels[f]===true).length,no:rows.filter(r=>r.labels[f]===false).length,uncertain:rows.filter(r=>r.labels[f]===null).length}]))};
}
export function assemble(){
 const inputs=JSON.parse(fs.readFileSync(path.join(DIR,'input.json'))),manifest=JSON.parse(fs.readFileSync(path.join(DIR,'manifest.json')));
 if(sha(JSON.stringify(inputs))!==manifest.input_sha256)throw Error('Annotation inputs changed');
 validateProtocol(fs.readFileSync(path.join(ROOT,'research/astra-annotation-protocol.md')),manifest.protocol_sha256);
 for(const [p,h] of Object.entries(manifest.protected_files))if(sha(fs.readFileSync(path.join(ROOT,p)))!==h)throw Error('Protected file changed: '+p);
 const primary=Object.keys(manifest.shards).flatMap(name=>{const rows=read(path.join(DIR,name+'-annotations.jsonl'));const shard=JSON.parse(fs.readFileSync(path.join(DIR,name+'-input.json')));validateSet(rows,shard);if(rows.some(r=>r.agent_id!=='/root/'+name))throw Error('Wrong shard agent '+name);return rows;});
 const validation=validateSet(primary,inputs),byId=new Map(primary.map(r=>[r.pair_id,r]));
 const ordered=inputs.map(r=>byId.get(r.pair_id));
 const secondaryFile=path.join(DIR,'astra-secondary-annotations.jsonl');
 const secondary=fs.existsSync(secondaryFile)?read(secondaryFile):[];
 const secondaryInputFile=path.join(DIR,'secondary-input.json');
 if(fs.existsSync(secondaryInputFile)){
  const secondaryInputs=JSON.parse(fs.readFileSync(secondaryInputFile));
  validateSecondaryInputs(inputs,secondaryInputs,JSON.parse(fs.readFileSync(path.join(DIR,'secondary-manifest.json'))));
  validateSet(secondary,secondaryInputs);
  validateSecondaryReviewer(secondary);
 }else if(secondary.length)throw Error('Missing frozen secondary inputs');
 const comparisons=secondary.map(s=>{const p=byId.get(s.pair_id);return {pair_id:s.pair_id,disagreed_fields:FIELDS.filter(f=>p.labels[f]!==s.labels[f]),primary_labels:p.labels,secondary_labels:s.labels};});
 const disagreementIds=new Set(comparisons.filter(c=>c.disagreed_fields.length).map(c=>c.pair_id));
 const reviewQueue=ordered.filter(r=>FIELDS.some(f=>r.labels[f]===null)||r.quality_flags.length||disagreementIds.has(r.pair_id)).map(r=>({pair_id:r.pair_id,label_uncertainties:r.uncertainties,quality_flags:r.quality_flags,model_disagreement:comparisons.find(c=>c.pair_id===r.pair_id&&c.disagreed_fields.length)||null}));
 const report={schema_version:1,annotation_kind:'model_assisted_silver_labels',model_id:'gpt-6-astra',human_reviewed:0,independent_human_gold:false,training_modified:false,summary:summarize(ordered),by_dataset:Object.fromEntries(['fixed_60','expansion_160'].map(d=>[d,summarize(ordered.filter(r=>inputs.find(i=>i.pair_id===r.pair_id).dataset===d))])),by_case:Object.fromEntries(['S016','S017','S018','S019','S020'].map(c=>[c,summarize(ordered.filter(r=>inputs.find(i=>i.pair_id===r.pair_id).source.case.case_id===c))])),secondary_review:{kind:'same_model_blind_spot_check_not_independent_human_review',count:secondary.length,complete_label_agreement:comparisons.filter(c=>!c.disagreed_fields.length).length,disagreements:comparisons.filter(c=>c.disagreed_fields.length)},priority_review_count:reviewQueue.length,validation,protected_files_unchanged:true,input_sha256:manifest.input_sha256,protocol_sha256:manifest.protocol_sha256,annotation_sha256:sha(ordered.map(r=>JSON.stringify(r)).join('\n')+'\n'),limitations:['Silver labels generated by GPT-6 Astra, not human annotations or independently verified truth.','Model confidence is qualitative and uncalibrated. Nulls and model disagreements remain unresolved.','Source versions, source dependence and current-window relevance still require human verification.','No classifier accuracy or future-event forecast accuracy is inferred from these annotations.']};
 const out=path.join(DIR,'annotations.jsonl'),serialized=ordered.map(r=>JSON.stringify(r)).join('\n')+'\n';
 if(fs.existsSync(out)&&fs.readFileSync(out,'utf8')!==serialized)throw Error('Refuse to overwrite changed consolidated annotations; create a new revision');
 fs.writeFileSync(out,serialized);fs.writeFileSync(path.join(DIR,'report.json'),JSON.stringify(report,null,2)+'\n');fs.writeFileSync(path.join(DIR,'review-queue.json'),JSON.stringify(reviewQueue,null,2)+'\n');
 const outputDir=path.resolve(ROOT,'../../outputs/Astra模型标注');fs.mkdirSync(outputDir,{recursive:true});
 const display=v=>v===null?'不确定':v?'是':'否';
 const cards=inputs.map(input=>{const r=byId.get(input.pair_id),q=reviewQueue.find(x=>x.pair_id===r.pair_id),s=secondary.find(x=>x.pair_id===r.pair_id);return `<article data-case="${esc(input.source.case.case_id)}" data-dataset="${esc(input.dataset)}" data-review="${q?'yes':'no'}"><h2>${esc(input.source.news.title)}</h2><p class="meta">${esc(input.pair_id)} · ${esc(input.source.news.date)} · ${esc(input.source.news.publisher)}</p><table><tr><th>相关性</th><th>军事行动</th><th>威胁</th><th>姿态</th><th>协商</th></tr><tr>${FIELDS.map(f=>`<td>${display(r.labels[f])}</td>`).join('')}</tr></table><p>${esc(r.notes)}</p><p>模型确定性：${esc(r.confidence)}；标注者：GPT-6 Astra；人工复核：尚未进行。</p>${q?`<p class="warn">待复核：${esc([...r.uncertainties,...r.quality_flags,...(disagreementIds.has(r.pair_id)?['第二轮模型判断存在分歧']:[])].join('；'))}</p>`:''}<details><summary>证据与元数据</summary>${r.evidence.map(e=>`<p><b>${esc(e.fields.join(', '))}</b>：“${esc(e.quote)}”</p>`).join('')}<p>${esc(r.agent_id)} · ${esc(r.completed_at)} · SHA256 ${esc(r.source_sha256)}</p>${s?`<p>模型二次盲审：${FIELDS.map(f=>esc(f)+'='+display(s.labels[f])).join('，')}；${esc(s.notes)}</p>`:''}</details><details><summary>阅读全文</summary><p>案例范围：${esc(input.source.case.target_situation)}</p><div class="body">${esc(input.source.news.text)}</div>${input.source.news.url?`<a href="${esc(input.source.news.url)}">原文来源</a>`:''}</details></article>`;}).join('\n');
 fs.writeFileSync(path.join(outputDir,'模型标注阅读页.html'),`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GPT-6 Astra 模型辅助标注</title><style>body{font:16px/1.7 system-ui;background:#f4f6f8;color:#263445;max-width:1100px;margin:32px auto;padding:0 24px}header,article{background:white;padding:24px;border:1px solid #d8e0e9;border-radius:8px;margin:16px 0}h1{font-size:26px}h2{font-size:21px}.meta{color:#617084;font-size:14px}.warn{background:#fff3d9;padding:10px}table{width:100%;border-collapse:collapse}th,td{text-align:center;padding:8px;border-bottom:1px solid #dde3ea}summary,a{color:#1762a0}summary{cursor:pointer}.body{white-space:pre-wrap;font-family:Georgia,serif}select{font:inherit;padding:6px;margin-right:14px}article[hidden]{display:none}</style><header><h1>GPT-6 Astra 模型辅助标注</h1><p>${ordered.length} 条记录，${report.summary.uncertain_records} 条含不确定标签，${reviewQueue.length} 条进入复核队列。人工复核完成数为 0。全部为模型银标，未合并训练。</p><p>第二轮对 ${secondary.length} 条做同模型盲审，${report.secondary_review.complete_label_agreement} 条五项完全一致；这不是人工一致性或独立真值验证。</p><select id="case"><option value="">全部案例</option>${['S016','S017','S018','S019','S020'].map(c=>`<option>${c}</option>`).join('')}</select><select id="dataset"><option value="">全部批次</option><option value="fixed_60">原60条</option><option value="expansion_160">补样160条</option></select><select id="review"><option value="">全部状态</option><option value="yes">需要复核</option><option value="no">未触发复核标记</option></select><p id="count"></p></header>${cards}<script>const filters=['case','dataset','review'].map(id=>document.getElementById(id));function filter(){let n=0;for(const a of document.querySelectorAll('article')){a.hidden=filters.some(f=>f.value&&a.dataset[f.id]!==f.value);if(!a.hidden)n++;}document.getElementById('count').textContent='当前显示 '+n+' 条';}filters.forEach(f=>f.onchange=filter);filter();</script></html>`);
 fs.copyFileSync(out,path.join(outputDir,'模型标注.jsonl'));fs.copyFileSync(path.join(DIR,'report.json'),path.join(outputDir,'标注质量报告.json'));
 console.log(JSON.stringify({summary:report.summary,review_queue:reviewQueue.length,secondary:report.secondary_review,outputDir},null,2));return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))assemble();

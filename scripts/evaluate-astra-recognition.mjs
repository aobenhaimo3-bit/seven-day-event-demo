import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {FIELDS,validateSet,validateProtocol,validateSecondaryReviewer} from './assemble-astra-annotations.mjs';
import {validateSecondaryInputs} from './prepare-astra-secondary.mjs';
import {ruleProvenance} from '../lib/data.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const DIR=path.join(ROOT,'local-data/model-annotation/astra-v1');
const BASELINE=path.join(ROOT,'research/baselines/event-context-coverage-v5');
export const digest=value=>createHash('sha256').update(value).digest('hex');
const json=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const lines=f=>fs.readFileSync(f,'utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
const serialize=value=>JSON.stringify(value,null,2)+'\n';
export function writeFrozen(file,value){const text=serialize(value);if(fs.existsSync(file)){if(fs.readFileSync(file,'utf8')!==text)throw Error('Frozen evaluation changed; create a new revision: '+file);}else fs.writeFileSync(file,text,{flag:'wx'});}

export function exclusionsFor(inputs,annotations,secondary,qualityFindings){
 const byId=new Map(annotations.map(r=>[r.pair_id,r]));
 const second=new Map(secondary.map(r=>[r.pair_id,r]));
 const quarantined=new Map(qualityFindings.filter(r=>String(r.suggested_disposition).startsWith('quarantine_')).map(r=>[r.pair_id,r]));
 return inputs.flatMap(input=>{
  const r=byId.get(input.pair_id),s=second.get(input.pair_id),reasons=[];
  if(!r)throw Error('Missing model annotation: '+input.pair_id);
  if(FIELDS.some(f=>r.labels[f]===null))reasons.push('uncertain_model_label');
  if(r.quality_flags.length)reasons.push('model_quality_flag');
  if(s&&FIELDS.some(f=>s.labels[f]!==r.labels[f]))reasons.push('secondary_model_disagreement');
  if(quarantined.has(input.pair_id))reasons.push('prior_source_scope_quarantine');
  return reasons.length?[{pair_id:input.pair_id,reasons,quality_finding:quarantined.get(input.pair_id)||null}]:[];
 });
}

function metric({tp,tn,fp,fn}){const n=tp+tn+fp+fn;return {tp,tn,fp,fn,support:n,positive_labels:tp+fn,negative_labels:tn+fp,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,f1:2*tp+fp+fn?2*tp/(2*tp+fp+fn):null,agreement:n?(tp+tn)/n:null};}
export function summarizePredictions(rows){
 const metrics=Object.fromEntries(FIELDS.map(f=>{
  const c={tp:0,tn:0,fp:0,fn:0};for(const r of rows){if(typeof r.labels?.[f]!=='boolean'||typeof r.prediction?.[f]!=='boolean')throw Error('Scoring requires explicit boolean labels and predictions');c[r.labels[f]?(r.prediction[f]?'tp':'fn'):(r.prediction[f]?'fp':'tn')]++;}return [f,metric(c)];
 }));
 const exact=rows.filter(r=>FIELDS.every(f=>r.labels[f]===r.prediction[f])).length;
 return {count:rows.length,exact_match_count:exact,exact_match_agreement:rows.length?exact/rows.length:null,metrics};
}

export function evaluateSilver(inputs,annotations,exclusions,predict){
 const excluded=new Set(exclusions.map(r=>r.pair_id)),byId=new Map(annotations.map(r=>[r.pair_id,r]));
 const predictions=inputs.filter(i=>!excluded.has(i.pair_id)).map(input=>{
  const annotation=byId.get(input.pair_id),signals=predict(input),prediction={relevance:signals.relevant,action:signals.action,threat:signals.threat,posture:signals.posture,cooperation:signals.cooperation};
  if(FIELDS.some(f=>typeof prediction[f]!=='boolean'||typeof annotation.labels[f]!=='boolean'))throw Error('Scoring requires explicit boolean labels and predictions: '+input.pair_id);
  return {pair_id:input.pair_id,dataset:input.dataset,case_id:input.source.case.case_id,publisher:input.source.news.publisher,date:input.source.news.date,title:input.source.news.title,source_sha256:input.source_sha256,labels:annotation.labels,prediction,mismatch_fields:FIELDS.filter(f=>annotation.labels[f]!==prediction[f]),annotation_evidence:annotation.evidence,annotation_notes:annotation.notes,signals};
 });
 const group=key=>Object.fromEntries([...new Set(predictions.map(r=>r[key]))].sort().map(value=>[value,summarizePredictions(predictions.filter(r=>r[key]===value))]));
 return {summary:summarizePredictions(predictions),by_dataset:group('dataset'),by_case:group('case_id'),by_publisher:group('publisher'),predictions};
}

export function loadFrozenCohort(){
 const inputs=json(path.join(DIR,'input.json')),annotations=lines(path.join(DIR,'annotations.jsonl')),manifest=json(path.join(DIR,'manifest.json')),report=json(path.join(DIR,'report.json'));
 if(digest(JSON.stringify(inputs))!==manifest.input_sha256)throw Error('Frozen annotation input hash mismatch');
 validateProtocol(fs.readFileSync(path.join(ROOT,'research/astra-annotation-protocol.md')),manifest.protocol_sha256);
 if(digest(annotations.map(r=>JSON.stringify(r)).join('\n')+'\n')!==report.annotation_sha256)throw Error('Frozen annotation result hash mismatch');
 validateSet(annotations,inputs);
 for(const [name,count] of Object.entries(manifest.shards)){
  const shardInputs=json(path.join(DIR,name+'-input.json')),shardRows=lines(path.join(DIR,name+'-annotations.jsonl'));validateSet(shardRows,shardInputs);
  if(shardRows.length!==count||shardRows.some(r=>r.agent_id!=='/root/'+name))throw Error('Primary shard provenance mismatch');
  const global=new Map(annotations.map(r=>[r.pair_id,r]));
  for(const r of shardRows)if(JSON.stringify(global.get(r.pair_id))!==JSON.stringify(r))throw Error('Primary shard differs from consolidated result');
 }
 const secondaryInputs=json(path.join(DIR,'secondary-input.json')),secondary=lines(path.join(DIR,'astra-secondary-annotations.jsonl'));
 validateSecondaryInputs(inputs,secondaryInputs,json(path.join(DIR,'secondary-manifest.json')));validateSet(secondary,secondaryInputs);validateSecondaryReviewer(secondary);
 for(const [file,hash] of Object.entries(manifest.protected_files)){
  // Retraining may change the deployment model. Validate the original snapshot,
  // never rewrite the annotation manifest to pretend the old model was new.
  const actual=file==='artifacts/research-model.json'?path.join(BASELINE,'model.json'):path.join(ROOT,file);
  if(digest(fs.readFileSync(actual))!==hash)throw Error('Protected annotation source/snapshot changed: '+file);
 }
 const qualityPath=path.join(ROOT,'research/data-quality-findings.json'),quality=json(qualityPath);
 const exclusions=exclusionsFor(inputs,annotations,secondary,quality.findings);
 const queue=json(path.join(DIR,'review-queue.json'));
 const modelExcluded=exclusions.filter(r=>r.reasons.some(x=>x!=='prior_source_scope_quarantine')).map(r=>r.pair_id).sort();
 if(JSON.stringify(queue.map(r=>r.pair_id).sort())!==JSON.stringify(modelExcluded))throw Error('Review queue differs from recomputed unresolved records');
 const excludedIds=new Set(exclusions.map(r=>r.pair_id));
 const cohort={schema_version:1,evaluation_kind:'development_agreement_with_astra_silver_labels',label_provenance:'GPT-6 Astra model-assisted silver labels, not human gold',independent_holdout:false,input_sha256:manifest.input_sha256,annotation_sha256:report.annotation_sha256,protocol_sha256:manifest.protocol_sha256,secondary_annotation_sha256:digest(fs.readFileSync(path.join(DIR,'astra-secondary-annotations.jsonl'))),quality_findings_sha256:digest(fs.readFileSync(qualityPath)),selected:inputs.length,eligible_pair_ids:inputs.filter(i=>!excludedIds.has(i.pair_id)).map(i=>i.pair_id),excluded:exclusions,exclusion_counts:{model_review_queue:modelExcluded.length,prior_quarantine:exclusions.filter(r=>r.reasons.includes('prior_source_scope_quarantine')).length,overlap:exclusions.filter(r=>r.reasons.includes('prior_source_scope_quarantine')&&r.reasons.length>1).length,total:exclusions.length}};
 writeFrozen(path.join(DIR,'recognition-cohort.json'),cohort);
 return {inputs,annotations,exclusions,cohort};
}

async function loadPredictor(mode){
 if(!['baseline','current'].includes(mode))throw Error('Usage: node scripts/evaluate-astra-recognition.mjs baseline|current');
 const modelPath=mode==='baseline'?path.join(BASELINE,'model.json'):path.join(ROOT,'artifacts/research-model.json');
 const engineDir=mode==='baseline'?BASELINE:path.join(ROOT,'lib');
 const model=json(modelPath);
 if(mode==='baseline'){
  const snapshot=json(path.join(BASELINE,'manifest.json'));
  for(const [file,hash] of Object.entries(snapshot.files))if(digest(fs.readFileSync(path.join(BASELINE,file)))!==hash)throw Error('Frozen baseline snapshot changed: '+file);
 }
 const moduleNames=mode==='baseline'?['engine','assertions','temporal','event-relations']:Object.keys(ruleProvenance()).map(p=>path.basename(p,'.mjs'));
 for(const name of moduleNames){
  const hash=digest(fs.readFileSync(path.join(engineDir,name+'.mjs'),'utf8').replace(/\r\n/g,'\n'));
  if(hash!==model.rule_source_sha256?.['lib/'+name+'.mjs'])throw Error('Engine/model source mismatch; retrain before evaluating: '+name);
 }
 for(const item of Object.values(model.data_provenance||{}))if(digest(fs.readFileSync(path.join(ROOT,item.path)))!==item.sha256)throw Error('Model training provenance changed: '+item.path);
 const engine=await import(pathToFileURL(path.join(engineDir,'engine.mjs')).href);
 if(model.detector_rule_version!==engine.DETECTOR_RULE_VERSION)throw Error('Engine/model rule version mismatch');
 return {predict:input=>engine.extractArticleSignals(input.source.case,input.source.news,model),model_info:{rule_version:model.detector_rule_version,model_sha256:digest(fs.readFileSync(modelPath)),rule_source_sha256:model.rule_source_sha256,detector_trained_through:model.detector.trained_through}};
}

export async function runSilverEvaluation(mode='baseline'){
 const {inputs,annotations,exclusions,cohort}=loadFrozenCohort(),{predict,model_info}=await loadPredictor(mode);
 const result=evaluateSilver(inputs,annotations,exclusions,predict);
 const report={schema_version:1,evaluation_kind:cohort.evaluation_kind,label_provenance:cohort.label_provenance,independent_holdout:false,human_gold_available:false,cohort_sha256:digest(JSON.stringify(cohort)),input_sha256:cohort.input_sha256,annotation_sha256:cohort.annotation_sha256,model_info,coverage:{selected:cohort.selected,scored:cohort.eligible_pair_ids.length,excluded:cohort.exclusion_counts},summary:result.summary,by_dataset:result.by_dataset,by_case:result.by_case,by_publisher:result.by_publisher,mismatches:result.predictions.filter(r=>r.mismatch_fields.length).map(r=>({pair_id:r.pair_id,fields:r.mismatch_fields})),limitations:['Agreement is with GPT-6 Astra model-generated labels, not human gold or independently verified events.','All five labels of a record are excluded if any label is uncertain, either annotation round disagrees, a model quality flag exists, or prior source/scope quarantine applies. Exclusions never become negative labels.','These development cases can inform repairs; reuse for post-repair scoring is a diagnostic, not an untouched holdout.','Media and case groups are small and dependent. No statistical significance or population generalization is inferred.','Article-level agreement does not measure future seven-day event forecast accuracy.']};
 const full={...report,predictions:result.predictions,excluded:exclusions};
 const local=path.join(DIR,'recognition-'+mode+'.json'),publicFile=path.join(ROOT,'research/astra-recognition-'+mode+'.json');
 if(mode==='baseline'){writeFrozen(local,full);writeFrozen(publicFile,report);}else{fs.writeFileSync(local,serialize(full));fs.writeFileSync(publicFile,serialize(report));}
 console.log(JSON.stringify({mode,coverage:report.coverage,summary:report.summary,local,publicFile},null,2));return full;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv.length>3)throw Error('Usage: node scripts/evaluate-astra-recognition.mjs baseline|current');await runSilverEvaluation(process.argv[2]||'baseline');}

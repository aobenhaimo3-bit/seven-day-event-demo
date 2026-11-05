import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {PROJECT_ROOT,readDevelopmentData,trainingProvenance,ruleProvenance} from '../lib/data.mjs';

export const BASELINE='event-context-coverage-v5';
export const BASELINE_DIR=path.join(PROJECT_ROOT,'research/baselines',BASELINE);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const key=r=>`${r.case_id}/${r.as_of}`;
const REQUIRED_FILES=['engine.mjs','assertions.mjs','temporal.mjs','event-relations.mjs','model.json','model-report.json'];

export function verifyBaselineFiles(manifest,readFile){
 if(manifest?.version!==BASELINE||JSON.stringify(Object.keys(manifest.files||{}).sort())!==JSON.stringify([...REQUIRED_FILES].sort()))throw Error('Invalid frozen v5 baseline manifest');
 for(const name of REQUIRED_FILES)if(sha(readFile(name))!==manifest.files[name])throw Error('Frozen v5 baseline changed: '+name);
}
export function verifyDataProvenance(expected,actual){
 const keys=['train','validation','pilot','aliases'];
 for(const name of keys)if(!expected?.[name]?.sha256||expected[name].sha256!==actual?.[name]?.sha256||expected[name].path!==actual[name].path)throw Error('Comparison requires identical development inputs: '+name);
}
export function selectionData(engine,model,inputs){
 const train=engine.researchInternals.rollingSamples(inputs.trainingCases,model).samples;
 const lastTrainLabel=train.map(r=>r.label_end).sort().at(-1);
 if(!train.length||lastTrainLabel!==model.training_period.last_label_end)throw Error('Training-window reconstruction mismatch');
 const cutoff=[model.detector.trained_through,...inputs.trainingCases.map(c=>c.news_end)].filter(Boolean).sort().at(-1);
 const validation=engine.researchInternals.rollingSamples(inputs.validationCases,model).samples.filter(r=>r.as_of>lastTrainLabel&&r.as_of>=cutoff);
 // Deployment fits include eligible validation windows; never use those weights
 // when measuring validation performance. The detector was fit on pilot train.
 const fit=engine.researchInternals.fitLogistic(train,model.forecast.lambda);
 const byKey=new Map(validation.map(r=>[key(r),r]));
 if(byKey.size!==validation.length)throw Error('Duplicate validation anchors');
 return {train,validation,fit,byKey};
}
export function verifyNativeMetrics(actual,expected){
 for(const field of ['sample_count','positives','negatives','brier','log_loss','accuracy','baseline_brier','baseline_log_loss','baseline_accuracy','persistence_brier'])if(actual[field]!==expected[field])throw Error('Validation reconstruction mismatch: '+field);
 if(JSON.stringify(actual.confusion)!==JSON.stringify(expected.confusion))throw Error('Validation reconstruction mismatch: confusion');
}
export function compareSelections(old,fresh,oldMetrics,newMetrics){
 const common=fresh.validation.filter(r=>old.byKey.has(key(r)));
 const oldCommon=common.map(r=>old.byKey.get(key(r)));
 return {
  common_windows:{
   count:common.length,changed_labels:common.filter((r,i)=>r.y!==oldCommon[i].y).length,
   evaluated_on_old_labels:{before:oldMetrics(oldCommon,old.fit),after:newMetrics(common.map((r,i)=>({...r,y:oldCommon[i].y})),fresh.fit)},
   evaluated_on_new_labels:{before:oldMetrics(oldCommon.map((r,i)=>({...r,y:common[i].y})),old.fit),after:newMetrics(common,fresh.fit)},
   note:'Both model comparisons use the same anchors and target labels within each matrix. Constant and persistence baselines are version-specific: own training rate and own detected historical action. Neither label definition is independent truth.'
  },
  changed_validation_labels:common.filter((r,i)=>r.y!==oldCommon[i].y).map(r=>({key:key(r),old_label:old.byKey.get(key(r)).y,new_label:r.y})),
  dropped_validation_windows:old.validation.filter(r=>!fresh.byKey.has(key(r))).map(r=>({key:key(r),old_label:r.y})),
  added_validation_windows:fresh.validation.filter(r=>!old.byKey.has(key(r))).map(r=>({key:key(r),new_label:r.y})),
 };
}
export async function compareValidation(){
 const manifest=JSON.parse(fs.readFileSync(path.join(BASELINE_DIR,'manifest.json'),'utf8'));
 verifyBaselineFiles(manifest,name=>fs.readFileSync(path.join(BASELINE_DIR,name)));
 const data=trainingProvenance();verifyDataProvenance(manifest.data_provenance,data);
 const previous=JSON.parse(fs.readFileSync(path.join(BASELINE_DIR,'model.json'),'utf8'));
 verifyDataProvenance(data,previous.data_provenance);
 if(previous.detector_rule_version!==BASELINE)throw Error('Frozen model is not v5');
 const previousEngine=await import(pathToFileURL(path.join(BASELINE_DIR,'engine.mjs')).href);
 const currentEngine=await import('../lib/engine.mjs');
 const {loadFrozenModel}=await import('../server.mjs');
 const current=loadFrozenModel();
 if(current.detector_rule_version!=='full-text-multisignal-v6')throw Error('This historical v5-v6 comparison requires the v6 model; use compare-validation-v7.mjs for v7.');
 verifyDataProvenance(data,current.data_provenance);
 if(previousEngine.DETECTOR_RULE_VERSION!==BASELINE)throw Error('Frozen engine version mismatch');
 const inputs=readDevelopmentData();
 const old=selectionData(previousEngine,previous,inputs),fresh=selectionData(currentEngine,current,inputs);
 const oldMetrics=previousEngine.researchInternals.metrics,newMetrics=currentEngine.researchInternals.metrics;
 const oldNative=oldMetrics(old.validation,old.fit),newNative=newMetrics(fresh.validation,fresh.fit);
 verifyNativeMetrics(oldNative,previous.validation_metrics);verifyNativeMetrics(newNative,current.validation_metrics);
 const report={
  schema_version:1,baseline_version:BASELINE,current_version:current.detector_rule_version,
  baseline_manifest_sha256:sha(fs.readFileSync(path.join(BASELINE_DIR,'manifest.json'))),baseline_files_sha256:manifest.files,current_source_sha256:ruleProvenance(),data_provenance:data,
  evaluation_contract:{
   evaluation_kind:'development_forecast_weak_report_proxy_comparison',independent_holdout:false,independent_gold_available:false,
   split_unchanged:true,fit_on_training_only:true,normalization_fit_on_training_only:true,test_input_used:false,test_gold_used:false,silver_annotations_added_to_training:false,
   hyperparameters:'Each version retains its own validation-selected lambda from the original grid. Validation has been used for development and tuning.',
   target:'At least one automatically detected military-action report in the next seven days of sufficiently covered supplied news, not independently verified real-world action.',
   recognition_distinction:'Astra labels evaluate article-level extraction separately. They are not forecast targets and do not establish future-event accuracy.',
   comparison_limit:'Native windows and detector-derived targets can change. Use common-window matrices with both old and new fixed labels, and inspect additions, removals and changed labels.',
   dependence_limit:'Overlapping historical windows, shared articles and case/media dependence prevent interpreting these small samples as independent trials; no statistical significance or calibrated real-event probability is claimed.',
  },
  native:{
   before:{rule_version:previous.detector_rule_version,train_windows:old.train.length,validation_cases:new Set(old.validation.map(r=>r.case_id)).size,lambda:previous.forecast.lambda,metrics:oldNative},
   after:{rule_version:current.detector_rule_version,train_windows:fresh.train.length,validation_cases:new Set(fresh.validation.map(r=>r.case_id)).size,lambda:current.forecast.lambda,metrics:newNative},
  },
  ...compareSelections(old,fresh,oldMetrics,newMetrics),
  validation_predictions:[...new Set([...old.byKey.keys(),...fresh.byKey.keys()])].sort().map(id=>{
   const a=old.byKey.get(id),b=fresh.byKey.get(id);
   return {key:id,before:a?{label:a.y,probability:previousEngine.researchInternals.forecastProbability(old.fit,a.x),persistence:a.persistence,constant_probability:old.fit.base_rate}:null,after:b?{label:b.y,probability:currentEngine.researchInternals.forecastProbability(fresh.fit,b.x),persistence:b.persistence,constant_probability:fresh.fit.base_rate}:null};
  }),
 };
 const output=path.join(PROJECT_ROOT,'research/validation-comparison-v6.json');
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 return {...report,output};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length>2)throw Error('Usage: node scripts/compare-validation-v6.mjs');
 const r=await compareValidation();
 console.log(JSON.stringify({native:r.native,common_windows:r.common_windows,changed_validation_labels:r.changed_validation_labels,dropped:r.dropped_validation_windows,added:r.added_validation_windows,output:r.output},null,2));
}

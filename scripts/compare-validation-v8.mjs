import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {PROJECT_ROOT,readDevelopmentData,trainingProvenance,ruleProvenance} from '../lib/data.mjs';
import {verifyDataProvenance,selectionData,verifyNativeMetrics,compareSelections} from './compare-validation-v6.mjs';
export const BASELINE='scoped-event-recall-v7';
export const BASELINE_DIR=path.join(PROJECT_ROOT,'research/baselines',BASELINE);
const sha=b=>createHash('sha256').update(b).digest('hex');
const required=['engine.mjs','assertions.mjs','temporal.mjs','event-relations.mjs','action-vocabulary.mjs','communication.mjs','scope.mjs','model.json','model-report.json','recognition.json','recognition-summary.json'];
export function verifyV7Snapshot(manifest,read){
 if(manifest?.version!==BASELINE||JSON.stringify(Object.keys(manifest.files||{}).sort())!==JSON.stringify([...required].sort()))throw Error('Invalid frozen v7 manifest');
 for(const file of required)if(sha(read(file))!==manifest.files[file])throw Error('Frozen v7 file changed: '+file);
}
export async function compareValidationV8(){
 const manifest=JSON.parse(fs.readFileSync(path.join(BASELINE_DIR,'manifest.json')));
 verifyV7Snapshot(manifest,f=>fs.readFileSync(path.join(BASELINE_DIR,f)));
 const data=trainingProvenance();verifyDataProvenance(manifest.data_provenance,data);
 const previous=JSON.parse(fs.readFileSync(path.join(BASELINE_DIR,'model.json')));
 verifyDataProvenance(data,previous.data_provenance);
 const oldEngine=await import(pathToFileURL(path.join(BASELINE_DIR,'engine.mjs')).href);
 const engine=await import('../lib/engine.mjs');
 const {loadFrozenModel}=await import('../server.mjs');const current=loadFrozenModel();
 if(previous.detector_rule_version!==BASELINE||oldEngine.DETECTOR_RULE_VERSION!==BASELINE||current.detector_rule_version!=='scoped-communication-recall-v8')throw Error('Expected frozen v7 and retrained changed engine');
 verifyDataProvenance(data,current.data_provenance);
 const inputs=readDevelopmentData(),old=selectionData(oldEngine,previous,inputs),fresh=selectionData(engine,current,inputs);
 const oldMetrics=oldEngine.researchInternals.metrics,newMetrics=engine.researchInternals.metrics;
 const before=oldMetrics(old.validation,old.fit),after=newMetrics(fresh.validation,fresh.fit);
 verifyNativeMetrics(before,previous.validation_metrics);verifyNativeMetrics(after,current.validation_metrics);
 const report={schema_version:1,baseline_version:BASELINE,current_version:current.detector_rule_version,
 baseline_manifest_sha256:sha(fs.readFileSync(path.join(BASELINE_DIR,'manifest.json'))),baseline_files_sha256:manifest.files,current_source_sha256:ruleProvenance(),data_provenance:data,
 evaluation_contract:{evaluation_kind:'development_forecast_weak_report_proxy_comparison',independent_holdout:false,independent_gold_available:false,split_unchanged:true,fit_on_training_only:true,normalization_fit_on_training_only:true,test_input_used:false,test_gold_used:false,silver_annotations_added_to_training:false,hyperparameters:'Each version uses its original-grid validation-selected lambda; validation has been used for development.',target:'Detector-derived next-seven-day military-action report proxy, not independently verified events.',comparison_limit:'Compare common windows with both fixed label definitions; native windows/targets may change. Small dependent samples do not establish significance or generalization.'},
 native:{before:{rule_version:BASELINE,train_windows:old.train.length,validation_cases:new Set(old.validation.map(r=>r.case_id)).size,lambda:previous.forecast.lambda,metrics:before},after:{rule_version:current.detector_rule_version,train_windows:fresh.train.length,validation_cases:new Set(fresh.validation.map(r=>r.case_id)).size,lambda:current.forecast.lambda,metrics:after}},
 ...compareSelections(old,fresh,oldMetrics,newMetrics),
 validation_predictions:[...new Set([...old.byKey.keys(),...fresh.byKey.keys()])].sort().map(key=>{const a=old.byKey.get(key),b=fresh.byKey.get(key);return {key,before:a?{label:a.y,probability:oldEngine.researchInternals.forecastProbability(old.fit,a.x),persistence:a.persistence}:null,after:b?{label:b.y,probability:engine.researchInternals.forecastProbability(fresh.fit,b.x),persistence:b.persistence}:null};})};
 const output=path.join(PROJECT_ROOT,'research/validation-comparison-v8.json');fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');return {...report,output};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(process.argv.length>2)throw Error('Usage: node scripts/compare-validation-v8.mjs');const r=await compareValidationV8();console.log(JSON.stringify({native:r.native,common_windows:r.common_windows,output:r.output},null,2));}

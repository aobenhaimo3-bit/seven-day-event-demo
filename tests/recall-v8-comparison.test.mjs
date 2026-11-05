import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyV7Snapshot,BASELINE} from '../scripts/compare-validation-v8.mjs';
import {compareRecognition} from '../scripts/report-recall-v8.mjs';
const names=['engine.mjs','assertions.mjs','temporal.mjs','event-relations.mjs','action-vocabulary.mjs','communication.mjs','scope.mjs','model.json','model-report.json','recognition.json','recognition-summary.json'];
test('v8 baseline protects all eleven v7 snapshot files including transitive modules',()=>{
 const files=Object.fromEntries(names.map(n=>[n,createHash('sha256').update(n).digest('hex')]));
 verifyV7Snapshot({version:BASELINE,files},n=>n);
 for(const file of names)assert.throws(()=>verifyV7Snapshot({version:BASELINE,files},n=>n===file?'changed':n),/changed/);
 for(const file of names){const changed={...files};delete changed[file];assert.throws(()=>verifyV7Snapshot({version:BASELINE,files:changed},n=>n),/manifest/);}
 assert.throws(()=>verifyV7Snapshot({version:BASELINE,files:{...files,extra:'hash'}},n=>n),/manifest/);
});
const labels={relevance:true,action:false,threat:true,posture:false,cooperation:true};
const before=()=>({cohort_sha256:'fixed',annotation_sha256:'fixedlabels',predictions:[{pair_id:'x',case_id:'C',dataset:'D',publisher:'P',source_sha256:'xsource',labels:{...labels},prediction:{...labels,threat:false}},{pair_id:'y',case_id:'C',dataset:'D',publisher:'P',source_sha256:'ysource',labels:{...labels,threat:false},prediction:{...labels,threat:false}}]});
test('recall gains retain newly introduced false positives and field denominators',()=>{
 const a=before(),b=structuredClone(a);b.predictions[0].prediction.threat=true;b.predictions[1].prediction.threat=true;
 const r=compareRecognition(a,b);assert.equal(r.before.metrics.threat.fn,1);assert.equal(r.after.metrics.threat.fn,0);assert.equal(r.after.metrics.threat.fp,1);assert.equal(r.after.metrics.threat.precision,.5);
 assert.deepEqual(r.changes,{fully_resolved:1,newly_mismatched:1,resolved_field_errors:1,new_field_errors:1});assert.equal(r.by_publisher.P.after.count,2);assert.equal(r.by_case.C.after.count,2);assert.equal(r.by_dataset.D.after.count,2);
});
test('v8 rejects source label cohort identity and nonboolean prediction changes',()=>{
 for(const mutate of [r=>r.cohort_sha256='other',r=>r.annotation_sha256='other',r=>r.predictions.reverse(),r=>r.predictions[0].source_sha256='other',r=>r.predictions[0].labels.threat=false,r=>r.predictions[0].prediction.threat=null,r=>r.predictions[0].prediction.cooperation=undefined,r=>r.predictions[1].pair_id='x']){
  const a=before(),b=structuredClone(a);mutate(b);assert.throws(()=>compareRecognition(a,b));
 }
});

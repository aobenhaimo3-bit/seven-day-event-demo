import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {BASELINE,verifyBaselineFiles,verifyDataProvenance,selectionData,verifyNativeMetrics,compareSelections} from '../scripts/compare-validation-v6.mjs';

test('forecast comparison rejects modified frozen modules and changed development sources',()=>{
 const names=['engine.mjs','assertions.mjs','temporal.mjs','event-relations.mjs','model.json','model-report.json'];
 const files=Object.fromEntries(names.map(n=>[n,createHash('sha256').update(n).digest('hex')]));
 verifyBaselineFiles({version:BASELINE,files},n=>n);
 for(const name of names)assert.throws(()=>verifyBaselineFiles({version:BASELINE,files},n=>n===name?'changed':n),/Frozen v5 baseline changed/);
 const data=Object.fromEntries(['train','validation','pilot','aliases'].map(n=>[n,{path:n,sha256:n}]));
 verifyDataProvenance(data,structuredClone(data));
 for(const name of Object.keys(data)){const changed=structuredClone(data);changed[name].sha256='different';assert.throws(()=>verifyDataProvenance(data,changed),/identical development inputs/);}
});
test('forecast selection refits only training anchors and purges future-trained validation anchors',()=>{
 const train=[{case_id:'train',as_of:'2024-01-01',label_end:'2024-01-08',x:[1],y:1}];
 const validation=['2024-01-08','2024-01-09','2024-01-10'].map(as_of=>({case_id:'valid',as_of,label_end:'2024-01-17',x:[2],y:0}));
 const inputs={trainingCases:[{news_end:'2024-01-09'}],validationCases:[{}]};
 let fitting=null;
 const engine={researchInternals:{rollingSamples:cases=>({samples:cases===inputs.trainingCases?train:validation}),fitLogistic:(rows,lambda)=>{fitting={rows,lambda};return {fresh_train_only:true};}}};
 const model={training_period:{last_label_end:'2024-01-08'},detector:{trained_through:'2024-01-10'},forecast:{lambda:50,weights:['deployment must not be used']}};
 const selected=selectionData(engine,model,inputs);
 assert.equal(fitting.rows,train);assert.equal(fitting.lambda,50);assert.deepEqual(selected.validation.map(r=>r.as_of),['2024-01-10']);assert.equal(selected.fit.fresh_train_only,true);
 assert.throws(()=>selectionData(engine,{...model,training_period:{last_label_end:'2024-01-07'}},inputs),/reconstruction/);
});
test('comparison fixes common windows and labels in both directions while retaining label changes',()=>{
 const make=rows=>({validation:rows,byKey:new Map(rows.map(r=>[`${r.case_id}/${r.as_of}`,r])),fit:{}});
 const a={case_id:'A',as_of:'2024-01-01',x:[1],y:0,persistence:0};
 const b={case_id:'B',as_of:'2024-01-01',x:[2],y:1,persistence:1};
 const c={case_id:'C',as_of:'2024-01-01',x:[3],y:1,persistence:0};
 const old=make([a,b]),fresh=make([{...a,x:[99],y:1},c]);
 const metrics=rows=>rows.map(r=>({x:r.x,y:r.y}));
 const result=compareSelections(old,fresh,metrics,metrics);
 assert.equal(result.common_windows.count,1);assert.equal(result.common_windows.changed_labels,1);
 assert.deepEqual(result.common_windows.evaluated_on_old_labels,{before:[{x:[1],y:0}],after:[{x:[99],y:0}]});
 assert.deepEqual(result.common_windows.evaluated_on_new_labels,{before:[{x:[1],y:1}],after:[{x:[99],y:1}]});
 assert.equal(result.dropped_validation_windows[0].key,'B/2024-01-01');assert.equal(result.added_validation_windows[0].key,'C/2024-01-01');
 assert.equal(old.validation[0].y,0);assert.equal(fresh.validation[0].y,1);
});
test('reconstructed validation must match saved model and both simple baselines',()=>{
 const metrics={sample_count:2,positives:1,negatives:1,brier:.2,log_loss:.4,accuracy:.5,baseline_brier:.25,baseline_log_loss:.7,baseline_accuracy:.5,persistence_brier:.5,confusion:{tp:1,tn:0,fp:1,fn:0}};
 verifyNativeMetrics(metrics,structuredClone(metrics));
 for(const field of Object.keys(metrics)){const changed=structuredClone(metrics);changed[field]=field==='confusion'?{tp:0,tn:1,fp:0,fn:1}:99;assert.throws(()=>verifyNativeMetrics(changed,metrics),/reconstruction mismatch/);}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {FIELDS} from '../scripts/assemble-astra-annotations.mjs';
import {exclusionsFor,evaluateSilver,summarizePredictions,writeFrozen} from '../scripts/evaluate-astra-recognition.mjs';

const labels=patch=>({...Object.fromEntries(FIELDS.map(f=>[f,false])),...patch});
const input=id=>({pair_id:id,dataset:'expansion_160',source_sha256:'test-hash',source:{case:{case_id:'S017'},news:{title:'Synthetic regression fixture',publisher:'Test publisher',date:'2024-01-01'}}});
const annotation=(id,patch={})=>({pair_id:id,labels:labels(patch),quality_flags:[],evidence:[],notes:'test'});
const signals=patch=>({relevant:false,action:false,threat:false,posture:false,cooperation:false,events:[],...patch});

test('silver scoring excludes entire unresolved rows and never coerces null to negative',()=>{
 const inputs=['known','unknown','disagreed','quality','quarantine'].map(input);
 const rows=[annotation('known'),annotation('unknown',{action:null}),annotation('disagreed'),{...annotation('quality'),quality_flags:['source-date']},annotation('quarantine')];
 const secondary=[annotation('disagreed',{relevance:true})];
 const prior=[{pair_id:'quarantine',suggested_disposition:'quarantine_pending_origin_and_scope_review'}];
 const exclusions=exclusionsFor(inputs,rows,secondary,prior);
 assert.equal(exclusions.length,4);
 const predicted=[];
 const result=evaluateSilver(inputs,rows,exclusions,i=>{predicted.push(i.pair_id);return signals();});
 assert.deepEqual(predicted,['known']);assert.equal(result.summary.count,1);assert.equal(result.summary.metrics.action.tn,1);assert.equal(result.summary.exact_match_count,1);
 assert.equal(rows[1].labels.action,null);
});

test('quarantine overlaps count once and source findings never overwrite model labels',()=>{
 const i=input('overlap'),r={...annotation('overlap',{relevance:true,action:true}),quality_flags:['date']};
 const exclusions=exclusionsFor([i],[r],[],[{pair_id:'overlap',suggested_disposition:'quarantine_from_case_coverage'}]);
 assert.equal(exclusions.length,1);assert.deepEqual(exclusions[0].reasons,['model_quality_flag','prior_source_scope_quarantine']);assert.equal(r.labels.action,true);
 // Candidate exclusion decisions are not event labels and are not this queue.
 assert.deepEqual(exclusionsFor([i],[{...r,quality_flags:[]}],[],[{pair_id:'overlap',disposition:'exclude'}]),[]);
});

test('unknown and missing predictor values cannot silently become false',()=>{
 for(const bad of [undefined,null,0,'false'])assert.throws(()=>evaluateSilver([input('a')],[annotation('a')],[],()=>signals({action:bad})),/explicit boolean/);
 assert.throws(()=>evaluateSilver([input('a')],[annotation('a',{action:null})],[],()=>signals()),/explicit boolean/);
});

test('per-field confusion denominators and all-five exact agreement differ correctly',()=>{
 const examples=[
  {labels:labels({relevance:true,action:true}),prediction:labels({relevance:true,action:true})},
  {labels:labels({relevance:true,action:true}),prediction:labels({relevance:true})},
  {labels:labels(),prediction:labels({relevance:true,action:true})},
  {labels:labels(),prediction:labels()},
 ];
 const s=summarizePredictions(examples);assert.equal(s.exact_match_count,2);assert.equal(s.exact_match_agreement,.5);
 assert.deepEqual(s.metrics.action,{tp:1,tn:1,fp:1,fn:1,support:4,positive_labels:2,negative_labels:2,precision:.5,recall:.5,f1:.5,agreement:.5});
 assert.equal(s.metrics.relevance.agreement,.75);assert.equal(s.metrics.posture.f1,null);assert.equal(s.metrics.posture.recall,null);assert.equal(s.metrics.posture.agreement,1);
});

test('empty eligible cohort has null metrics, not a perfect score',()=>{
 const s=summarizePredictions([]);assert.equal(s.count,0);assert.equal(s.exact_match_agreement,null);for(const f of FIELDS){assert.equal(s.metrics[f].agreement,null);assert.equal(s.metrics[f].precision,null);assert.equal(s.metrics[f].recall,null);}
});

test('breakdown totals retain source cohort identities rather than mixing media or batches',()=>{
 const inputs=[input('a'),input('b')];inputs[1].dataset='fixed_60';inputs[1].source.case.case_id='S019';inputs[1].source.news.publisher='Second source';
 const result=evaluateSilver(inputs,[annotation('a'),annotation('b')],[],()=>signals());
 assert.equal(result.by_dataset.fixed_60.count,1);assert.equal(result.by_dataset.expansion_160.count,1);assert.equal(result.by_case.S017.count,1);assert.equal(result.by_publisher['Second source'].count,1);assert.deepEqual(result.predictions.map(r=>r.pair_id),['a','b']);
});

test('frozen evaluation manifests can be repeated but not silently replaced',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'astra-recognition-')),file=path.join(dir,'frozen.json');
 try{writeFrozen(file,{ids:['a','b']});assert.doesNotThrow(()=>writeFrozen(file,{ids:['a','b']}));assert.throws(()=>writeFrozen(file,{ids:['a']}),/Frozen evaluation changed/);assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{ids:['a','b']});}
 finally{fs.unlinkSync(file);fs.rmdirSync(dir);}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateAnnotation,validateSet,summarize,validateProtocol,validateSecondaryReviewer} from '../scripts/assemble-astra-annotations.mjs';
import {secondarySelection,secondaryManifest,validateSecondaryInputs} from '../scripts/prepare-astra-secondary.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const input={pair_id:'sample',source:{case:{news_start:'2024-01-01',news_end:'2024-01-31'},news:{title:'Talks in Gaza',text:'The officials held talks on Monday.',date:'2024-01-09'}}};
input.source_sha256=sha(JSON.stringify(input.source));
const row=()=>({pair_id:'sample',source_sha256:input.source_sha256,reviewer_type:'model',model_id:'gpt-6-astra',agent_id:'/root/astra_test',completed_at:'2026-11-04T10:00:00Z',review_status:'model_annotated',labels:{relevance:true,action:false,threat:false,posture:false,cooperation:true},confidence:'high',notes:'报道已举行会谈。',uncertainties:[],quality_flags:[],evidence:[{fields:['relevance','cooperation'],quote:'officials held talks',event_date:'2024-01-08'}]});
test('model annotation retains provenance and cannot masquerade as human review',()=>{assert.doesNotThrow(()=>validateAnnotation(row(),input));for(const patch of [{reviewer_type:'human'},{model_id:'other'},{review_status:'human-reviewed'},{source_sha256:'changed'}])assert.throws(()=>validateAnnotation({...row(),...patch},input));});
test('unknowns stay unknown and do not become negative labels',()=>{const r=row();r.labels.cooperation=null;r.review_status='model_uncertain';r.uncertainties=['时间不明'];validateAnnotation(r,input);assert.equal(summarize([r]).labels.cooperation.uncertain,1);assert.equal(summarize([r]).labels.cooperation.no,0);r.review_status='model_annotated';assert.throws(()=>validateAnnotation(r,input));});
test('fabricated evidence and unsupported positive events fail',()=>{const r=row();r.evidence[0].quote='The army invaded';assert.throws(()=>validateAnnotation(r,input),/Evidence/);const s=row();s.evidence[0].fields=['relevance'];assert.throws(()=>validateAnnotation(s,input),/field evidence/);});
test('historic/future/invalid dates cannot support current positive labels',()=>{for(const date of ['2023-12-01','2024-01-10','2024-02-31']){const r=row();r.evidence[0].event_date=date;assert.throws(()=>validateAnnotation(r,input));}});
test('missing, duplicate and inconsistent annotations fail rather than filling defaults',()=>{assert.throws(()=>validateSet([], [input]));assert.throws(()=>validateSet([row(),row()],[input,{...input,pair_id:'second'}]));const r=row();r.labels.relevance=false;assert.throws(()=>validateAnnotation(r,input));delete r.labels.action;assert.throws(()=>validateAnnotation(r,input));});
test('publication dates, sampling windows and original source hashes are validated',()=>{
 for(const date of ['invalid','2024-02-31','2023-12-31','2024-02-01']){const i=structuredClone(input);i.source.news.date=date;i.source_sha256=sha(JSON.stringify(i.source));const r=row();r.source_sha256=i.source_sha256;r.evidence[0].event_date='1900-01-01';assert.throws(()=>validateAnnotation(r,i),/publication date/);}
 const altered=structuredClone(input);altered.source.news.text+=' changed';assert.throws(()=>validateAnnotation(row(),altered),/content\/hash/);
 assert.throws(()=>validateAnnotation(row(),{...input,original_source_sha256:'wrong'}),/content\/hash/);
 const boundary=row();boundary.evidence[0].event_date='2024-01-02';assert.doesNotThrow(()=>validateAnnotation(boundary,input));boundary.evidence[0].event_date='2024-01-01';assert.throws(()=>validateAnnotation(boundary,input),/seven-day/);
});
test('human review structures cannot be carried through model exports',()=>{
 for(const patch of [{reviews:[{reviewer_type:'human'}]},{adjudication:{reviewer_type:'human'}},{human_reviewer:null}])assert.throws(()=>validateAnnotation({...row(),...patch},input),/human review structure/);
 const r=row();r.evidence[0].reviews=[{reviewer_type:'human'}];assert.throws(()=>validateAnnotation(r,input),/metadata/);
});
test('every annotation needs thematic evidence, including irrelevant rows',()=>{
 const r=row();r.evidence[0].fields=['cooperation'];assert.throws(()=>validateAnnotation(r,input),/relevance field/);
 r.labels=Object.fromEntries(Object.keys(r.labels).map(k=>[k,false]));assert.throws(()=>validateAnnotation(r,input),/relevance field/);
});
test('protocol verification rejects changed instructions',()=>{validateProtocol('original',sha('original'));assert.throws(()=>validateProtocol('changed',sha('original')),/protocol changed/);});
test('secondary records must retain the designated non-self-review agent',()=>{validateSecondaryReviewer([{agent_id:'/root/astra_southasia'}]);assert.throws(()=>validateSecondaryReviewer([{agent_id:'/root/astra_syria_congo'}]),/secondary reviewer/);});
test('secondary sample is deterministic, source-bound and excludes self-reviewed S020',()=>{
 const inputs=['S016','S017','S018','S019','S020'].flatMap(c=>['fixed_60','expansion_160'].flatMap(dataset=>Array.from({length:4},(_,j)=>({...structuredClone(input),pair_id:c+dataset+j,dataset,source:{...structuredClone(input.source),case:{...input.source.case,case_id:c}}}))));
 const selected=secondarySelection(inputs),manifest=secondaryManifest(inputs,selected);
 assert.equal(selected.length,20);assert.ok(selected.every(r=>r.source.case.case_id!=='S020'));assert.deepEqual(secondarySelection([...inputs].reverse()),selected);validateSecondaryInputs(inputs,selected,manifest);
 const changed=structuredClone(selected);changed[0].source.news.text='Different source with same ID';changed[0].source_sha256=sha(JSON.stringify(changed[0].source));assert.throws(()=>validateSecondaryInputs(inputs,changed,manifest),/canonical selection/);
 const replacement=inputs.find(r=>!selected.some(s=>s.pair_id===r.pair_id));assert.throws(()=>validateSecondaryInputs(inputs,[replacement,...selected.slice(1)],manifest),/canonical selection/);
 assert.throws(()=>validateSecondaryInputs(inputs,selected,{...manifest,agent_id:'/root/astra_other'}),/manifest mismatch/);
});

import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const FIELDS=['relevance','action','threat','posture','cooperation'];
const read=(dir,n)=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));
const lines=(dir,n)=>fs.readFileSync(path.join(dir,n),'utf8').trim().split(/\r?\n/).map(JSON.parse);
export function verifyReferenceAnnotations(dir=path.join(ROOT,'research/astra-annotations-v1')){
 const manifest=read(dir,'manifest.json');
 const required=['annotations.jsonl','secondary-annotations.jsonl','sources.json','annotation-report.json','review-queue.json','recognition-cohort.json','Astra-model-annotations.xlsx','reference.html'];
 if(manifest.kind!=='public_model_annotation_reference'||manifest.model_id!=='gpt-6-astra'||manifest.human_reviewed!==0||JSON.stringify(Object.keys(manifest.files).sort())!==JSON.stringify(required.sort()))throw Error('Invalid public reference manifest');
 for(const [name,meta]of Object.entries(manifest.files)){const b=fs.readFileSync(path.join(dir,name));if(b.length!==meta.bytes||hash(b)!==meta.sha256)throw Error('Reference file changed: '+name);}
 if(hash(fs.readFileSync(path.join(ROOT,manifest.protocol_path)))!==manifest.protocol_sha256)throw Error('Annotation protocol changed');
 const rows=lines(dir,'annotations.jsonl'),secondary=lines(dir,'secondary-annotations.jsonl'),sources=read(dir,'sources.json'),report=read(dir,'annotation-report.json'),queue=read(dir,'review-queue.json'),cohort=read(dir,'recognition-cohort.json');
 if(rows.length!==220||secondary.length!==20||sources.length!==220||queue.length!==37||report.human_reviewed!==0||cohort.eligible_pair_ids.length!==179)throw Error('Reference counts/provenance mismatch');
 if(new Set(rows.map(r=>r.pair_id)).size!==220||new Set(sources.map(r=>r.pair_id)).size!==220||new Set(secondary.map(r=>r.pair_id)).size!==20)throw Error('Duplicate reference identifiers');
 const byId=new Map(sources.map(r=>[r.pair_id,r]));
 const primaryById=new Map(rows.map(r=>[r.pair_id,r]));
 for(const r of [...rows,...secondary]){
  if(r.reviewer_type!=='model'||r.model_id!=='gpt-6-astra'||r.source_sha256!==byId.get(r.pair_id)?.source_sha256||FIELDS.some(f=>![true,false,null].includes(r.labels?.[f]))||Object.hasOwn(r,'human_reviewer')||Object.hasOwn(r,'reviews')||Object.hasOwn(r,'adjudication'))throw Error('Invalid label provenance: '+r.pair_id);
  if(r.labels.relevance===false&&FIELDS.slice(1).some(f=>r.labels[f]!==false))throw Error('Inconsistent irrelevant row');
  if(r.review_status!==(FIELDS.some(f=>r.labels[f]===null)?'model_uncertain':'model_annotated'))throw Error('Uncertainty lost');
 }
 if(sources.some(r=>'text'in r.news||'source'in r))throw Error('Reference source index must contain metadata only');
 const uncertain=rows.filter(r=>FIELDS.some(f=>r.labels[f]===null)).length;
 const unknownCells=rows.reduce((s,r)=>s+FIELDS.filter(f=>r.labels[f]===null).length,0);
 const disagreements=secondary.filter(r=>FIELDS.some(f=>r.labels[f]!==primaryById.get(r.pair_id).labels[f])).length;
 if(uncertain!==31||unknownCells!==39||disagreements!==6||report.priority_review_count!==queue.length)throw Error('Reference summary mismatch');
 const annotationHash=hash(rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
 if(annotationHash!==manifest.annotation_sha256||annotationHash!==report.annotation_sha256||cohort.annotation_sha256!==annotationHash||cohort.input_sha256!==manifest.input_sha256)throw Error('Frozen annotation hash changed');
 if(sources.filter(r=>r.evaluation_exclusion_reasons.length).length!==41||(fs.readFileSync(path.join(dir,'reference.html'),'utf8').match(/<article /g)||[]).length!==220)throw Error('Reference index incomplete');
 return {records:220,secondary_records:20,uncertain_records:uncertain,null_labels:unknownCells,model_review_queue:queue.length,secondary_disagreements:disagreements,scored_records:179,human_reviewed:0,files_verified:required.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyReferenceAnnotations(),null,2));

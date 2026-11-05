import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const sha=s=>createHash('sha256').update(s).digest('hex');
export const SECONDARY_AGENT='/root/astra_southasia';
export function secondarySelection(inputs){
 return ['S016','S017','S018','S019'].flatMap(c=>[['fixed_60',2],['expansion_160',3]].flatMap(([d,n])=>{
  const pool=inputs.filter(r=>r.source.case.case_id===c&&r.dataset===d).sort((a,b)=>sha('astra-blind-check-v1|'+a.pair_id).localeCompare(sha('astra-blind-check-v1|'+b.pair_id)));
  if(pool.length<n)throw Error('Insufficient secondary sampling stratum: '+c+' '+d);
  return pool.slice(0,n);
 }));
}
export function secondaryManifest(inputs,secondaryInputs){
 const expected=secondarySelection(inputs);
 if(JSON.stringify(expected)!==JSON.stringify(secondaryInputs))throw Error('Secondary inputs differ from deterministic canonical selection');
 return {schema_version:1,kind:'same_model_blind_spot_check_not_independent_human_review',agent_id:SECONDARY_AGENT,selection_rule:"Each S016–S019: 2 fixed_60 + 3 expansion_160, ascending SHA256('astra-blind-check-v1|'+pair_id)",excluded_case:'S020',exclusion_reason:'Secondary agent annotated S020 in the first round; excluded to avoid self-review.',input_sha256:sha(JSON.stringify(inputs)),secondary_input_sha256:sha(JSON.stringify(secondaryInputs)),pair_ids:expected.map(r=>r.pair_id)};
}
export function validateSecondaryInputs(inputs,secondaryInputs,manifest){
 const expected=secondaryManifest(inputs,secondaryInputs);
 if(JSON.stringify(expected)!==JSON.stringify(manifest))throw Error('Frozen secondary manifest mismatch');
}
export function prepareSecondary(){
 const dir=path.join(ROOT,'local-data/model-annotation/astra-v1');
 const inputs=JSON.parse(fs.readFileSync(path.join(dir,'input.json')));
 const primaryManifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
 if(sha(JSON.stringify(inputs))!==primaryManifest.input_sha256)throw Error('Frozen primary inputs changed');
 // Never overwrite the already reviewed inputs or annotations.
 const secondaryInputs=JSON.parse(fs.readFileSync(path.join(dir,'secondary-input.json')));
 const serialized=JSON.stringify(secondaryManifest(inputs,secondaryInputs),null,2)+'\n';
 const out=path.join(dir,'secondary-manifest.json');
 if(fs.existsSync(out)){if(fs.readFileSync(out,'utf8')!==serialized)throw Error('Refuse changed frozen secondary manifest');}
 else fs.writeFileSync(out,serialized,{flag:'wx'});
 console.log('Validated and froze 20 canonical secondary inputs; S020 excluded to avoid self-review.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))prepareSecondary();

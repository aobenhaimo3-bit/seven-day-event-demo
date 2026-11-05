import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PROJECT_ROOT,MODEL_PATH,ruleProvenance,trainingProvenance} from '../lib/data.mjs';
import {loadFrozenModel} from '../server.mjs';
const dir=path.join(PROJECT_ROOT,'research/baselines/event-context-coverage-v5');
const digest=b=>createHash('sha256').update(b).digest('hex');
if(fs.existsSync(path.join(dir,'manifest.json'))){
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
 for(const [name,hash] of Object.entries(manifest.files))if(digest(fs.readFileSync(path.join(dir,name)))!==hash)throw Error('Frozen baseline changed: '+name);
 console.log('Existing v5 baseline verified; preserved.');
}else{
 const model=loadFrozenModel();
 if(model.detector_rule_version!=='event-context-coverage-v5')throw Error('Only the current v5 can initialize this baseline');
 fs.mkdirSync(dir,{recursive:true});
 const files={};
 for(const name of ['engine','assertions','temporal','event-relations']){const bytes=fs.readFileSync(path.join(PROJECT_ROOT,`lib/${name}.mjs`));fs.writeFileSync(path.join(dir,`${name}.mjs`),bytes,{flag:'wx'});files[`${name}.mjs`]=digest(bytes);}
 for(const [name,source] of [['model.json',MODEL_PATH],['model-report.json',path.join(PROJECT_ROOT,'artifacts/model-report.json')]]){const bytes=fs.readFileSync(source);fs.writeFileSync(path.join(dir,name),bytes,{flag:'wx'});files[name]=digest(bytes);}
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({version:'event-context-coverage-v5',files,rule_source_sha256:ruleProvenance(),data_provenance:trainingProvenance(),note:'Frozen before inspecting Astra classifier disagreements; model includes deployment validation refit, so forecast comparisons must refit on train only.'},null,2)+'\n',{flag:'wx'});
 console.log('Frozen v5 engine, dependencies and trained model.');
}

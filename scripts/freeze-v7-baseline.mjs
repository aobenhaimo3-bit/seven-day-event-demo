import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PROJECT_ROOT,MODEL_PATH,ruleProvenance,trainingProvenance} from '../lib/data.mjs';
import {loadFrozenModel} from '../server.mjs';
const dir=path.join(PROJECT_ROOT,'research/baselines/scoped-event-recall-v7'),sha=b=>createHash('sha256').update(b).digest('hex');
const file=path.join(dir,'manifest.json');
if(fs.existsSync(file)){
 const m=JSON.parse(fs.readFileSync(file));for(const [p,h]of Object.entries(m.files))if(sha(fs.readFileSync(path.join(dir,p)))!==h)throw Error('Changed v7 snapshot: '+p);
 console.log('Verified existing v7 baseline.');
}else{
 const model=loadFrozenModel();if(model.detector_rule_version!=='scoped-event-recall-v7')throw Error('Expected intact v7 model');
 fs.mkdirSync(dir,{recursive:true});const files={};
 for(const [name,source]of [...Object.keys(ruleProvenance()).map(p=>[path.basename(p),path.join(PROJECT_ROOT,p)]),['model.json',MODEL_PATH],['model-report.json',path.join(PROJECT_ROOT,'artifacts/model-report.json')],['recognition.json',path.join(PROJECT_ROOT,'local-data/model-annotation/astra-v1/recognition-current.json')],['recognition-summary.json',path.join(PROJECT_ROOT,'research/astra-recognition-current.json')]]){
  const b=fs.readFileSync(source);fs.writeFileSync(path.join(dir,name),b,{flag:'wx'});files[name]=sha(b);
 }
 fs.writeFileSync(file,JSON.stringify({version:model.detector_rule_version,files,rule_source_sha256:ruleProvenance(),data_provenance:trainingProvenance()},null,2)+'\n',{flag:'wx'});
 console.log('Frozen v7 modules, model and recognition results.');
}

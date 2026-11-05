import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PROJECT_ROOT,MODEL_PATH,trainingProvenance,ruleProvenance} from '../lib/data.mjs';
import {loadFrozenModel} from '../server.mjs';
const dir=path.join(PROJECT_ROOT,'research/baselines/full-text-multisignal-v6');
const sha=b=>createHash('sha256').update(b).digest('hex');
const manifestPath=path.join(dir,'manifest.json');
if(fs.existsSync(manifestPath)){
 const manifest=JSON.parse(fs.readFileSync(manifestPath));
 for(const [file,hash] of Object.entries(manifest.files))if(sha(fs.readFileSync(path.join(dir,file)))!==hash)throw Error('v6 baseline changed: '+file);
 console.log('Existing v6 snapshot verified.');
}else{
 const model=loadFrozenModel();if(model.detector_rule_version!=='full-text-multisignal-v6')throw Error('Expected intact v6');
 fs.mkdirSync(dir,{recursive:true});const files={};
 for(const [file,source] of [...['engine','assertions','temporal','event-relations'].map(n=>[n+'.mjs',path.join(PROJECT_ROOT,'lib',n+'.mjs')]),['model.json',MODEL_PATH],['model-report.json',path.join(PROJECT_ROOT,'artifacts/model-report.json')],['recognition.json',path.join(PROJECT_ROOT,'local-data/model-annotation/astra-v1/recognition-current.json')],['recognition-summary.json',path.join(PROJECT_ROOT,'research/astra-recognition-current.json')]]){
  const bytes=fs.readFileSync(source);fs.writeFileSync(path.join(dir,file),bytes,{flag:'wx'});files[file]=sha(bytes);
 }
 fs.writeFileSync(manifestPath,JSON.stringify({version:model.detector_rule_version,files,rule_source_sha256:ruleProvenance(),data_provenance:trainingProvenance()},null,2)+'\n',{flag:'wx'});
 console.log('Frozen v6 code, model and recognition results.');
}

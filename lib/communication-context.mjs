import {phraseHit,caseEntityHit,REGIONAL_SECURITY_POLICIES} from './scope.mjs';
const ROLE=String.raw`(?:Secretary(?:-General| of State)?|Foreign Minister|President|Prime Minister|spokesman|spokeswoman|spokesperson|envoy|coordinator|official|chief)`;
const NAME=String.raw`([A-Z][A-Za-z’'-]+(?:\s+[A-Z][A-Za-z’'-]+){1,3})`;
const STOP=new Set(['United States','United Nations','Security Council','White House','Central Command','Human Rights','Foreign Minister']);
const INSTITUTIONS={S019:['UNRWA'],S017:['MONUSCO']};
export function communicationTopicAllowed(text,isScoped){
 const foreign=/\b(?:Ukrainian|Taiwanese)\s+(?:President|Prime Minister|Foreign Minister)\b|\b(?:about|regarding|to end)\s+(?:the war in\s+)?(?:Ukraine|Taiwan|Sudan|Afghanistan)\b/i.test(String(text));
 return !foreign||isScoped(String(text));
}
export function communicationSubjectAllowed(caseRecord,text,{bindings=[],isScoped,aliases}={}){
 const report=/\b(?:said|says|stated|reported|explained|announced)\s+(?:that\s+)?(?=[A-Z][a-z])/.exec(String(text));
 if(!report)return true;
 const proposition=String(text).slice(report.index+report[0].length);
 return isScoped(proposition)||caseEntityHit(caseRecord,proposition,aliases)||bindings.some(e=>phraseHit(proposition,e.term));
}
export function buildCommunicationBindings(chunks,isScoped){
 const entries=[];
 for(const text of chunks){
  if(!isScoped(text))continue;
  const add=(term,kind)=>{if(term.length<4||STOP.has(term)||entries.some(e=>e.term===term))return;entries.push({term,kind,evidence:text});};
  for(const re of [new RegExp(`\\b${ROLE}\\s*,?\\s*${NAME}`,'g'),new RegExp(`\\b${NAME},\\s+(?:the )?[^.!?]{0,45}\\b${ROLE}\\b`,'g')])for(const m of text.matchAll(re)){
   const full=m[1].trim();add(full,'named_official');const last=full.split(/\s+/).at(-1);if(last.length>=5)add(last,'named_official');
  }
  for(const m of text.matchAll(/(?:\bor\s+|\()([A-Z]{3,8})(?:\)|\b)/g))if(!['UNHCR','UNRWA','UNSC','USA','NATO'].includes(m[1]))add(m[1],'defined_institution');
 }
 return entries;
}
export function communicationBinding(caseRecord,text,{bindings=[],nearbyText='',isScoped,aliases}={}){
 const local=String(text),policy=REGIONAL_SECURITY_POLICIES[caseRecord.case_id];
 if(!communicationTopicAllowed(local,isScoped))return null;
 if(!communicationSubjectAllowed(caseRecord,local,{bindings,isScoped,aliases}))return null;
 // Explicitly changing the negotiation topic cannot borrow an earlier topic.
 const different=/\b(?:about|over|regarding|in|on|toward|to end)\s+(?:(?:the|a|war|conflict|situation|talks)\s+){0,3}(?:Ukraine|Taiwan|Sudan|Afghanistan|Iran|Iraq|China|Russia)\b|\b(?:Ukrainian|Taiwanese)\s+(?:President|Prime Minister|Foreign Minister)\b/i.test(local);
 if(different&&!isScoped(local))return null;
 const hit=bindings.find(e=>phraseHit(local,e.term));
 if(hit)return hit;
 const institution=(INSTITUTIONS[caseRecord.case_id]||[]).find(p=>phraseHit(nearbyText,p));
 if(institution&&/\b(?:this matter|the situation|the investigation|this issue)\b/i.test(local)&&/\b(?:minister|Secretary|chief|official|spoke with|met with)\b/i.test(local))return {kind:'explicit_topic_reference',term:institution,evidence:nearbyText};
 if(policy&&nearbyText&&isScoped(nearbyText)&&caseEntityHit(caseRecord,local,aliases))return {kind:'same_sentence_case_actor',term:caseRecord.case_id,evidence:nearbyText};
 return null;
}

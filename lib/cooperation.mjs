// Diplomatic interaction candidates. Case and time validation belong to the caller.
export const COOPERATION_EXPRESSION=String.raw`talks|negotiat\w*|mediat\w*|meetings?|met(?: with)?|meets?(?: with)?|peace agreement|ceasefire agreement|(?:phone|telephone) calls?|calls? (?:over|with)|call(?:ed|s)? (?:his|her|their) counterparts?|spoke with|brief(?:ed|ing) (?:the |member |UN |United Nations )?(?:states|council|officials|members)|briefing|(?:Security Council|UNSC) (?:issued|adopted|passed|vetoed|discussed|debated|considered)|(?:issue[ds]?|adopt(?:ed|s)?|veto(?:ed|es)?) (?:its own |a |the )?(?:Security Council )?resolution|signed (?:a |the )?(?:memorandum|agreement)|diplomatic (?:push|efforts|consultations)`;
export const COOPERATION_PATTERN=new RegExp(`\\b(?:${COOPERATION_EXPRESSION})\\b`,'i');
const MILITARY=/\b(?:military|armed|forces|troops|war|air[ -]?strikes?|attacks?|bomb\w*|missiles?|rockets?|naval|warships?|hostages?|captives?|houthi\w*|hamas|isis|isil|rebels|militants|combat|aggression)\b/i;
const ACTIVITY=/\b(?:held|hold|holding|conducted|conducting|resumed|resume|restarted|restarting|continued|continues|continuing|ongoing|underway|began|begun|launched|started|engaged)\b|\bin progress\b/i;
function localFrame(text,index){
 const prefix=text.slice(0,index);
 const boundaries=[...prefix.matchAll(/;\s*|\b(?:but|while|whereas|even as)\s+|\bas\s+(?=(?:the |[A-Z]))/g)];
 const start=boundaries.at(-1);return text.slice(start?start.index+start[0].length:0);
}
export function cooperationDecision(sentence,{baseStatus='unknown',contextText=''}={}){
 const text=String(sentence),military_context=MILITARY.test(text+' '+contextText);
 const out=(status,reason)=>({status,reason,military_context});
 if(!COOPERATION_PATTERN.test(text))return out('unknown','no diplomatic interaction');
 const normalized=text.replace(/[“”"‘’]/g,'');
 if(/\b(?:met|meets?|meeting)\s+(?:(?:its|their|the|a|our)\s+)?(?:mandate|obligations?|requirements?|standards?|criteria|deadlines?|targets?|needs?)\b/i.test(text))return out('unknown','fulfilling a requirement is not diplomatic interaction');
 if(/\b(?:previous|past|earlier)\s+meetings?\b[^.!?]{0,100}\b(?:failed|had|have|were)\b/i.test(text)&&!/\b(?:today|yesterday|this week|\d+ days? ago|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(text))return out('unknown','undated retrospective meeting summary');
 if(/\b(?:met|meet|meeting)\b[^.!?]{0,55}\b(?:childhood friend|old friend|family|relatives?|birthday|school reunion)\b/i.test(text)&&!/\b(?:official talks|diplomatic|negotiations|delegation)\b/i.test(text))return out('unknown','private social contact does not establish diplomacy');
 if(/\bmeet\s+(?:\w+\s+){0,2}escalation\s+with\b|\b(?:was|were|is|are|been)\s+met\s+with\s+(?:(?:harsh|violent|brutal|live|armed)\s+){0,3}(?:beatings?|bullets?|fire|violence|repression)\b/i.test(normalized))return out('unknown','opposition or violence is not diplomatic interaction');
 if(/\b(?:met|meets?|meeting)\s+(?:the\s+)?(?:requirements?|standards?|criteria|targets?|deadlines?|needs?|demand)\b/i.test(text))return out('unknown','non-interpersonal meaning of meet');
 if(/\b(?:we|I)\s+(?:had\s+)?(?:last\s+)?met\b/i.test(text)&&!/\b(?:minister|president|officials?|diplomats?|delegations?|negotiat\w*|talks|ambassador|envoy)\b/i.test(text))return out('unknown','private recollection does not establish diplomacy');
 const candidates=[...text.matchAll(new RegExp(`\\b(?:${COOPERATION_EXPRESSION})\\b`,'gi'))];
 const decisions=candidates.map(m=>{
  const local=localFrame(text,m.index),offset=text.length-local.length,prefix=text.slice(offset,m.index),suffix=text.slice(m.index+m[0].length),mention=m[0];
  if(/\b(?:denied|refuted|unconfirmed)\b/i.test(prefix)||/^\s+(?:was|were|is|are)\s+(?:denied|disputed)\b/i.test(suffix))return 'disputed';
  if(/\b(?:did not|does not|never|have not|has not|had not|not to|refused to|declined to)\b/i.test(prefix)||/^\s+(?:(?:was|were|is|are)\s+)?(?:cancelled|canceled|called off|not held|never held)\b/i.test(suffix))return 'negated';
  if(/\b(?:cancel\w*|called off|failed to (?:meet|hold))\b/i.test(local)&&!/\b(?:held talks|met with|spoke with)\b[^.!?]{0,45}\b(?:and|before|but)\b/i.test(local))return 'negated';
  if(/^meet(?: with)?$/i.test(mention)&&/\bto\s*$/i.test(prefix))return 'planned';
  if(/\b(?:will|would|could|might|may|to meet|plans? to|planning|planned|scheduled|expected|proposed|upcoming|invitation|called for|call for|urged|requested)\b/i.test(prefix)||/^\s+(?:(?:is|are|was|were)\s+)?(?:planned|scheduled|proposed|expected)\b|^\s+(?:will|would|could|may|might)\s+(?:be\b|take place\b|happen\b|occur\b)/i.test(suffix))return 'planned';
  if(/\b(?:peace|ceasefire) agreement\b/i.test(mention)&&!/\bsigned\b/i.test(prefix))return 'unknown';
  if(/^(?:talks|negotiat|mediat)/i.test(mention)&&!ACTIVITY.test(local)&&!/\b(?:is|are|was|were|has|have)\s+(?:been\s+)?negotiat/i.test(local))return 'unknown';
  if(/diplomatic (?:push|efforts|consultations)/i.test(mention)&&!ACTIVITY.test(local)&&!/\brenewed\b/i.test(local))return 'unknown';
  if(/\b(?:upcoming|invitation|declining|declined)\b/i.test(local)&&!/\b(?:held talks|met with|spoke with|have signed|has signed)\b/i.test(local))return 'planned';
  if(['negated','disputed'].includes(baseStatus)&&offset===0)return baseStatus;
  return 'asserted';
 });
 // An actual interaction may coexist with a later proposal. Each candidate is
 // checked locally so a modal governing another event cannot erase it.
 for(const status of ['asserted','disputed','negated','planned'])if(decisions.includes(status))return out(status,status==='asserted'?'actual local diplomatic interaction':'local interaction '+status);
 return out('unknown','mention does not establish an actual diplomatic interaction');
}

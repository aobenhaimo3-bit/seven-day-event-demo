// Communication is an event at the time of speaking; the threatened attack
// can still be conditional or future. Context must already be case-scoped.
export const THREAT_EXPRESSION=String.raw`threats?|threaten\w*|warn\w*|vow\w*|ultimatum|pledge\w*|promis\w*|pay(?:s)? (?:the |a |the full )?price|consequences|retaliat\w*|hunt down|miserable fate|will respond|(?:will|shall|would) (?:be )?(?:target\w*|attack\w*|strik\w*|destroy\w*|obliterat\w*|escalat\w*)|will (?:continue|resume)|limit (?:their |our |its )?attacks[^.!?]{0,70}\bto\b|resumption of (?:our |the )?attacks|all hell`;
export const COOPERATION_EXPRESSION=String.raw`talks|negotiat\w*|mediat\w*|meetings?|met(?: with)?|meets?(?: with)?|peace agreement|ceasefire agreement|(?:phone|telephone) calls?|calls? (?:over|with)|call(?:ed|s)? (?:his|her|their) counterparts?|spoke with|brief(?:ed|ing) (?:the |member |UN |United Nations )?(?:states|council|officials|members)|briefing|(?:Security Council|UNSC) (?:issued|adopted|passed|vetoed|discussed|debated|considered)|(?:issued|adopted|vetoed) (?:its own |a |the )?(?:Security Council )?resolution|signed (?:a |the )?(?:memorandum|agreement)|diplomatic (?:push|efforts|consultations)`;
export const THREAT_PATTERN=new RegExp(`\\b(?:${THREAT_EXPRESSION})\\b`,'i');
export const COOPERATION_PATTERN=new RegExp(`\\b(?:${COOPERATION_EXPRESSION})\\b`,'i');
const MILITARY=/\b(?:military|armed|forces|troops|war|air[ -]?strikes?|attacks?|bomb\w*|missiles?|rockets?|naval|warships?|hostages?|captives?|houthi\w*|hamas|isis|isil|rebels|militants|combat|aggression)\b/i;
const SPEECH=/\b(?:said|says|stated|announced|threaten\w*|warn\w*|vow\w*|pledged|promised|issued|issues|told|declared|statement|message|speech)\b/i;
const PREDICTION=/\b(?:analysts?|experts?|researchers?|observers?|humanitarian|aid (?:groups?|agencies)|WHO|health officials?)\b[^.!?]{0,70}\b(?:warn\w*|predict\w*|expect\w*|fear\w*|say|said|says)\b/i;
export function communicationDecision(sentence,{kind,baseStatus='unknown',contextText=''}={}){
 const text=String(sentence),military_context=MILITARY.test(text+' '+contextText);
 if(kind==='threat'){
  if(!THREAT_PATTERN.test(text)||!military_context||PREDICTION.test(text))return {status:'unknown',reason:'no actual military threat utterance',military_context};
  if(/\b(?:poses?|presents?|represents?|is|are|remains?)\s+(?:(?:a|the|an|serious|significant|growing|military|major|direct)\s+){0,4}threat\b/i.test(text)&&!/\b(?:warn\w*|threaten\w*|vow\w*|pledged|issued (?:a |the )?threat)\b/i.test(text))return {status:'unknown',reason:'describing a danger is not issuing a threat',military_context};
  if(/\b(?:efforts?|aims?|attempts?|campaign|purpose)\s+to\s+(?:\w+\s+){0,3}(?:degrade|threaten|destroy|defeat)\b/i.test(text)&&!/\b(?:warn\w*|vow\w*|pledged|promised|will|shall)\b/i.test(text))return {status:'unknown',reason:'purpose or explanation does not establish a new threat utterance',military_context};
  if(/\b(?:legal|economic|financial|humanitarian|health|climate) (?:consequences|threat|risk|price)\b/i.test(text)&&!MILITARY.test(text))return {status:'unknown',reason:'nonmilitary warning',military_context};
  if(['negated','disputed'].includes(baseStatus))return {status:baseStatus,reason:'utterance denied or disputed',military_context};
  if(/\b(?:will|would|may|might|could|plans? to|planning to)\s+(?:soon\s+)?(?:warn|threaten|vow|pledge|issue)\b/i.test(text))return {status:'planned',reason:'speech act itself is prospective',military_context};
  // Conditional force is the content of an actual utterance, not a condition
  // on whether the utterance took place.
  const content=/\b(?:threats?|attacks?|air[ -]?strikes?|naval operations|military operations|retaliat\w*|hunt down|obliterat\w*|target\w*|pay(?:s)? (?:the |a |the full )?price|all hell|miserable fate|degrade|escalat\w*)\b/i.test(text);
  const reported=SPEECH.test(text)||/\b(?:said|warned|announced|declared|vowed|pledged)\s*[:.!?“"']*\s*$/i.test(contextText);
  if(reported&&content)return {status:'asserted',reason:'actual military warning or commitment; attack remains prospective',military_context};
  return {status:baseStatus==='asserted'?'unknown':baseStatus,reason:'no explicit actual speech act',military_context};
 }
 if(kind==='cooperation'){
  if(!COOPERATION_PATTERN.test(text))return {status:'unknown',reason:'no diplomatic interaction',military_context};
  if(/\bmeet\s+(?:\w+\s+){0,2}escalation\s+with\b|\b(?:was|were|is|are|been)\s+met\s+with\s+(?:(?:harsh|violent|brutal|live|armed)\s+){0,3}(?:beatings?|bullets?|fire|violence|repression)\b/i.test(text))return {status:'unknown',reason:'opposition or physical treatment is not a meeting',military_context};
  if(/\b(?:met|meets?|meeting)\s+(?:the\s+)?(?:requirements?|standards?|criteria|targets?|deadlines?|needs?|demand)\b/i.test(text))return {status:'unknown',reason:'non-interpersonal sense of meet',military_context};
  const completed=text.match(/\b(?:held talks|met (?!requirements|standards)|spoke with|signed (?:a |the )?(?:memorandum|agreement)|adopted (?:a |the )?resolution|briefed member states)\b/i);
  if(/\b(?:we|I)\s+(?:had\s+)?(?:last\s+)?met\b/i.test(text)&&!/\b(?:minister|president|officials?|diplomats?|delegations?|negotiat\w*|talks|ambassador|envoy)\b/i.test(text))return {status:'unknown',reason:'private recollection does not establish diplomatic interaction',military_context};
  if(!completed&&/\b(?:under|within|underneath)\s+(?:the |a )?(?:ceasefire|peace) agreement\b/i.test(text)&&!/\b(?:talks|meeting|negotiat\w*|spoke with)\b/i.test(text))return {status:'unknown',reason:'reference to an existing agreement is not a new interaction',military_context};
  if(!completed&&/\bupcoming\s+(?:\w+\s+){0,2}(?:meeting|talks)|\b(?:accepted|declined|rejected)\s+(?:\w+\s+){0,3}invitation\b|\binvitation\s+to\s+(?:a\s+)?meeting\b/i.test(text))return {status:'planned',reason:'invitation or upcoming interaction has not happened',military_context};
  const laterPlan=text.search(/\b(?:will|would|planned|scheduled|cancelled|called off)\b/i);
  if(completed&&laterPlan>completed.index&&!/\b(?:not|never|denied)\b/i.test(text.slice(0,completed.index)))return {status:'asserted',reason:'completed interaction precedes a separate later plan',military_context};
  if(/\b(?:cancel\w*|called off|failed to (?:meet|hold)|did not (?:meet|hold)|never (?:met|held))\b/i.test(text))return {status:'negated',reason:'interaction cancelled or did not occur',military_context};
  if(/\b(?:call(?:ed|s|ing)? for|urge\w*|appeal\w*|request\w*|propos\w*|plan\w*|schedul\w*|expected|will|would|could|might|may)\b[^.!?]{0,55}\b(?:talks|meeting|meet|call|negotiat\w*|dialogue|briefing)\b|\bto meet\b/i.test(text))return {status:'planned',reason:'interaction requested or prospective',military_context};
  return {status:baseStatus,reason:'retain local diplomatic assertion status',military_context};
 }
 throw Error('Unknown communication kind: '+kind);
}

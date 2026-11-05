// A threat is a reported speech act. The attack it describes may be conditional.
export const THREAT_EXPRESSION=String.raw`threats?|threaten\w*|warn\w*|vow\w*|ultimatum|pledge\w*|promis\w*|pay(?:s)? (?:the |a |the full )?price|consequences|retaliat\w*|hunt down|miserable fate|will respond|(?:will|shall|would) (?:be )?(?:target\w*|attack\w*|strik\w*|destroy\w*|obliterat\w*|escalat\w*)|(?:will|would) (?:continue|resume)|will not (?:hesitate|stop|tolerate)|carry out more military operations|military operations[^.!?]{0,90}\bwill continue|limit (?:their |our |its )?attacks[^.!?]{0,70}\bto\b|resumption of (?:our |the )?attacks|all hell`;
export const THREAT_PATTERN=new RegExp(`\\b(?:${THREAT_EXPRESSION})\\b`,'i');
const MILITARY=/\b(?:military|armed|forces|troops|war|air[ -]?strikes?|attack\w*|bomb\w*|missiles?|rockets?|naval|warships?|hostages?|captives?|houthi\w*|hamas|isis|isil|rebels|militants|combat|aggression)\b/i;
const SPEECH=/\b(?:said|says|stated|announc(?:ed|es|e)|stressed|insisted|reiterated|threatened|threatens|warn(?:ed|s)?|vow(?:ed|s)?|pledged|promised|issued|issues|told|declared|confirmed|reiterated|statement|message|speech)\b/i;
const DIRECT_CONTENT=/\b(?:attack\w*|air[ -]?strikes?|naval operations|military operations|retaliat\w*|hunt down|obliterat\w*|target\w*|pay(?:s)? (?:the |a |the full )?price|all hell|miserable fate|degrade|escalat\w*|further (?:military )?(?:measures|action)|will not (?:stop|tolerate))\b/i;
const EXPLICIT_ISSUE=/\b(?:issues?|issued|issuing|made|making)\s+(?:(?:a|the|more|new|military|war|further)\s+){0,4}threats?\b/i;
const DENIED_SPEECH=/\b(?:denied|refuted|never|did not|does not|has not|had not|will not)\s+(?:(?:having|ever|actually|publicly|a|the|any|issued|issue|made|make|making)\s+){0,4}(?:threat\w*|warn\w*|vow\w*|pledge\w*)\b|\b(?:threat|warning|statement|claim)\s+(?:was|is|has been)\s+(?:denied|disputed|false|refuted)\b/i;
export function threatDecision(sentence,{baseStatus='unknown',contextText=''}={}){
 const text=String(sentence),context=String(contextText),military_context=MILITARY.test(text+' '+context);
 const result=(status,reason)=>({status,reason,military_context});
 if(!THREAT_PATTERN.test(text)||!military_context)return result('unknown','no military threat candidate');
 if(/\bwarn\w*\s+(?:that\s+)?(?:an?|the)\s+(?:attack|offensive|assault)\b[^.!?]{0,100}\b(?:would|could|will)\s+be\b/i.test(text)&&!/\b(?:we|our (?:forces|army)|will (?:launch|attack)|threatened|vowed|pledged)\b/i.test(text))return result('unknown','predicting effects of another actor attack is not a military commitment');
 if(/\b(?:analysts?|experts?|researchers?|observers?|humanitarian|aid (?:groups?|agencies)|WHO|health officials?)\b[^.!?]{0,70}\b(?:warn\w*|predict\w*|expect\w*|fear\w*|say|said|says)\b/i.test(text))return result('unknown','prediction or civilian warning');
 if(/\b(?:legal|economic|financial|humanitarian|health|climate)\s+(?:consequences|threat|risk|price)\b/i.test(text))return result('unknown','nonmilitary consequence');
 // Quote punctuation between "a" and "threat" does not turn a risk description
 // into an issued ultimatum. Explicit separate warning predicates still pass.
 const description=/\b(?:poses?|presents?|represents?|is|are|remains?|eliminate)\s+(?:(?:a|the|an|serious|significant|growing|military|major|direct)\s+){0,4}["“']?threat\b/i.test(text);
 if(description&&!/\b(?:warned|warns|threatened|vowed|vows|pledged)\b/i.test(text)&&!EXPLICIT_ISSUE.test(text))return result('unknown','risk description is not a threat utterance');
 if(/\b(?:efforts?|aims?|attempts?|campaign|purpose)\s+to\s+(?:\w+\s+){0,3}(?:degrade|threaten|destroy|defeat)\b/i.test(text)&&!/\b(?:warned|vowed|pledged|promised|will|shall)\b/i.test(text))return result('unknown','explaining an operation is not issuing a threat');
 if(DENIED_SPEECH.test(text))return result(baseStatus==='disputed'?'disputed':'negated','speech act explicitly denied');
 if(/\b(?:will|would|may|might|could|plans? to|planning to|were to)\s+(?:soon\s+)?(?:say|announce|warn|threaten|vow|pledge|issue)\b/i.test(text))return result('planned','speech act is prospective');
 const speech=SPEECH.exec(text),firstIf=text.search(/\bif\b/i);
 if(firstIf>=0&&speech&&firstIf<speech.index&&!/\b(?:said|stated|announced)\b/i.test(text.slice(0,firstIf)))return result('planned','speech act occurs inside a hypothetical antecedent');
 const contextSpeech=/\b(?:said|warned|announced|declared|vowed|pledged|confirmed|reiterated)\s*[:.!?“"']*\s*$/i.test(context);
 const reported=Boolean(speech)||contextSpeech;
 const content=DIRECT_CONTENT.test(text)||EXPLICIT_ISSUE.test(text);
 if(reported&&content){
  // "not hesitate", "not stop", and a condition containing "not" negate an
  // obstacle or condition, not the already reported military commitment.
  if(baseStatus==='disputed')return result('disputed','retain disputed speech attribution');
  if(baseStatus==='negated'&&!/\b(?:will not (?:hesitate|stop|tolerate)|if|until)\b/i.test(text))return result('negated','retain local negation');
  return result('asserted','actual military commitment; attack may be conditional');
 }
 return result(baseStatus==='asserted'?'unknown':baseStatus,'no explicit actual military commitment');
}

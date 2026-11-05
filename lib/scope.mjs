// Explicit geographical security scopes. These are case definitions, not
// learned event labels. Bilateral cases retain the existing two-actor gate.
export const REGIONAL_SECURITY_POLICIES = Object.freeze({
 S016: { theatre: ['Syria','Syrian','Damascus','Aleppo','Idlib'], description:'叙利亚境内政治、军事与安全局势，包括参与当地冲突的外部力量' },
 S018: { theatre: ['Yemen','Yemeni','Houthi','Houthis','Ansar Allah','Sanaa','Saada','Hudaydah','Red Sea','Gulf of Aden'], description:'也门及胡塞相关军事、安全与外交活动，包括红海与对外冲突' },
 S019: { theatre: ['Gaza','West Bank','Palestinian','Palestine','Hamas','Rafah'], description:'以巴局势及加沙相关军事、安全与外交活动' },
});
const SECURITY = /\b(?:military|army|forces|troops|rebels?|militants?|fighters?|airstrikes?|air strikes?|strikes?|struck|attack\w*|missiles?|rockets?|bomb\w*|shell\w*|fighting|hostilities|conflict|war|foreign minister|diplomat\w*|talks|negotiat\w*|signed (?:a |the )?memorandum|ceasefire|refugees?|detained|custody|security|armed|naval)\b/i;
export function phraseHit(text, phrase) {
 if(typeof phrase!=='string'||!phrase.trim())return false;
 const escaped=phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 return new RegExp('(?<![a-zA-Z])'+escaped+'(?![a-zA-Z])',phrase==='US'?'':'i').test(text);
}
export function regionalSecurityScope(caseId,text){
 const policy=REGIONAL_SECURITY_POLICIES[caseId];if(!policy)return false;
 // Co-occurrence is local to a sentence/paragraph, never anywhere in an article.
 return String(text).split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).some(part=>policy.theatre.some(p=>phraseHit(part,p))&&SECURITY.test(part));
}
export function caseEntityHit(caseRecord,text,aliases){
 const cfg=aliases?.cases?.[caseRecord.case_id];
 const terms=cfg?[...(cfg.strong||[]),...(cfg.groups||[]).flat(),...(cfg.context||[])]:caseRecord.actors||[];
 return terms.some(p=>phraseHit(text,p));
}
export function hasNewReportedSubject(text){
 return /\b(?:said|says|stated|reported|explained|announced|told\s+\w+)\s+(?:that\s+)?["“']?[A-Z][a-z]+\b/.test(String(text));
}
export function regionalActionLocation(caseId,text){
 if(caseId!=='S016')return true;
 const s=String(text);
 const actionAt=s.search(/\b(?:air[ -]?strikes?|attacked|struck|bomb\w*|killed|shelled)\b/i);
 const eventLocation=actionAt<0?s:s.slice(actionAt);
 const local=/\b(?:in|on|against|near)\s+(?:(?:north|south|east|west|central|northern|southern|eastern|western)\w*\s+)?(?:Syria|Damascus|Aleppo|Idlib|Syrian (?:military|army|forces|targets|installations))\b/i.test(eventLocation);
 if(local)return true;
 if(/\b(?:Syrian nationals?|Syrian refugees?|fled [^.!?]{0,55}Syria)\b/i.test(s)&&/\b(?:Lebanon|Lebanese|Beirut|Bekaa|country where they sought shelter)\b/i.test(s))return false;
 if(/\b(?:crossed|crossing|fleeing)\b[^.!?]{0,80}\bSyria\b[^.!?]{0,35}\bfrom Lebanon\b/i.test(s))return false;
 if(/\b(?:in|on|against|of)\s+(?:Lebanon|Lebanese|Beirut|Bekaa)\b/i.test(s)&&!/\bSyrian (?:forces|army|military|air defences)\b/i.test(s))return false;
 return true;
}
export function contextContinuation(text){
 // Only a continuation lacking an independently named subject can borrow a
 // case anchor. A fresh named country/actor has to pass the local scope gate.
 const s=String(text).trim();
 if(hasNewReportedSubject(s))return false;
 return /^(?:["“']?(?:they|their|it|its|he|she|I|we|our|you|your|the (?:group|army|military|forces|rebels|officials|council|negotiations|talks)|at (?:a|the) meeting|in (?:a|the|its|their) (?:(?:council|military) )?(?:statement|resolution)|indirect negotiations))\b/i.test(s);
}

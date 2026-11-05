// Conservative local event spans. These are inspectable candidates, not a
// dependency parser or independently verified actor/target annotations.
import {ACTION_EXPRESSION,ACTION_PATTERN} from "./action-vocabulary.mjs";
const ACTION_ANCHOR=ACTION_PATTERN;
const REPORTING = /\b(?:said|says?|told|discuss(?:ed|es|ing)?|condemn(?:ed|s|ing)?|criticis(?:ed|es|ing)|criticiz(?:ed|es|ing)|comment(?:ed|s|ing)? on|express(?:ed|es|ing)? concern (?:about|over)|report(?:ed|s|ing)? (?:that|on))\b/gi;
const COMMENT_CLAUSE = /\s+(?:and|but|while)\s+(?=[^;.!?]{0,65}\b(?:said|says?|discussed|condemned|criticised|criticized|denied|welcomed|warned)\b)/i;

function withoutReportingInsertions(prefix) {
  return prefix.replace(/,\s*([^,;.!?]{1,180}),/g, (whole, inserted, index) => {
    if (!/[a-z]/i.test(prefix.slice(0, index))) return whole;
    // An attribution or nonrestrictive relative clause cannot reset the main
    // subject: "Russian forces, officials said, launched ...". Leave other
    // comma-separated clauses intact rather than guessing their syntax.
    const attribution = /\b(?:said|says?|told|reported|reports?)\s*$/i.test(inserted);
    const relative = /^(?:which|who|whom)\b/i.test(inserted) && [...inserted.matchAll(REPORTING)].length > 0;
    return attribution || relative ? ' ' : whole;
  }).replace(/\s+/g, ' ');
}

function unambiguousSpeaker(prefix, pronoun) {
  const speaker = prefix.trim();
  // This is intentionally limited to a simple reporting subject. Nested
  // reports, prepositional objects and competing antecedents need review.
  if (!speaker || /[,;:.!?]/.test(speaker) || /\b(?:or|with|to|from|in|near|of|about|which|who|that)\b/i.test(speaker) || [...speaker.matchAll(REPORTING)].length) return null;
  if (speaker.split(/\s+/).length > 8) return null;
  const plural = /\band\b/i.test(speaker) || /\b(?:forces|troops|soldiers|officials|rebels|militants|governments|countries)\s*$/i.test(speaker);
  const pluralPronoun = /^(?:they|their)$/i.test(pronoun);
  return plural === pluralPronoun ? speaker : null;
}

export function actionRelation(sentence, {actionStart=null} = {}) {
  const text = String(sentence);
  const anchor = actionStart === null ? ACTION_ANCHOR.exec(text) : [...text.matchAll(new RegExp(`\\b(?:${ACTION_EXPRESSION})\\b`,'gi'))].find(m=>m.index===actionStart);
  if (!anchor) return { supported: false, event_text: '', actor_text: null, target_text: null, action_text: null, scope_basis: 'no_action_anchor' };
  if(/^blockade$/i.test(anchor[0])&&/\b(?:bypass\w*|circumvent\w*)\s+(?:(?:the|a|naval|military)\s+){0,3}$/i.test(text.slice(0,anchor.index)))return {supported:false,event_text:'',actor_text:null,target_text:null,action_text:anchor[0],action_start:anchor.index,action_end:anchor.index+anchor[0].length,scope_basis:'bypassing_is_not_imposing_a_blockade'};
  const prefix = withoutReportingInsertions(text.slice(0, anchor.index));
  const reporting = [...prefix.matchAll(REPORTING)].at(-1);
  let actor = prefix.slice(reporting ? reporting.index + reporting[0].length : 0).trim();
  // Restore a simple agreeing reporting subject only for an explicit pronoun.
  // Never transfer the speaker when a new named actor follows "said".
  const anaphor = /^(?:that\s+)?["“']?\s*(it|they|its|their)\b/i.exec(actor);
  const supportedAnaphor = anaphor && (/^(?:it|they)$/i.test(anaphor[1]) || /^(?:that\s+)?["“']?\s*(?:its|their)\s+(?:army|military|troops|forces)\b/i.test(actor));
  let speakerInherited = false;
  if (reporting && supportedAnaphor) {
    const speaker = unambiguousSpeaker(prefix.slice(0, reporting.index), anaphor[1]);
    if (speaker) { actor = speaker + ' ' + actor; speakerInherited = true; }
  }
  const tail = text.slice(anchor.index + anchor[0].length).split(COMMENT_CLAUSE)[0]
    .split(/(?:,\s*)?\s+\b(?:but|however|whereas|while)\b\s*/i)[0]
    .replace(/,\s*according to\b.*$/i, '').trim();
  const target = /\b(?:against|at|into|on|near|in)\s+(.+?)(?:[,;.!?]|$)/i.exec(tail)?.[1]?.trim() || null;
  return {
    supported: true,
    event_text: [actor, anchor[0], tail].filter(Boolean).join(' '),
    actor_text: actor || null,
    target_text: target,
    action_text: anchor[0],
    action_start: anchor.index,
    action_end: anchor.index + anchor[0].length,
    speaker_inherited: speakerInherited,
    scope_basis: reporting ? 'local_event_after_reporting_verb' : 'local_event_span',
  };
}

// Keep the original single-candidate API for callers, while allowing the
// extractor to bind every action mention to its own assertion offsets.
export function actionRelations(sentence){
 const text=String(sentence);
 return [...text.matchAll(new RegExp(`\\b(?:${ACTION_EXPRESSION})\\b`,'gi'))].map(m=>actionRelation(text,{actionStart:m.index}));
}

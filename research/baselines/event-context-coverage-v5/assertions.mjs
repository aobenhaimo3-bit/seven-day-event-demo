// Bounded, transparent assertion rules. These are not a dependency parser or
// general coreference resolver. Call once per signal kind, then use the returned
// mentions when several different events occur in one sentence.
const EXPRESSIONS = {
  action: String.raw`air[ -]?strikes?|air raids?|drone (?:attack|strike)s?|attack\w*|struck|bombard\w*|shell(?:ing|ed)|fight(?:ing|s)?|fought|clash\w*|gunfire|shoot[ -]?out|firefight|offensive|invad\w*|invasion|blockade|seized control|captured (?:the |a )?(?:village|town|city|territory)|killed|(?:fired|launched)\s+(?:\w+\s+){0,3}(?:missiles?|rockets?)`,
  posture: String.raw`deploy\w*|mobilis\w*|mobiliz\w*|reinforc\w*|troop buil\w*(?:[- ]up)?|military presence|(?:military|naval|joint|combat) exercises?|drills?|heightened alert|combat readiness`,
  cooperation: String.raw`talks|negotiat\w*|mediat\w*|meetings?|met\s+with|meet\s+with|peace agreement|ceasefire agreement|diplomatic`,
  threat: String.raw`threaten\w*|warn\w*|vow\w*|ultimatum|pay (?:the |a )?price|consequences|retaliat\w*|will respond`,
};
const NEGATION = /\b(?:not(?!\s+only\b)|never|no|didn['’]t|doesn['’]t|don['’]t|wasn['’]t|weren['’]t|hasn['’]t|haven['’]t|hadn['’]t|isn['’]t|aren['’]t)\b/i;
const PLANNING = /\b(?:will|would|could|can|may|might|plans? to|planning|planned|prepar\w*|intend\w*|expected|possible|potential|risk of|fears? of|threaten\w*|warn\w*|vow\w*)\b/i;
const DISPUTE_PREFIX = /\b(?:den(?:y|ies|ied|ying)|refut\w*|reject\w*\s+(?:the\s+)?(?:claim|report|allegation)|claims?\s+(?:that|to|of|responsibility)|claimed(?:\s+(?:that|to|responsibility))?|alleged(?:ly)?|accused(?:\s+\w+){0,4}\s+of|unconfirmed(?:\s+reports?)?|(?:could|can|was|were|has|have)\s+not\s+(?:(?:be|been)\s+)?(?:independently\s+)?(?:verified|confirmed)|disput(?:e|es|ed|ing)\s+(?:(?:the|a|these|those)\s+)?(?:claims?|reports?|allegations?|accounts?|assertions?|that))\b/i;
const DISPUTE_SUFFIX = /^\s*,?\s*(?:(?:was|were|is|are|has been|have been|had been)\s+(?:denied|disputed|refuted|unconfirmed|not (?:confirmed|verified))\b|(?:denied|disputed|refuted)\s+by\b|could not be (?:independently )?verified\b)/i;
const NEGATED_SUFFIX = /^\s*(?:(?:was|were|is|are)\s+)?(?:did not|does not|never|has not|have not|had not)\s+(?:happen|occur|take place)\b/i;
const PASSIVE_PLANNED_SUFFIX = /^\s+(?:will|would|could|can|may|might)\s+(?:soon\s+)?(?:be\s+(?:launched|carried out|conducted|held|deployed)|happen|occur|take place)\b/i;
const PASSIVE_NEGATED_SUFFIX = /^\s+(?:will|would|could|can|may|might)\s+not\s+(?:be\s+(?:launched|carried out|conducted|held|deployed)|happen|occur|take place)\b/i;

function occurrences(text) {
  const result = [];
  for (const [kind, expression] of Object.entries(EXPRESSIONS)) {
    for (const match of text.matchAll(new RegExp(`\\b(?:${expression})\\b`, 'gi'))) {
      result.push({ kind, start: match.index, end: match.index + match[0].length, text: match[0] });
    }
  }
  return result.sort((a, b) => a.start - b.start || b.end - a.end);
}

function clauseStart(text, before) {
  const prefix = text.slice(0, before);
  const boundaries = [...prefix.matchAll(/;\s*|(?:,\s*)?\b(?:but|however|whereas|while)\b\s*|\band\s+(?=(?:will|would|could|may|might)\b)/gi)];
  const last = boundaries.at(-1);
  return last ? last.index + last[0].length : 0;
}

function statusOfMention(text, mention, all) {
  let start = clauseStart(text, mention.start);
  // A negation attached to another kind must not leak into this signal. A
  // shared bare-verb coordination ("did not deploy ... or hold talks") is an
  // exception, where the same auxiliary clearly governs both predicates.
  const preceding = all.filter(m => m.end <= mention.start && m.start >= start).at(-1);
  if (preceding && preceding.kind !== mention.kind) {
    const between = text.slice(preceding.end, mention.start);
    const warningGovernsAction = preceding.kind === 'threat' && mention.kind === 'action' && /\b(?:of|about|that|to)\b/i.test(between) && !/\b(?:before|after)\b/i.test(between);
    if (!warningGovernsAction && !/\b(?:and|or)\s+(?:hold|conduct|carry out|launch)?\s*$/i.test(between)) start = preceding.end;
  }
  const prefix = text.slice(Math.max(start, mention.start - 150), mention.start)
    .replace(/\bMay(?=\s+(?:\d{1,2}(?:st|nd|rd|th)?\b|20\d{2}\b))/gi, '   ')
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+May\b/gi, date => date.replace(/May/gi, '   '));
  const suffix = text.slice(mention.end).split(/;|\b(?:but|however|whereas|while)\b/i)[0];
  if (DISPUTE_PREFIX.test(prefix) || DISPUTE_SUFFIX.test(suffix)) return { status: 'disputed', reason: 'event assertion is explicitly attributed, denied or disputed' };
  if (NEGATION.test(prefix) || NEGATED_SUFFIX.test(suffix) || PASSIVE_NEGATED_SUFFIX.test(suffix)) return { status: 'negated', reason: 'negation governs this signal' };
  if (PLANNING.test(prefix) || PASSIVE_PLANNED_SUFFIX.test(suffix) || /\bif\b/i.test(text.slice(start, mention.end))) return { status: 'planned', reason: 'modal, planned or conditional event' };
  return { status: 'asserted', reason: 'no local negation, planning or assertion dispute found' };
}

function followingDispute(sentence, followingSentence, kind, all) {
  const next = String(followingSentence || '').trim();
  if (!next || next.length > 600) return false;
  const reference = next.match(/\b(?:this|that|the)\s+(claim|report|allegation|account|assertion|attack|airstrike|deployment|mobilisation|mobilization|meeting|talks|warning|threat)\b/i);
  const pronoun = /^(?:it|this|that)\s+(?:was|is|has been|had been)\s+/i.test(next);
  if (!reference && !pronoun) return false;
  if (!/\b(?:denied|refuted|disputed|false|unconfirmed|not (?:confirmed|verified)|could not be (?:independently )?verified)\b/i.test(next)) return false;
  // An explicit different event object does not refer back to this kind.
  const referred = reference?.[1]?.toLowerCase();
  const explicitKind = /^(?:attack|airstrike)$/.test(referred || '') ? 'action'
    : /^(?:deployment|mobilisation|mobilization)$/.test(referred || '') ? 'posture'
      : /^(?:meeting|talks)$/.test(referred || '') ? 'cooperation'
        : /^(?:warning|threat)$/.test(referred || '') ? 'threat' : null;
  if (explicitKind && explicitKind !== kind) return false;
  // A generic "this claim" only binds to the closest mentioned event kind.
  // Do not turn unrelated earlier facts elsewhere in the article into denials.
  return (explicitKind || all.at(-1)?.kind) === kind;
}

/**
 * @param {string} sentence A sentence or bounded clause from the source.
 * @param {{kind: 'action'|'posture'|'cooperation'|'threat', followingSentence?: string}} options
 * @returns {{status: 'asserted'|'negated'|'planned'|'disputed'|'unknown', reason: string, mentions: Array}}
 * `asserted` means a grammatical assertion, never independently verified truth.
 * Only an immediately following explicit reference is considered for disputes.
 */
export function assertionFor(sentence, { kind, followingSentence = '' } = {}) {
  if (!Object.hasOwn(EXPRESSIONS, kind)) throw new Error(`Unknown assertion signal kind: ${kind}`);
  const text = String(sentence || '');
  const all = occurrences(text);
  const mentions = all.filter(m => m.kind === kind).map(m => ({ ...m, ...statusOfMention(text, m, all) }));
  if (!mentions.length) return { status: 'unknown', reason: 'no mention of this signal kind', mentions };
  if (followingDispute(text, followingSentence, kind, all)) {
    // Apply to the nearest clause, including multiple words for the same fact
    // ("airstrikes ... killed"). Preserve earlier independent clauses.
    const last = mentions.at(-1);
    const lastStart = clauseStart(text, last.start);
    for (const mention of mentions.filter(m => clauseStart(text, m.start) === lastStart)) {
      mention.status = 'disputed'; mention.reason = 'immediately following explicit reference disputes this event';
    }
  }
  const asserted = mentions.find(m => m.status === 'asserted');
  const selected = asserted || mentions.find(m => m.status === 'disputed') || mentions.find(m => m.status === 'planned') || mentions[0];
  return { status: selected.status, reason: selected.reason, mentions };
}

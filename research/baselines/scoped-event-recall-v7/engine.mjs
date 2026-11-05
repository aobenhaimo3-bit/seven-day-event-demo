import {ACTION_PATTERN as ACTION,FORCE_PATTERN as FORCE,HARD_ACTION_PATTERN} from "./action-vocabulary.mjs";
import {THREAT_PATTERN as THREAT,COOPERATION_PATTERN as TALKS,communicationDecision} from "./communication.mjs";
import { createHash } from 'node:crypto';
import { temporalStatus, stripHistoricalComparison } from './temporal.mjs';
import { assertionFor } from './assertions.mjs';
import { actionRelation, actionRelations } from './event-relations.mjs';
import {regionalSecurityScope,regionalActionLocation,contextContinuation,hasNewReportedSubject} from './scope.mjs';

const DAY = 86400000;
const TARGET = '未来7天出现19类军事行动报道';
const MIN_HISTORY = 28;
const MAX_HISTORY = 92;
const MIN_NEWS = 10;
const MIN_FUTURE_DAYS = 3;
const MAX_NEWS_AGE_DAYS = 7;
export const DETECTOR_RULE_VERSION = 'scoped-event-recall-v7';
const STOP = new Set('a an the and or but to of in on at by for from with as is are was were be been being it its that this these those have has had he she they their his her we our who which what when where how said says say also not no will would could can may about after before more than into over against while during some all any according'.split(' '));
const FEATURE_DEFS = [
  ['log_news_7', '近7天报道数量'], ['coverage_7', '近7天有报道日比例'],
  ['action_share_7', '近7天军事行动报道比例'], ['action_share_28', '近28天军事行动报道比例'],
  ['action_share_history', '可用历史军事行动报道比例'], ['action_days_7', '近7天行动报道日比例'],
  ['action_change', '行动报道比例变化'], ['threat_share_7', '近7天威胁信号比例'],
  ['posture_share_7', '近7天军事姿态信号比例'], ['cooperation_share_7', '近7天协商信号比例'],
  ['time_since_action', '距上次行动报道时间'], ['coverage_28', '近28天报道覆盖'],
  ['history_fraction', '可用历史长度'], ['log_news_history', '历史报道数量'],
];

// Weapon possession, deployment and range are not evidence of weapons use.

// Police presence and a terrorism description alone do not establish CAMEO-19
// military engagement. Police exchanges with armed actors/weapons can still pass.

const SPORT_TITLE = /\b(?:football|soccer|cricket|tennis|rugby|boxing|ufc|wrestl\w*|(?:olympic|paralympic)\w*|world cup|champions (?:league|trophy)|premier league|goalkeeper|grand prix|basketball|tournament|match winner)\b/i;
const NONMILITARY_TITLE = /\b(?:obituary|dies at \d+|stock market|quarterly (?:profit|earnings)|heart attack|coronavirus|covid|box office|film festival)\b/i;
const DRILL = /\b(?:drills?|(?:military|combat|naval|joint|training|air force|army|live[- ]fire) exercises?|war games?|practi[cs](?:e|es|ed|ing)|tournament|weapons? (?:test|display)|test[- ]fir\w*)\b/i;

const POSTURE = /\b(?:deploy\w*|mobilis\w*|mobiliz\w*|troop buil\w*|reinforc\w*|military drills?|military exercises?|heightened alert|combat readiness|military presence)\b/i;

const ANAPHORIC_START = /^(?:(?:on |by )?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[, ]+)?(?:they|their|it|its|the (?:army|military|troops|forces|soldiers|rebels)|artillery|shelling|gunfire)\b/i;

const round = (n, places = 6) => Number(n.toFixed(places));
const sigmoid = x => x >= 0 ? 1 / (1 + Math.exp(-Math.min(x, 40))) : Math.exp(Math.max(x, -40)) / (1 + Math.exp(Math.max(x, -40)));
const clip = p => Math.max(1e-6, Math.min(1 - 1e-6, p));
const uniq = values => [...new Set(values)];
const maxDate = dates => dates.filter(Boolean).sort().at(-1) || null;

function dateNumber(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期须为 YYYY-MM-DD');
  const n = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value) throw new Error('日期无效：' + value);
  return n;
}

function addDays(value, count) { return new Date(dateNumber(value) + count * DAY).toISOString().slice(0, 10); }
function difference(a, b) { return Math.round((dateNumber(a) - dateNumber(b)) / DAY); }

function tokens(value) {
  const words = (String(value).toLowerCase().match(/[a-z][a-z'-]{1,}/g) || []).filter(w => !STOP.has(w));
  return [...words, ...words.slice(0, -1).map((w, i) => w + '_' + words[i + 1])];
}

function cleanText(text) {
  const lines = String(text || '').split(/\r?\n/), kept = [];
  let recommendations = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^(?:Keep reading|Related (?:stories|articles)|list of \d+ items)/i.test(line)) { recommendations = true; continue; }
    if (/^(?:Register now|Our Standards|Published On|Read more|Advertisement|Presenter|Guests|Follow|Subscribe|Copyright)/i.test(line)) continue;
    // Scraped recommendation counts are sometimes wrong. Resume at prose, not
    // after N lines, so a short link block cannot eat the next body paragraph.
    if (recommendations) {
      if (!line || (line.length <= 180 && !/[.!?][”"']?$/.test(line))) continue;
      recommendations = false;
    }
    kept.push(raw);
  }
  return kept.join('\n');
}

function sentences(text) {
  // A month abbreviation does not end the date-bearing sentence. Restore its
  // punctuation before extracting evidence so exported quotes stay verbatim.
  const protectedText = cleanText(text).replace(/\b(?:[A-Z]\.){2,}/g,m=>m.replace(/\./g,'\uE000')).replace(/\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Mr|Mrs|Ms|Dr|Gen|Adm)\./gi, '$1\uE000');
  return protectedText.split(/\n+|(?<=[.!?])\s+(?=[A-Z“])/).map(s => s.replace(/\uE000/g, '.').trim().replace(/^[-•]\s+/, '')).filter(s => s.length >= 5 && !/^(?:Presenter|Guests|Follow|Subscribe|Copyright)/i.test(s));
}

function fitDetector(pilotAnnotations, pilotPairs) {
  const byId = new Map(pilotPairs.map(r => [r.pair_id, r]));
  const examples = [];
  const seen = new Set();
  for (const row of pilotAnnotations) {
    if (row.split && row.split !== 'train') throw new Error('事件检测器只能使用训练试标');
    for (const event of row.events || []) {
      const text = event.evidence_quote || '';
      if (text.length < 8) continue;
      const label = event.cameo_code.startsWith('19') ? 1 : 0;
      const key = label + '|' + text.toLowerCase();
      if (!seen.has(key)) { seen.add(key); examples.push({ text, label }); }
    }
    if (row.relevance === 'no' && byId.has(row.pair_id)) {
      const news = byId.get(row.pair_id).news;
      examples.push({ text: news.title + '\n' + cleanText(news.text).slice(0, 1000), label: 0 });
    }
  }
  const counts = [{}, {}], total = [0, 0], classes = [0, 0], df = {};
  for (const e of examples) {
    classes[e.label]++;
    const terms = tokens(e.text);
    for (const term of uniq(terms)) df[term] = (df[term] || 0) + 1;
    for (const term of terms) { counts[e.label][term] = (counts[e.label][term] || 0) + 1; total[e.label]++; }
  }
  if (!classes[0] || !classes[1]) throw new Error('试标缺少可训练的19或对照证据');
  const vocabulary = Object.keys(df).filter(w => df[w] >= 1).sort();
  const logRatios = {};
  for (const term of vocabulary) logRatios[term] = Math.log(((counts[1][term] || 0) + 1) / (total[1] + vocabulary.length)) - Math.log(((counts[0][term] || 0) + 1) / (total[0] + vocabulary.length));
  const inputDates = pilotAnnotations.map(r => byId.get(r.pair_id)?.news.date).filter(Boolean);
  return { type: 'pilot_evidence_multinomial_nb_with_conservative_gates', examples: examples.length, positive_examples: classes[1], negative_examples: classes[0], prior_log_odds: Math.log((classes[1] + 1) / (classes[0] + 1)), log_ratios: logRatios, trained_through: maxDate(inputDates), text_char_limit: null, extraction_text_scope: 'complete_cleaned_article', score_semantics: 'uncalibrated semantic detector score, not event occurrence probability' };
}

function detectorScore(text, detector) {
  let score = detector.prior_log_odds;
  for (const word of tokens(text)) score += detector.log_ratios[word] || 0;
  return sigmoid(score);
}

function phraseHit(text, phrase) {
  if (typeof phrase !== 'string' || !phrase.trim()) return false;
  const escaped = String(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?<![a-zA-Z])' + escaped + '(?![a-zA-Z])', phrase === 'US' ? '' : 'i').test(text);
}

function scopeFor(caseRecord, news, aliases) {
  const cfg = aliases?.cases?.[caseRecord.case_id];
  const cleanBody = cleanText(news.text).replace(/(^|\n)([^\n—–]{1,90})\s+[—–]\s+/g, (whole, newline, prefix) => {
    const parts = prefix.split(',').map(p=>p.trim());
    const isDateline = parts.length === 2 && (cfg?.context || []).some(p=>p.toLowerCase()===parts[0].toLowerCase())
      && [...(cfg?.strong || []), ...(cfg?.groups || []).flat()].some(p=>p.toLowerCase()===parts[1].toLowerCase());
    return isDateline ? newline : whole;
  });
  const leading = String(news.title || '') + '\n' + cleanBody;
  if (!cfg) {
    const custom = caseRecord.actors || caseRecord.keywords || [];
    if (!Array.isArray(custom) || !custom.some(p => typeof p === 'string' && p.trim())) return { relevant: false, verified: false, note: '未配置研究对象别名，范围未经确认' };
    return { relevant: custom.some(p => typeof p === 'string' && phraseHit(leading, p)), verified: true, note: '使用导入的研究对象关键词' };
  }
  const strong = cfg.strong || [];
  const groupHits = (cfg.groups || []).filter(group => group.some(p => phraseHit(leading, p))).length;
  const mainHit = strong.some(p => phraseHit(leading, p));
  // Russia + Moscow (or Pakistan + Islamabad) is one actor, not evidence
  // connecting that actor's activities elsewhere to the case's theatre.
  const actorAliases = [...strong, ...(cfg.groups || []).flat()];
  // A short alias nested in a longer actor name is not an independent location:
  // "Democratic Republic of Congo" must not corroborate itself via "Congo".
  const contextHit = (cfg.context || []).some(p => !actorAliases.some(alias => phraseHit(alias, p)) && phraseHit(leading, p));
  const regional = ['S012', 'S014', 'S015', 'S021', 'S029', 'S030'].includes(caseRecord.case_id) && /\b(?:Israel|Israeli|IDF)\b/i.test(leading) && /\b(?:Gaza|Palestin\w*|Lebanon|Hezbollah|Iran|Iranian|Syria|Syrian)\b/i.test(leading);
  const declaredRegion=regionalSecurityScope(caseRecord.case_id,leading);
  return { relevant: groupHits >= 2 || (mainHit && contextHit) || regional || declaredRegion, verified: true, note: regional||declaredRegion ? '按声明的地区政治军事安全范围识别' : '研究对象别名规则自动筛选' };
}

function eventClauses(sentence) {
  // Do not let an independent future clause suppress an asserted action.
  // Conditionals remain intact: splitting "would attack if ..." creates facts.
  const conditional = /\bif\b/i.test(sentence);
  const coarse = conditional ? [sentence] : sentence.split(/;\s*|\s+and\s+(?=(?:will|would|could|may|might)\b)|(?:,\s*)?\s+but\s+(?!also\b)|(?:,\s*)?\s+(?:whereas|however)\s+/i);
  const hasEvent = text => [ACTION,POSTURE,THREAT,TALKS].some(pattern=>pattern.test(text));
  const clauses = conditional ? coarse : coarse.flatMap(source=>{
    const parts=[];let start=0;
    for(const boundary of source.matchAll(/\s+(?:and|while|after|before)\s+/g)){
      const left=source.slice(start,boundary.index),right=source.slice(boundary.index+boundary[0].length);
      // Split a new named/explicit subject after an existing predicate, not the
      // coordinated subjects in "Russia and Ukraine held talks" or a shared
      // bare predicate in "shelled ... and deployed ...".
      const newSubject=/^(?:["“']?[A-Z][A-Za-z'-]*\b|the\s+|officials\b|diplomats\b|leaders\b|troops\b|rebels\b|forces\b)/.test(right);
      const nextEvent=[ACTION,POSTURE,THREAT,TALKS].map(pattern=>pattern.exec(right.slice(0,220))).filter(Boolean).sort((a,b)=>a.index-b.index)[0];
      // A coordinated noun modifier ("US and UK air strikes") has no finite
      // predicate. Its military context belongs to the original clause.
      const finitePredicate=nextEvent&&/\b(?:held|met|said|stated|announced|fought|struck|took|taken|killed|captured|recaptured|seized|opened|intercepted|attacked|shelled|bombarded|invaded|clashed|launched|deployed|mobilised|mobilized|warned|threatened|vowed|negotiated|attacks|shells|launches|deploys|warns|threatens|vows|negotiates|is|are|was|were|has|have|had|will|would|could|may|might)\b/i.test(right.slice(0,nextEvent.index+nextEvent[0].length));
      if(hasEvent(left)&&newSubject&&finitePredicate){parts.push(left);start=boundary.index+boundary[0].length;}
    }
    parts.push(source.slice(start));return parts;
  });
  let previousActor = null;
  return clauses.map(source => {
    const evidence = stripHistoricalComparison(source).trim();
    let text = evidence, inheritedActor = false;
    // Only an explicit bare action predicate can inherit a simple subject.
    // Never transfer negation/modality, or replace a new named actor.
    if (previousActor && /^(?:also\s+)?(?:attacked|struck|shelled|bombarded|invaded|fired|launched|captured|seized|killed)\b/i.test(text)) {
      text = previousActor + ' ' + text;
      inheritedActor = true;
    }
    const actor = actionRelation(text).actor_text?.replace(/\s+(?:did|does|do|has|have|had|was|were|is|are|will|would|could|can|may|might|not|never|launched|fired|carried|conducted|denied)\b[\s\S]*$/i, '').trim();
    previousActor = actor && /^[A-Z][a-zA-Z'-]*(?:\s+(?:forces|troops|military|army|soldiers|rebels|militants))?$/i.test(actor) ? actor : null;
    return { text, evidence, inheritedActor };
  }).filter(c => c.text);
}

function actionCode(sentence) {
  if (/\b(?:drone (?:strike|attack)|unmanned aerial|remotely piloted)\b/i.test(sentence)) return ['1952', '无人机空中打击候选'];
  if (/\b(?:air[ -]?strikes?|air raids?|aerial bombardment|warplanes?|fighter jets?|helicopter.*(?:attack|strike))\b/i.test(sentence)) return ['195', '空中打击候选'];
  if (/\b(?:artillery|shelling|shelled|tanks?|rocket fire)\b/i.test(sentence)) return ['194', '重武器行动候选'];
  if (/\b(?:gunfire|shoot[ -]?out|firefight|small arms|rifles?)\b/i.test(sentence)) return ['193', '轻武器交火候选'];
  if (/\bblockade\b/i.test(sentence) && FORCE.test(sentence)) return ['191', '武装封锁候选'];
  if (/\b(?:(?:capture(?:d|s)?|recapture(?:d|s)?|capturing|recapturing|seized) (?:(?:the|a|an|another|one|two|three|four|several|multiple|strategic|key|border|northern|southern|eastern|western|\d+) ){0,5}(?:villages?|towns?|city|cities|territory|territories|districts?)|(?:taken|took|takes?|taking|seized) control of (?:(?:the|a|an|another|one|two|three|four|several|multiple|strategic|key|border|northern|southern|eastern|western|\d+) ){0,5}(?:villages?|towns?|city|cities|territory|territories|districts?))\b/i.test(sentence)) return ['192', '领土控制变化候选'];
  return ['190', '军事行动报道候选'];
}

function threatTime(sentence,publishedDate){
  const speech=/\b(?:said|says|warn(?:ed|s)?|vow(?:ed|s)?|pledged|promised|announced|declared|issued|told|statement)\b/i.exec(sentence);
  if(!speech)return temporalStatus(sentence,publishedDate);
  const end=speech.index+speech[0].length,rest=sentence.slice(end);
  const content=rest.search(/\b(?:that|of|to|if|will|would|shall)\b|[:"“]/i);
  // Date the speaking event. A date inside the threatened attack is separate.
  return temporalStatus(sentence.slice(0,content<0?sentence.length:end+content),publishedDate);
}

export function extractArticleSignals(caseRecord, news, model) {
  const title = String(news.title || '');
  const scope = scopeFor(caseRecord, news, model.aliases);
  const empty = { action: false, threat: false, posture: false, cooperation: false, events: [], relevant: scope.relevant, scope_verified: scope.verified };
  if (!scope.relevant || SPORT_TITLE.test(title) || NONMILITARY_TITLE.test(title)) return { ...empty, relevant: false };
  const body = sentences(news.text);
  // A headline is not independent corroboration of a disputed assertion in the
  // body. Use the body when present, preserving real sentence adjacency.
  const chunks = body.length ? body : [title];
  const found = [];
  let action = false, threat = false, posture = false, cooperation = false;
  let anchorText=scopeFor(caseRecord,{title,text:''},model.aliases).relevant?title:'';
  let anchorIndex=-1;
  for (const [chunkIndex, chunk] of chunks.entries()) {
    const localScope = scopeFor(caseRecord, { title: chunk, text: '' }, model.aliases);
    const inheritedScope = Boolean(anchorText&&chunkIndex-anchorIndex<=2&&!hasNewReportedSubject(chunk)&&(ANAPHORIC_START.test(chunk)||contextContinuation(chunk)));
    const contextText=inheritedScope?anchorText+' '+chunk:chunk;
    if(localScope.relevant){const t=temporalStatus(chunk,news.date);if(!['historical','future'].includes(t.status)&&!t.requires_review){anchorText=chunk;anchorIndex=chunkIndex;}}
    if (!localScope.relevant && !inheritedScope) continue;
    const clauses = eventClauses(chunk);
    for (const [clauseIndex, clause] of clauses.entries()) {
      const sentence = clause.text;
      // Article relevance does not automatically license every event in it.
      if (!scopeFor(caseRecord, { title: sentence, text: '' }, model.aliases).relevant && !(inheritedScope && (ANAPHORIC_START.test(sentence)||contextContinuation(sentence)))) continue;
      const temporal = temporalStatus(sentence, news.date);
      const old = temporal.status === 'historical';
      const future = temporal.status === 'future';
      const currentTime = !old && !future && !temporal.requires_review;
      const drill = DRILL.test(sentence);
      // "Legal consequences" and a financial "price" do not corroborate
      // themselves as military threats. Require separate force-related context.
      const postureHere = (POSTURE.test(sentence)||drill)&&FORCE.test(sentence)
        &&!(/\b(?:maintain\w*|existing|longstanding|long-standing)\b[^.!?]{0,40}\bmilitary presence\b/i.test(sentence)&&!/\b(?:deploy\w*|mobilis\w*|mobiliz\w*|reinforc\w*|drills?|exercises?)\b/i.test(sentence));
      const talksHere = TALKS.test(sentence);
      const followingSentence = clauseIndex === clauses.length - 1 ? body[chunkIndex + 1] || '' : '';
      const assertions = Object.fromEntries(['action', 'posture', 'cooperation', 'threat'].map(kind => [kind, assertionFor(sentence, { kind, followingSentence })]));
      for(const kind of ['threat','cooperation'])assertions[kind]={...assertions[kind],...communicationDecision(sentence,{kind,baseStatus:assertions[kind].status,contextText:inheritedScope?contextText:sentence})};
      const threatened=THREAT.test(sentence)&&assertions.threat.status!=='unknown';
      const utteranceTemporal=threatTime(sentence,news.date);
      // A relation belongs to one action mention. Another action's aggregate
      // asserted status must never validate this relation or its participants.
      const candidates=actionRelations(sentence).map(relation=>{
        const bound=assertions.action.mentions.find(m=>m.start<relation.action_end&&m.end>relation.action_start);
        const inherited=inheritedScope&&(ANAPHORIC_START.test(sentence)||contextContinuation(sentence));
        const scoped=(scopeFor(caseRecord,{title:relation.event_text,text:''},model.aliases).relevant||inherited)&&regionalActionLocation(caseRecord.case_id,relation.event_text);
        const hard=HARD_ACTION_PATTERN.test(relation.event_text);
        const evidence=relation.supported&&(FORCE.test(relation.event_text)||hard)&&scoped;
        const score=detectorScore(relation.event_text,model.detector);
        const actual=evidence&&!drill&&currentTime&&bound?.status==='asserted'&&(score>=0.45||hard);
        return {relation,bound,evidence,actual,score};
      });
      const selected=candidates.find(c=>c.actual)||candidates.find(c=>c.evidence)||candidates[0];
      const relation=selected?.relation||actionRelation(sentence),boundAssertion=selected?.bound;
      const score=selected?.score??detectorScore(sentence,model.detector);
      assertions.action = { ...assertions.action, status: boundAssertion?.status || 'unknown', reason: boundAssertion?.reason || 'no assertion bound to this action' };
      const actionEvidence=selected?.evidence||false,actual=selected?.actual||false;
      const statusFor = type => {const time=type==='threat'?utteranceTemporal:temporal;return time.status==='historical'?'historical':assertions[type].status==='planned'||time.status==='future'?'planned':time.requires_review||assertions[type].status!=='asserted'?'uncertain':'candidate';};
      // Article labels are independent. One actual action must not hide a
      // simultaneous deployment, warning or negotiation in the same clause.
      const signals=[];
      if(actual){const [code,label]=actionCode(sentence);action=true;signals.push({code,label,kind:'candidate',signalKind:'action'});}
      else if(actionEvidence){const [code,label]=actionCode(sentence);let kind=drill?'planned':statusFor('action');if(kind==='candidate')kind='uncertain';signals.push({code,label,kind,signalKind:'action'});}
      if(postureHere){const kind=statusFor('posture');posture||=kind==='candidate';signals.push({code:'15',label:'军事姿态信号',kind,signalKind:'posture'});}
      if(threatened){const kind=statusFor('threat');threat||=kind==='candidate';signals.push({code:'13',label:'威胁言论信号',kind,signalKind:'threat'});}
      if(talksHere){const kind=statusFor('cooperation'),code=kind==='planned'?'036':'04';cooperation||=kind==='candidate';signals.push({code,label:code==='036'?'协商意向信号':'协商报道信号',kind,signalKind:'cooperation'});}
      for(const {code,label,kind,signalKind} of signals){
      const signalTime=signalKind==='threat'?utteranceTemporal:temporal;
      const disputed = ['disputed', 'negated'].includes(assertions[signalKind].status);
      if (code && !found.some(e => e.code === code && e.status === kind)) found.push({
        id: String(news.news_id) + '-' + (found.length + 1), date: news.date, published_date: news.date, event_date: null,
        headline: title, source: String(news.publisher || '未提供来源'), news_id: String(news.news_id), code, code_label: label,
        status: kind, assertion: disputed ? 'claimed_or_disputed' : 'automated_report_candidate',
        assertion_status: assertions[signalKind].status, assertion_reason: assertions[signalKind].reason,
        temporal: { status: signalTime.status, reason: signalTime.reason, requires_review: signalTime.requires_review, references: signalTime.references },
        ...(signalKind === 'action' ? { relation: { actor_text: relation.actor_text, target_text: relation.target_text, action_text: relation.action_text, scope_basis: relation.scope_basis, inherited_clause_subject: clause.inheritedActor, verified: false } } : {}),
        evidence: clause.evidence.slice(0, 900), confidence: round(score), confidence_kind: 'uncalibrated_detection_score', scope: scope.verified ? 'automatic_scope' : 'unverified',
        note: '按报道日排列；实际发生日未自动核实。' + scope.note + (disputed ? ' 含声称、否认或争议措辞，不计入行动信号，需复核。' : ''),
      });
      }
    }
  }
  return { action, threat, posture, cooperation, events: found, relevant: true, scope_verified: scope.verified };
}

function validateCase(c) {
  if (!c || typeof c !== 'object' || !String(c.case_id || '').trim()) throw new Error('缺少 case_id');
  dateNumber(c.news_start); dateNumber(c.news_end);
  if (c.news_start > c.news_end) throw new Error('历史日期范围颠倒');
  if (!Array.isArray(c.news)) throw new Error('news 必须是新闻数组');
  const seen = new Set();
  for (const n of c.news) {
    if (!n || !String(n.news_id || '').trim() || seen.has(String(n.news_id))) throw new Error('新闻ID为空或重复');
    seen.add(String(n.news_id)); dateNumber(n.date);
    if (n.date < c.news_start || n.date > c.news_end) throw new Error('新闻日期超出案例范围：' + n.news_id);
    if (typeof (n.title ?? '') !== 'string' || typeof (n.text ?? '') !== 'string') throw new Error('新闻标题与正文必须是文本');
  }
}

function analyzedNews(caseRecord, model) {
  validateCase(caseRecord);
  const firstByContent = new Map();
  return caseRecord.news.slice().sort((a, b) => a.date.localeCompare(b.date) || String(a.news_id).localeCompare(String(b.news_id))).map(n => {
    // Ignore headline/source/date/ID changes on verbatim reprints. Keep the
    // earliest known publication so later copies cannot refresh stale data.
    const body = String(n.text || '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
    const content = body || String(n.title || '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
    const key = createHash('sha256').update(content).digest('hex');
    const signals = extractArticleSignals(caseRecord, n, model);
    const eligible = signals.relevant && signals.scope_verified;
    const duplicateOf = eligible ? firstByContent.get(key) || null : null;
    // An irrelevant or unconfigured record cannot suppress a usable article
    // merely by sorting first under the same body hash.
    if (eligible && !duplicateOf) firstByContent.set(key, String(n.news_id));
    return { ...n, duplicate_of: duplicateOf, signals };
  });
}

function historyData(caseRecord, allNews, asOf) {
  const start = [caseRecord.news_start, addDays(asOf, -(MAX_HISTORY - 1))].sort().at(-1);
  const supplied = allNews.filter(n => n.date >= start && n.date <= asOf);
  const related = supplied.filter(n => n.signals.relevant && n.signals.scope_verified);
  const news = related.filter(n => !n.duplicate_of);
  const recent = n => difference(asOf, n.date) < 7;
  const prior = n => difference(asOf, n.date) >= 7 && difference(asOf, n.date) < 14;
  const month = n => difference(asOf, n.date) < 28;
  const last7 = news.filter(recent), previous7 = news.filter(prior), last28 = news.filter(month);
  const actionNews = news.filter(n => n.signals.action);
  const share = (ns, type) => ns.filter(n => n.signals[type]).length / Math.max(ns.length, 1);
  const days = ns => uniq(ns.map(n => n.date)).length;
  const availableDays = difference(asOf, start) + 1;
  const features = [Math.log1p(last7.length), days(last7) / 7, share(last7, 'action'), share(last28, 'action'), share(news, 'action'), days(last7.filter(n => n.signals.action)) / 7,
    share(last7, 'action') - share(previous7, 'action'), share(last7, 'threat'), share(last7, 'posture'), share(last7, 'cooperation'), actionNews.length ? Math.min(30, difference(asOf, actionNews.at(-1).date)) / 30 : 1,
    days(last28) / 28, availableDays / MAX_HISTORY, Math.log1p(news.length)];
  const newestDate = news.at(-1)?.date || null;
  const latestNewsAge = newestDate ? difference(asOf, newestDate) : null;
  return { start, news, suppliedCount: supplied.length, excludedIrrelevantCount: supplied.length - related.length, excludedDuplicateCount: related.length - news.length, newestDate, latestNewsAge, fresh: latestNewsAge !== null && latestNewsAge <= MAX_NEWS_AGE_DAYS, features, availableDays, activeDays: days(news), recentAction: last7.some(n => n.signals.action), recentDays: days(last28) };
}

function rollingSamples(cases, model) {
  const samples = [], excluded = { insufficient_history_news: 0, stale_history_news: 0, future_coverage_unknown: 0 };
  for (const c of cases.slice().sort((a, b) => a.case_id.localeCompare(b.case_id))) {
    const news = analyzedNews(c, model);
    for (let asOf = addDays(c.news_start, MIN_HISTORY - 1); addDays(asOf, 7) <= c.news_end; asOf = addDays(asOf, 7)) {
      const hist = historyData(c, news, asOf);
      if (hist.news.length < MIN_NEWS || hist.recentDays < 3) { excluded.insufficient_history_news++; continue; }
      if (!hist.fresh) { excluded.stale_history_news++; continue; }
      const future = news.filter(n => !n.duplicate_of && n.signals.relevant && n.signals.scope_verified && n.date > asOf && n.date <= addDays(asOf, 7));
      const futureDays = uniq(future.map(n => n.date)).length;
      if (futureDays < MIN_FUTURE_DAYS) { excluded.future_coverage_unknown++; continue; }
      samples.push({ case_id: c.case_id, as_of: asOf, label_end: addDays(asOf, 7), history_days: hist.availableDays, news_count: hist.news.length, future_news_days: futureDays, x: hist.features, y: Number(future.some(n => n.signals.action)), persistence: Number(hist.recentAction) });
    }
  }
  return { samples, excluded };
}

function fitLogistic(samples, lambda) {
  if (!samples.length) throw new Error('没有可用周锚点');
  const n = samples.length, p = FEATURE_DEFS.length;
  const means = Array.from({ length: p }, (_, j) => samples.reduce((s, r) => s + r.x[j], 0) / n);
  const scales = means.map((m, j) => Math.max(0.05, Math.sqrt(samples.reduce((s, r) => s + (r.x[j] - m) ** 2, 0) / n)));
  const standardized = samples.map(r => r.x.map((x, j) => (x - means[j]) / scales[j]));
  const positive = samples.reduce((s, r) => s + r.y, 0), rate = (positive + 1) / (n + 2);
  const weights = Array(p).fill(0); let intercept = Math.log(rate / (1 - rate));
  for (let iter = 0; iter < 1600; iter++) {
    const gradient = Array(p).fill(0); let interceptGradient = 0;
    for (let i = 0; i < n; i++) { const z = intercept + standardized[i].reduce((s, x, j) => s + x * weights[j], 0); const error = sigmoid(z) - samples[i].y; interceptGradient += error; for (let j = 0; j < p; j++) gradient[j] += error * standardized[i][j]; }
    const step = 0.08 / (1 + iter / 1600);
    intercept -= step * interceptGradient / n;
    for (let j = 0; j < p; j++) weights[j] -= step * (gradient[j] / n + lambda * weights[j] / n);
  }
  return { type: 'regularized_logistic_regression', lambda, means, scales, weights, intercept, base_rate: rate, training_sample_count: n, positives: positive, negatives: n - positive, feature_names: FEATURE_DEFS.map(x => x[0]) };
}

function forecastProbability(fit, x) { return sigmoid(fit.intercept + x.reduce((s, value, j) => s + (value - fit.means[j]) / fit.scales[j] * fit.weights[j], 0)); }

function metrics(samples, fit) {
  if (!samples.length) return { sample_count: 0, brier: null, log_loss: null, accuracy: null, positives: 0, negatives: 0, target_semantics: 'weak_news_proxy_validation' };
  let brier = 0, logloss = 0, baseline = 0, baselineLogloss = 0, baselineCorrect = 0, persistence = 0, tp = 0, tn = 0, fp = 0, fn = 0;
  for (const r of samples) {
    const q = forecastProbability(fit, r.x), p = clip(q);
    brier += (q - r.y) ** 2; logloss -= r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p); baseline += (fit.base_rate - r.y) ** 2; persistence += (r.persistence - r.y) ** 2;
    baselineLogloss -= r.y * Math.log(clip(fit.base_rate)) + (1 - r.y) * Math.log(1 - clip(fit.base_rate));
    baselineCorrect += Number(Number(fit.base_rate >= 0.5) === r.y);
    if (q >= 0.5) r.y ? tp++ : fp++; else r.y ? fn++ : tn++;
  }
  return { sample_count: samples.length, positives: tp + fn, negatives: tn + fp, brier: round(brier / samples.length), log_loss: round(logloss / samples.length), accuracy: round((tp + tn) / samples.length), confusion: { tp, tn, fp, fn }, baseline_brier: round(baseline / samples.length), baseline_log_loss: round(baselineLogloss / samples.length), baseline_accuracy: round(baselineCorrect / samples.length), persistence_brier: round(persistence / samples.length), target_semantics: 'weak_news_proxy_validation', independently_verified_real_event_labels: false };
}

export function buildResearchModel({ trainingCases, validationCases = [], pilotAnnotations, pilotPairs, aliases = {} }) {
  if (!Array.isArray(trainingCases) || !trainingCases.length) throw new Error('需要真实训练案例');
  const detector = fitDetector(pilotAnnotations || [], pilotPairs || []);
  const partial = { detector, aliases };
  const trainResult = rollingSamples(trainingCases, partial);
  const train = trainResult.samples;
  if (train.length < 8 || !train.some(r => r.y === 1) || !train.some(r => r.y === 0)) throw new Error('覆盖充分的训练周缺少足够的正负代理样本，不能拟合概率');
  const trainLabelEnd = maxDate(train.map(r => r.label_end));
  const detectorCutoff = maxDate([detector.trained_through, ...trainingCases.map(c => c.news_end)]);
  const validationResult = rollingSamples(validationCases, partial);
  const validation = validationResult.samples.filter(r => r.as_of > trainLabelEnd && r.as_of >= detectorCutoff);
  const purged = validationResult.samples.length - validation.length;
  const leaderboard = [0.1, 1, 10, 50].map(lambda => { const fit = fitLogistic(train, lambda); return { lambda, fit, metrics: metrics(validation, fit) }; });
  leaderboard.sort((a, b) => validation.length ? a.metrics.log_loss - b.metrics.log_loss || b.lambda - a.lambda : Math.abs(a.lambda - 10) - Math.abs(b.lambda - 10));
  const selected = leaderboard[0];
  const finalSamples = [...train, ...validation];
  const finalFit = fitLogistic(finalSamples, selected.lambda);
  const trainedThrough = maxDate([detectorCutoff, ...finalSamples.map(r => r.label_end)]);
  const trainingHash = createHash('sha256').update(JSON.stringify({ trainingCases, validationCases, pilotAnnotations, aliases })).digest('hex');
  return {
    schema_version: 1, detector_rule_version: DETECTOR_RULE_VERSION, model_type: 'cameo19_observed_news_week_ahead_research', target: TARGET,
    sample_dependence_note: 'Rolling historical windows overlap and the same article may appear under several cases; samples are correlated and validation uncertainty is not estimated as independent trials.',
    target_semantics: 'Probability that the supplied news stream contains at least one automatically detected CAMEO-19 report in the next 7 days; not independently verified real-event occurrence probability.',
    detector, aliases, forecast: finalFit, trained_through: trainedThrough,
    minimum_history_days: MIN_HISTORY, maximum_history_days: MAX_HISTORY,
    historical_window_note: '训练使用28–92天可用历史；并非每个锚点均有完整三个月。',
    minimum_history_news: MIN_NEWS, minimum_future_news_days: MIN_FUTURE_DAYS,
    maximum_news_age_days: MAX_NEWS_AGE_DAYS,
    coverage_semantics: 'Only case-relevant, scope-configured, unique normalized full texts count. Earliest publication wins across IDs/dates; exact reprints cannot refresh coverage. Both training and inference require 10 unique articles, 3 relevant days in the past 28 days, and latest relevant unique article no older than 7 days. Future coverage uses unique relevant texts too.',
    training_sample_count: train.length, validation_sample_count: validation.length, final_training_sample_count: finalSamples.length,
    training_case_count: uniq(train.map(r => r.case_id)).length, validation_case_count: uniq(validation.map(r => r.case_id)).length,
    training_proxy_positives: train.filter(r => r.y).length, training_proxy_negatives: train.filter(r => !r.y).length,
    validation_metrics: selected.metrics, validation_leaderboard: leaderboard.map(r => ({ lambda: r.lambda, ...r.metrics })),
    training_period: { first_anchor: train.map(r => r.as_of).sort()[0], last_label_end: trainLabelEnd },
    validation_period: { first_anchor: validation.map(r => r.as_of).sort()[0] || null, last_label_end: maxDate(validation.map(r => r.label_end)) },
    excluded_samples: { train: trainResult.excluded, validation: validationResult.excluded, validation_time_purge: purged },
    provenance: { source: 'project news and GPT/Codex pilot evidence only', input_sha256: trainingHash, test_used_for_training: false, gold_accessed: false, artificial_training_examples: false, labels: 'detector-derived future-report proxy; zero means no detected report in covered supplied news, not absence of real action', calibrated_real_event_probability: false, future_coverage_selection: 'Only historical anchors with at least 3 distinct future news days are labelled. This creates selection bias; metrics and fitted probabilities describe the covered supplied-news subset, not an arbitrary future week.', future_coverage_used_as_inference_feature: false, normalization_fit: 'train-only during selection; train+eligible-validation for final fit', text_coverage: 'complete cleaned article for scope and event extraction; no fixed character or sentence cutoff; pilot irrelevant-example training prefix remains 1000 characters' },
  };
}

export function summarizeModel(model) {
  return {
    model_type: model.model_type, target: model.target, target_kind: 'weak_supervision_proxy', trained_through: model.trained_through,
    detector_rule_version: model.detector_rule_version, sample_dependence_note: model.sample_dependence_note,
    training_sample_count: model.training_sample_count, validation_sample_count: model.validation_sample_count,
    training_case_count: model.training_case_count, validation_case_count: model.validation_case_count, coverage_semantics: model.coverage_semantics,
    maximum_news_age_days: model.maximum_news_age_days,
    final_training_sample_count: model.final_training_sample_count, minimum_history_days: model.minimum_history_days,
    maximum_history_days: model.maximum_history_days, historical_window_note: model.historical_window_note,
    training_proxy_positives: model.training_proxy_positives, training_proxy_negatives: model.training_proxy_negatives,
    validation_metrics: model.validation_metrics, detector_examples: model.detector.examples, selected_lambda: model.forecast.lambda,
    validation_beats_base_rate_brier: model.validation_metrics.brier !== null && model.validation_metrics.brier < model.validation_metrics.baseline_brier,
    excluded_samples: model.excluded_samples, probability_calibrated: false, real_event_probability_available: false,
    future_coverage_condition: '训练仅纳入未来7天至少3个有相关报道日的历史窗口，存在覆盖条件筛选偏差；推断不读取未来覆盖。',
    note: '只验证未来报道代理标签；尚无完整独立七天事件真值，不是实际事件概率或真实冲突准确率。',
  };
}

export function analyzeCase(caseRecord, { asOf = caseRecord.news_end, model }) {
  if (!model || model.schema_version !== 1) throw new Error('研究模型版本无效');
  if (model.detector_rule_version !== DETECTOR_RULE_VERSION) throw new Error('模型与事件识别或覆盖规则版本不一致，请运行node build-model.mjs重新训练。');
  validateCase(caseRecord); dateNumber(asOf);
  if (asOf < caseRecord.news_start || asOf > caseRecord.news_end) throw new Error('预测截止日必须位于导入新闻历史范围内');
  // Future text is never passed to the detector or feature builder.
  const suppliedPast = caseRecord.news.filter(n => n.date <= asOf);
  const pastCase = { ...caseRecord, news: suppliedPast };
  const analyzed = analyzedNews(pastCase, model);
  const history = historyData(caseRecord, analyzed, asOf);
  const scopeVerified = suppliedPast.length ? analyzed.some(n => n.signals.scope_verified) : Boolean(model.aliases?.cases?.[caseRecord.case_id]);
  let reason = null;
  if (asOf < model.trained_through) reason = '该截止日早于模型训练资料截止日，只显示历史，避免未来训练信息回流。';
  else if (history.availableDays < MIN_HISTORY) reason = '历史不足28天，暂不计算实验概率。';
  else if (!scopeVerified) reason = '研究对象未配置：请使用项目案例ID或在导入数据中提供英文actors关键词。';
  else if (history.news.length < MIN_NEWS || history.recentDays < 3) reason = '与研究对象相关的新闻不足10篇，或近28天相关报道不足3个日期，暂不计算实验概率。';
  else if (!history.fresh) reason = '最近一篇相关且去重后的新闻距截止日已超过7天，报道过时，暂不计算实验概率。';
  const value = reason ? null : round(forecastProbability(model.forecast, history.features));
  const publishers = {};
  for (const n of history.news) publishers[n.publisher || '未提供来源'] = (publishers[n.publisher || '未提供来源'] || 0) + 1;
  const timeline = [];
  for (let date = history.start; date <= asOf; date = addDays(date, 1)) {
    const ns = history.news.filter(n => n.date === date);
    timeline.push({ date, news_count: ns.length, action_count: ns.filter(n => n.signals.action).length, threat_count: ns.filter(n => n.signals.threat).length, posture_count: ns.filter(n => n.signals.posture).length, cooperation_count: ns.filter(n => n.signals.cooperation).length });
  }
  const totals = key => history.news.filter(n => n.signals[key]).length;
  const events = history.news.flatMap(n => n.signals.events).sort((a, b) => b.published_date.localeCompare(a.published_date) || a.id.localeCompare(b.id)).slice(0, 120);
  const explanation = history.features.map((x, j) => ({ feature: FEATURE_DEFS[j][0], label: FEATURE_DEFS[j][1], value: round(x), contribution: round((x - model.forecast.means[j]) / model.forecast.scales[j] * model.forecast.weights[j]) })).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 6);
  const quality = [
    { level: 'info', message: '数值为未来七天军事行动报道的弱监督实验概率，未校准为真实事件发生概率。' },
    { level: 'info', message: model.historical_window_note },
    { level: 'info', message: '时间线按报道日排列；自动候选的实际发生日期未核验，不能直接作完整事件清单。' },
  ];
  if (reason) quality.push({ level: 'warning', message: reason });
  if (history.excludedIrrelevantCount) quality.push({ level: 'info', message: '已从历史覆盖、特征和信号统计中排除' + history.excludedIrrelevantCount + '篇无关或范围未确认的新闻。' });
  if (history.excludedDuplicateCount) quality.push({ level: 'info', message: '已排除' + history.excludedDuplicateCount + '篇正文完全重复的相关报道，保留最早已知报道；未自动合并近似转载或同一事件的不同报道。' });
  if (history.activeDays / Math.max(history.availableDays, 1) < 0.5) quality.push({ level: 'warning', message: '历史报道日覆盖低于一半；无报道日不代表无事件。' });
  if (Object.keys(publishers).length === 1) quality.push({ level: 'warning', message: '本批历史只有一个媒体来源，结果可能受到报道选择影响。' });
  if (model.validation_metrics.brier !== null && model.validation_metrics.brier >= model.validation_metrics.baseline_brier) quality.push({ level: 'warning', message: '目前验证集上，模型Brier误差未优于恒定发生率基线；实验数值尚不支持优于简单基准的结论。' });
  if (model.validation_metrics.brier !== null && Number.isFinite(model.validation_metrics.persistence_brier) && model.validation_metrics.brier >= model.validation_metrics.persistence_brier) quality.push({ level: 'warning', message: '目前验证集上，模型Brier误差未优于上一周延续基线；不能据此认定复杂预测优于近期状态延续。' });
  const afterCount = caseRecord.news.filter(n => n.date > asOf).length;
  if (afterCount) quality.push({ level: 'info', message: '已排除截止日之后的' + afterCount + '篇新闻；未用于检测、特征或预测。' });
  return {
    case: { case_id: caseRecord.case_id, countries_regions: caseRecord.countries_regions || '', target_situation: caseRecord.target_situation || '', news_start: caseRecord.news_start, news_end: caseRecord.news_end },
    as_of: asOf, forecast_window: { start: addDays(asOf, 1), end: addDays(asOf, 7), horizon_days: 7 },
    history: { start: history.start, end: asOf, available_days: history.availableDays, news_count: history.news.length, supplied_news_count: history.suppliedCount, excluded_irrelevant_count: history.excludedIrrelevantCount, excluded_duplicate_count: history.excludedDuplicateCount, latest_relevant_news_date: history.newestDate, latest_relevant_news_age_days: history.latestNewsAge, maximum_news_age_days: MAX_NEWS_AGE_DAYS, excluded_future_count: afterCount, active_days: history.activeDays, coverage_rate: round(history.activeDays / Math.max(history.availableDays, 1)), publishers, observed_event_days: uniq(history.news.filter(n => n.signals.action).map(n => n.date)).length },
    probability: { available: value !== null, value, target: TARGET, kind: 'weak_supervision_proxy', real_event_probability: null, reason, band: value === null ? 'insufficient' : value >= 0.7 ? 'higher' : value >= 0.4 ? 'middle' : 'lower' },
    baselines: { base_rate: round(model.forecast.base_rate), persistence: Number(history.recentAction), semantics: '未来报道代理标签的历史基准和上一周延续' },
    signals: { military_actions: totals('action'), threats: totals('threat'), posture: totals('posture'), negotiations: totals('cooperation'), semantics: '候选报道篇数，同一现实事件可能被多篇报道' },
    events, timeline, data_quality: quality, explanation, model_info: summarizeModel(model),
  };
}

export const researchInternals = { dateNumber, addDays, fitLogistic, forecastProbability, historyData, rollingSamples, metrics };

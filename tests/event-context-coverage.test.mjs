import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { analyzeCase, extractArticleSignals, researchInternals, DETECTOR_RULE_VERSION } from '../lib/engine.mjs';
const frozen = JSON.parse(fs.readFileSync(new URL('../artifacts/research-model.json', import.meta.url), 'utf8'));
const model = { ...frozen, detector_rule_version: DETECTOR_RULE_VERSION, detector: { prior_log_odds: 0, log_ratios: {} } };
const day = researchInternals.addDays;
const sig = (text, date = '2025-06-01', title = 'Russia and Ukraine update') => extractArticleSignals({case_id:'S001'}, {news_id:'check',date,title,text}, model);
const makeCase = (length = 56) => ({
  case_id:'CONTEXT_COVERAGE_FIXTURE', actors:['Alpha','Beta'], news_start:'2025-06-01', news_end:day('2025-06-01', length-1),
  news:Array.from({length},(_,i)=>({news_id:'n'+i,date:day('2025-06-01',i),title:'Alpha and Beta officials held talks',text:`Alpha and Beta officials held peace talks. Dispatch number ${i}.`,publisher:'Synthetic regression only'})),
});

test('discussion and condemnation participants are not combat participants', () => {
  for(const text of [
    'Russia and Ukraine discussed Israeli airstrikes against Gaza.',
    'Russia launched airstrikes against Syria and Ukraine officials condemned the attack.',
    'Ukraine officials said Israel launched airstrikes against Gaza.',
  ]) assert.equal(sig(text).action,false,text);
  assert.equal(sig('Russia said it launched airstrikes against Ukraine.').action,true);
  assert.equal(sig('Russian forces, officials said, launched airstrikes against Ukraine.').action,true);
});

test('negated deployment and talks are not historical predictive signals', () => {
  assert.equal(sig('Russia did not deploy troops to Ukraine.').posture,false);
  assert.equal(sig('Russia and Ukraine did not hold talks.').cooperation,false);
  assert.equal(sig('Russia deployed troops near Ukraine.').posture,true);
  assert.equal(sig('Russia and Ukraine held talks.').cooperation,true);
});

test('assertion scope preserves territorial adjectives and respects adjacent claim denial', () => {
  assert.equal(sig('Russia launched airstrikes against Ukraine, causing damage to a disputed border village.').action,true);
  const denied=sig('Russia launched airstrikes against Ukraine. This claim was denied by both governments.');
  assert.equal(denied.action,false);
  assert.equal(denied.events[0].status,'uncertain');
  assert.equal(sig('Russia launched airstrikes against Ukraine. The meeting was denied by both governments.').action,true);
  // A headline cannot independently override a contradiction in the body.
  assert.equal(sig('Russia denied launching airstrikes against Ukraine.', '2025-06-01', 'Russia launched airstrikes against Ukraine').action,false);
  const repeatedHeadline=sig('Russia launched airstrikes against Ukraine. This claim was denied by both governments.', '2025-06-01', 'Russia launched airstrikes against Ukraine.');
  assert.equal(repeatedHeadline.action,false);
  assert.equal(repeatedHeadline.events[0].assertion_status,'disputed');
});

test('a warning of airstrikes is a threat signal, not a completed action', () => {
  const warning=sig('Russia warned of airstrikes in Ukraine.');
  assert.equal(warning.action,false);
  assert.equal(warning.threat,true);
});

test('calendar formats, year boundaries and future reference dates agree in the full detector', () => {
  assert.equal(sig('On December 31, 2024, Russia launched airstrikes against Ukraine.','2025-01-01').action,true);
  assert.equal(sig('Russia launched airstrikes against Ukraine on 3 January.').action,false);
  assert.equal(sig('Russia launches airstrikes against Ukraine on June 20.').action,false);
  assert.equal(sig('Russia launched airstrikes against Ukraine yesterday.').action,true);
  assert.equal(sig('On May 31st, Russia launched airstrikes against Ukraine.').action,true);
});

test('old unique news is insufficient even when 10 articles and 3 recent-month days remain', () => {
  const c=makeCase(42);
  // Two weeks of unique related articles, then three weeks without any update.
  c.news=c.news.filter((_,i)=>i<14);
  const result=analyzeCase(c,{asOf:day(c.news_start,34),model});
  assert.equal(result.history.news_count,14);
  assert.equal(result.probability.available,false);
  assert.match(result.probability.reason,/超过7天/);
  assert.equal(result.history.latest_relevant_news_age_days,21);
  const training=researchInternals.rollingSamples([c],model);
  assert.ok(training.excluded.stale_history_news>0);
});

test('verbatim reprints with changed IDs, headlines and dates cannot satisfy coverage', () => {
  const c=makeCase(30);
  c.news=c.news.map((n,i)=>({...n,title:'Report '+i,text:'Alpha and Beta officials held peace talks.'}));
  const r=analyzeCase(c,{model});
  assert.equal(r.history.news_count,1);
  assert.equal(r.history.excluded_duplicate_count,29);
  assert.equal(r.probability.available,false);
  assert.equal(r.history.latest_relevant_news_date,'2025-06-01');
});

test('extra exact copies leave all usable features and probabilities unchanged', () => {
  const c=makeCase();
  const first=analyzeCase(c,{model});
  const copies=c.news.map(n=>({...n,news_id:'copy-'+n.news_id,publisher:'A second outlet'}));
  const second=analyzeCase({...c,news:[...c.news,...copies]},{model});
  assert.equal(first.probability.available,true);
  assert.equal(first.probability.value,second.probability.value);
  assert.deepEqual(first.explanation,second.explanation);
  assert.equal(second.history.excluded_duplicate_count,c.news.length);
  assert.equal(first.history.news_count,second.history.news_count);
});

test('future copies do not provide new label coverage and cannot alter a past forecast', () => {
  const c=makeCase(),cutoff=day(c.news_start,27);
  const old=analyzeCase(c,{asOf:cutoff,model});
  const changed={...c,news:c.news.map((n,i)=>i>=28?{...n,text:c.news[i%10].text}:n)};
  assert.equal(analyzeCase(changed,{asOf:cutoff,model}).probability.value,old.probability.value);
  assert.ok(!researchInternals.rollingSamples([changed],model).samples.some(r=>r.as_of===cutoff));
});

test('earlier-sorting unrelated copies cannot suppress usable related observations', () => {
  const c=makeCase();
  const before=analyzeCase(c,{model});
  // The body matches, but the sports headline makes these copies irrelevant.
  // Their smaller IDs must not let them become representatives of valid news.
  const unrelated=c.news.map(n=>({...n,news_id:'A-'+n.news_id,title:'Brazil football update'}));
  const augmented={...c,news:[...c.news,...unrelated]};
  const after=analyzeCase(augmented,{model});
  assert.equal(before.probability.available,true);
  assert.equal(after.history.news_count,before.history.news_count);
  assert.equal(after.probability.value,before.probability.value);
  assert.deepEqual(after.explanation,before.explanation);
  assert.deepEqual(after.timeline,before.timeline);
  assert.equal(after.history.excluded_irrelevant_count,unrelated.length);
  assert.deepEqual(researchInternals.rollingSamples([augmented],model).samples,researchInternals.rollingSamples([c],model).samples);
});

test('an unrelated asserted action cannot lend assertion status to a negated in-scope action', () => {
  const text='Russia did not attack Ukraine, but Israel launched airstrikes against Gaza.';
  const result=sig(text);
  assert.equal(result.action,false);
  assert.ok(!result.events.some(e=>e.code.startsWith('19') && e.status==='candidate'));
  assert.equal(sig('Russia launched airstrikes against Ukraine, but Israel denied attacks against Gaza.').action,true);
  const coordinated=sig('Russia did not attack Ukraine, but shelled Ukrainian positions.');
  assert.equal(coordinated.action,true);
  assert.ok(coordinated.events.some(e=>e.status==='candidate' && e.relation.inherited_clause_subject));
  assert.equal(sig('Russia not only attacked Ukraine but also shelled Ukrainian positions.').action,true);
  const differentKind=sig('Russian forces attacked Ukraine but did not hold talks.');
  assert.equal(differentKind.action,true);
  assert.equal(differentKind.cooperation,false);
});

test('month abbreviation periods cannot detach temporal context from the event sentence', () => {
  const historical=sig('On 3 Jan. Russia launched airstrikes against Ukraine.');
  assert.equal(historical.action,false);
  assert.ok(historical.events.some(e=>e.code.startsWith('19') && e.temporal.status==='historical'));
  const recent=sig('On 31 Dec. Russia launched airstrikes against Ukraine.','2025-01-01');
  assert.equal(recent.action,true);
  assert.ok(recent.events.some(e=>e.code.startsWith('19') && e.temporal.status==='current'));
});

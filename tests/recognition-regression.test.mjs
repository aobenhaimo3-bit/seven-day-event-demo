import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractArticleSignals, analyzeCase, researchInternals, DETECTOR_RULE_VERSION } from '../lib/engine.mjs';
import { MODEL_PATH } from '../lib/data.mjs';
import { loadSources, buildCases } from '../scripts/prepare-input.mjs';

const frozen = JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8'));
const aliases = JSON.parse(fs.readFileSync(new URL('../research/case_aliases.json', import.meta.url), 'utf8'));
// Neutral lexical score isolates the semantic gates from fitted word weights.
const model = { ...frozen, detector_rule_version: DETECTOR_RULE_VERSION, aliases, detector: { prior_log_odds: 0, log_ratios: {} } };
const russia = { case_id: 'S001' };
const article = text => ({ news_id: 'regression-only', date: '2025-06-01', title: text, text, publisher: 'Unit-test fixture only' });
const signal = (text, record = russia) => extractArticleSignals(record, article(text), model);
const day = researchInternals.addDays;
const caseFixture = () => ({
  case_id: 'COVERAGE_FIXTURE', actors: ['Alpha', 'Beta'], news_start: '2025-06-01', news_end: '2025-07-12',
  news: Array.from({ length: 42 }, (_, i) => ({ ...article(i % 14 < 7 ? 'Alpha troops launched airstrikes against Beta forces.' : 'Alpha and Beta officials held peace talks.'), news_id: `related-${i}`, text: (i % 14 < 7 ? 'Alpha troops launched airstrikes against Beta forces.' : 'Alpha and Beta officials held peace talks.') + ' Dispatch number ' + i + '.', date: day('2025-06-01', i) })),
});
const irrelevant = n => ({ ...n, news_id: 'unrelated-' + n.news_id, title: 'Brazil football tournament update', text: 'Brazil football players attended a local tournament.' });

test('one actor and its capital cannot establish a two-actor case; local theatre remains usable', () => {
  assert.equal(signal('Russia says in Moscow that Israel launched airstrikes against Syria.').relevant, false);
  assert.equal(signal('Russian forces shelled Donetsk today.').action, true);
  assert.equal(signal('Russia launched airstrikes against Ukraine today.').action, true);
});

test('a relevant article does not transfer scope to unrelated sentences or semicolon clauses', () => {
  for (const separator of ['. ', '; ']) {
    const n = { ...article('Russia and Ukraine held peace talks'), text: `Russia and Ukraine held peace talks${separator}Israel launched airstrikes against Gaza.` };
    const s = extractArticleSignals(russia, n, model);
    assert.equal(s.relevant, true);
    assert.equal(s.action, false);
    assert.ok(!s.events.some(e => e.code.startsWith('19')));
  }
});

test('an immediate pronominal continuation can retain an explicitly scoped actor context', () => {
  const s = extractArticleSignals(russia, { ...article('Russia and Ukraine border update'), text: 'Russia and Ukraine troops confronted each other. They exchanged gunfire near the border.' }, model);
  assert.equal(s.action, true);
});

test('denials, disputed assertions and attack preparations do not enter action counts', () => {
  for (const text of [
    'Russia denied launching airstrikes against Ukraine.',
    'Russia denies reports of an attack on Ukraine.',
    'Russia refuted claims of shelling Ukraine.',
    'Moscow accused Kyiv of a military buildup and denied suggestions it is preparing an attack.',
    'Russia is preparing an attack on Ukraine.',
    'Russia claimed it had launched airstrikes against Ukraine.',
    'Ukraine said Russia could not be independently verified to have launched airstrikes.',
  ]) assert.equal(signal(text).action, false, text);
  const denied = signal('Russia denied launching airstrikes against Ukraine.');
  assert.equal(denied.events[0].status, 'uncertain');
  assert.equal(signal('Russia launched airstrikes against Ukraine.').action, true);
});

test('deployment, weapon capability and naval or joint exercises are not combat', () => {
  for (const text of [
    'Russia deployed missile-equipped fighter jets near Ukraine for naval exercises.',
    'Russia practised airstrikes against Ukraine during joint exercises.',
    'Russia says its missiles can hit targets in Ukraine at a range of 2,000 km.',
    'Russia deployed missiles near Ukraine.',
  ]) assert.equal(signal(text).action, false, text);
  assert.equal(signal('Russia fired missiles at Ukraine troops.').action, true);
});

test('historical dates are excluded while current facts survive independent future and comparison clauses', () => {
  for (const text of ['On January 3, Russia launched airstrikes against Ukraine.', 'Last month Russia launched airstrikes against Ukraine.', 'In 2023 Russia launched airstrikes against Ukraine.']) assert.equal(signal(text).action, false, text);
  for (const text of [
    'On May 31, Russia launched airstrikes against Ukraine.',
    'Russia launched airstrikes against Ukraine today and will meet diplomats tomorrow.',
    'Russia launched airstrikes against Ukraine today, the largest attack since 2023.',
  ]) assert.equal(signal(text).action, true, text);
  assert.equal(signal('Russia said it would attack Ukraine if its soldiers were killed.').action, false);
});

test('recommendation blocks cannot introduce signals and do not swallow following body prose', () => {
  const n = { ...article('Russia and Ukraine officials met for talks'), text: 'Russia and Ukraine officials held peace talks.\nKeep reading\nlist of 4 itemsRussia launches airstrikes against Ukraine\nRussia deploys troops to Ukraine\nRussia and Ukraine diplomats agreed to hold another meeting on Monday.' };
  const s = extractArticleSignals(russia, n, model);
  assert.equal(s.action, false);
  assert.equal(s.posture, false);
  const withBodyAction = { ...n, text: n.text + '\nRussia launched airstrikes against Ukraine troops later that evening.' };
  assert.equal(extractArticleSignals(russia, withBodyAction, model).action, true);
});

test('real training articles from the review no longer become Russia-Ukraine military actions', () => {
  const c = buildCases(loadSources(), { caseId: 'S001' })[0];
  for (const id of ['P3N00027', 'P3N00214', 'P3N02560']) {
    const n = c.news.find(n => n.news_id === id);
    assert.ok(n);
    assert.equal(extractArticleSignals(c, n, { ...frozen, aliases }).action, false, id);
  }
});

test('irrelevant-only input is withheld, with zero relevant coverage and an explicit exclusion count', () => {
  const c = caseFixture();
  c.news = c.news.map(irrelevant);
  const r = analyzeCase(c, { model });
  assert.equal(r.probability.available, false);
  assert.match(r.probability.reason, /相关/);
  assert.equal(r.history.news_count, 0);
  assert.equal(r.history.active_days, 0);
  assert.equal(r.history.excluded_irrelevant_count, 42);
  assert.equal(r.history.supplied_news_count, 42);
  assert.ok(r.timeline.every(d => d.news_count === 0));
});

test('adding unrelated news cannot change probability, feature denominators, signals or related coverage', () => {
  const c = caseFixture();
  const before = analyzeCase(c, { model });
  const after = analyzeCase({ ...c, news: [...c.news, ...c.news.map(irrelevant)] }, { model });
  assert.equal(before.probability.available, true);
  assert.equal(after.probability.value, before.probability.value);
  assert.deepEqual(after.explanation, before.explanation);
  assert.deepEqual(after.signals, before.signals);
  assert.deepEqual(after.timeline, before.timeline);
  assert.equal(after.history.news_count, before.history.news_count);
});

test('unrelated future stories cannot satisfy the label coverage condition', () => {
  const c = caseFixture(), cutoff = day(c.news_start, 27);
  const before = researchInternals.rollingSamples([c], model);
  assert.ok(before.samples.some(r => r.as_of === cutoff));
  const noRelatedFuture = { ...c, news: c.news.map(n => n.date > cutoff ? irrelevant(n) : n) };
  const after = researchInternals.rollingSamples([noRelatedFuture], model);
  assert.ok(!after.samples.some(r => r.as_of === cutoff));
  assert.ok(after.excluded.future_coverage_unknown > 0);
});

test('training and inference both reject stale related history despite dense unrelated recent news', () => {
  const c = caseFixture();
  c.news = c.news.map((n, i) => i >= 10 && i < 35 ? irrelevant(n) : n);
  // Ten old articles over seven days, then no related dates in the last 28 days.
  c.news = c.news.map((n, i) => i >= 7 && i < 10 ? { ...n, date: day(c.news_start, i - 7) } : n);
  const cutoff = day(c.news_start, 34);
  assert.equal(analyzeCase(c, { asOf: cutoff, model }).probability.available, false);
  assert.ok(!researchInternals.rollingSamples([c], model).samples.some(r => r.as_of === cutoff));
});

test('a model trained under older extraction and coverage rules cannot be used silently', () => {
  assert.throws(() => analyzeCase(caseFixture(), { model: { ...model, detector_rule_version: 'conservative-assertion-v3' } }), /重新训练/);
});

test('sports with actor names still cannot establish coverage and blank aliases are not configured', () => {
  const c = caseFixture();
  c.news = c.news.map(n => ({ ...n, title: 'Alpha and Beta football teams played a tournament', text: 'Alpha and Beta football teams played a tournament.' }));
  assert.equal(analyzeCase(c, { model }).history.news_count, 0);
  assert.equal(analyzeCase({ ...caseFixture(), actors: [' '] }, { model }).probability.available, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCase, buildResearchModel, extractArticleSignals, researchInternals } from '../lib/engine.mjs';

// These tiny artificial records are unit-test fixtures only. They must never enter the demo model or default datasets.
const add = researchInternals.addDays;
function fixtureCase(id, start, n = 84) {
  return { case_id: id, actors: ['Alpha', 'Beta'], countries_regions: 'unit-test fixture', target_situation: 'synthetic unit-test only', news_start: start, news_end: add(start, n - 1), news: Array.from({ length: n }, (_, i) => ({ news_id: id + '-' + i, date: add(start, i), title: i % 21 < 7 ? 'Alpha military attacked Beta forces with artillery' : 'Alpha and Beta held diplomatic talks', text: i % 21 < 7 ? 'Alpha troops attacked Beta military forces. Artillery shelling killed soldiers.' : 'Alpha and Beta officials met for peace talks.', publisher: 'unit-test fixture' })) };
}
const pilotPairs = [{ pair_id: 't:1', news: { date: '2020-01-01', title: 'Alpha troops attacked Beta', text: 'Alpha military forces attacked Beta with artillery and shelling killed soldiers.' } }, { pair_id: 't:2', news: { date: '2020-01-01', title: 'Alpha and Beta held talks', text: 'Alpha officials held diplomatic peace talks with Beta.' } }];
const pilotAnnotations = [{ pair_id: 't:1', split: 'train', relevance: 'yes', events: [{ cameo_code: '194', evidence_quote: pilotPairs[0].news.text }] }, { pair_id: 't:2', split: 'train', relevance: 'yes', events: [{ cameo_code: '04', evidence_quote: pilotPairs[1].news.text }] }];
const inputs = { trainingCases: [fixtureCase('TRAIN', '2020-01-01')], validationCases: [fixtureCase('VAL', '2021-01-01')], pilotAnnotations, pilotPairs, aliases: {} };
const model = buildResearchModel(inputs);

test('training uses actual rolling feature/label windows and serializes deterministically', () => {
  assert.ok(model.training_sample_count >= 8);
  assert.ok(model.training_proxy_positives > 0 && model.training_proxy_negatives > 0);
  assert.equal(JSON.stringify(model), JSON.stringify(buildResearchModel(inputs)));
  assert.equal(model.provenance.calibrated_real_event_probability, false);
});

test('future news is excluded before extraction and cannot change forecast features', () => {
  const c = fixtureCase('TEST', '2022-01-01'); const asOf = add(c.news_start, 60);
  const r = analyzeCase(c, { asOf, model });
  const changed = { ...c, news: c.news.map(n => n.date > asOf ? { ...n, title: 'Alpha military invasion and massive artillery attacks', text: 'Future data must not be used.' } : n) };
  const q = analyzeCase(changed, { asOf, model: JSON.parse(JSON.stringify(model)) });
  assert.deepEqual(r.explanation, q.explanation);
  assert.equal(r.probability.value, q.probability.value);
  assert.ok(r.events.every(e => e.published_date <= asOf));
  assert.equal(r.history.excluded_future_count, 23);
});

test('old cutoff, short history, and sparse coverage withhold numeric probability', () => {
  const old = analyzeCase(inputs.trainingCases[0], { model });
  assert.equal(old.probability.available, false);
  const c = fixtureCase('TEST', '2022-01-01');
  assert.equal(analyzeCase(c, { asOf: add(c.news_start, 10), model }).probability.available, false);
  assert.equal(analyzeCase({ ...c, news: c.news.slice(0, 2) }, { model }).probability.available, false);
  assert.equal(analyzeCase({ ...c, news: [] }, { model }).probability.available, false);
});

test('risk, drills, sports and aid do not become actual military action reports', () => {
  const c = fixtureCase('TEST', '2022-01-01');
  for (const title of ['Alpha and Beta football players clash in World Cup', 'Alpha army practises repelling air strikes near Beta', 'Alpha warns of risk of a possible military attack on Beta', 'Alpha military aid to Beta will not be used to attack']) {
    assert.equal(extractArticleSignals(c, { news_id: title, title, text: title, date: '2022-02-01' }, model).action, false, title);
  }
  assert.equal(extractArticleSignals(c, { news_id: 'a', title: 'Alpha air strikes hit Beta military forces', text: 'Alpha air strikes hit Beta military forces.', date: '2022-02-01' }, model).action, true);
});

test('real calendar dates, duplicate IDs and out-of-window records are rejected', () => {
  assert.throws(() => researchInternals.dateNumber('2024-02-31'));
  const c = fixtureCase('TEST', '2022-01-01');
  assert.throws(() => analyzeCase({ ...c, news: [...c.news, c.news[0]] }, { model }));
  assert.throws(() => analyzeCase(c, { asOf: '2022-12-01', model }));
});

test('police or terrorism language alone does not make criminal violence a military action', () => {
  const c = { ...fixtureCase('TEST', '2022-01-01'), actors: ['Gaza', 'Israel'] };
  const titles = [
    'Police detain a male suspect after witnesses report an attack near a march to remember Israeli captives held in Gaza.',
    'Police investigate a terror attack at a march for Gaza captives held in Israel.',
  ];
  for (const title of titles) assert.equal(extractArticleSignals(c, { news_id: title, title, text: title, date: '2025-06-01' }, model).action, false, title);
  const title = 'Police and armed militants exchanged gunfire near the Israel Gaza border';
  assert.equal(extractArticleSignals(c, { news_id: 'engagement', title, text: title, date: '2025-06-01' }, model).action, true);
});

test('conditional past verbs, warning nouns, negated airstrikes and month-dated history are not current actions', () => {
  const c = { ...fixtureCase('TEST', '2022-01-01'), actors: ['Russia', 'Ukraine'] };
  const negatives = [
    'Russia says airstrikes could be launched in Ukraine tomorrow',
    'Russia said it would attack Ukraine if its soldiers were killed',
    'In October 2023, Russia launched airstrikes in Ukraine',
    'Russia did not carry out airstrikes in Ukraine',
    'Russia warned of airstrikes in Ukraine',
  ];
  for (const title of negatives) {
    const r = extractArticleSignals(c, { news_id: title, title, text: title, date: '2025-06-01' }, model);
    assert.equal(r.action, false, title);
    assert.equal(r.events.some(e => e.code.startsWith('19') && e.status === 'candidate'), false, title);
  }
  const title = 'On May 3, Russia airstrikes hit Ukraine troops';
  assert.equal(extractArticleSignals(c, { news_id: 'may', title, text: title, date: '2025-06-01' }, model).action, true);
});

test('future labels can change without changing an anchor historical feature vector', () => {
  const c = fixtureCase('WINDOW', '2022-01-01');
  const cutoff = add(c.news_start, 27);
  const before = researchInternals.rollingSamples([c], model).samples.find(r => r.as_of === cutoff);
  const altered = { ...c, news: c.news.map(n => n.date > cutoff && n.date <= add(cutoff, 7)
    ? { ...n, title: 'Alpha air strikes hit Beta troops', text: 'Alpha air strikes hit Beta military forces.' } : n) };
  const after = researchInternals.rollingSamples([altered], model).samples.find(r => r.as_of === cutoff);
  assert.deepEqual(before.x, after.x);
  assert.equal(after.y, 1);
});

test('poorly covered future weeks remain unknown and do not silently become negatives', () => {
  const c = fixtureCase('WINDOW', '2022-01-01');
  const cutoff = add(c.news_start, 27);
  const sparse = { ...c, news: c.news.filter(n => !(n.date > cutoff && n.date <= add(cutoff, 7)) || n.date === add(cutoff, 1)) };
  const result = researchInternals.rollingSamples([sparse], model);
  assert.equal(result.samples.some(r => r.as_of === cutoff), false);
  assert.ok(result.excluded.future_coverage_unknown > 0);
});

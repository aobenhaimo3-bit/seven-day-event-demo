import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildEvaluationSet, prepareEvaluation, verifyReviewSources, LABEL_FIELDS } from '../scripts/prepare-evaluation.mjs';
import { acceptedReview, evaluateRecognition } from '../scripts/evaluate-recognition.mjs';

function fixtures() {
  return ['S016', 'S017', 'S018', 'S019', 'S020'].flatMap(case_id => Array.from({ length: 24 }, (_, i) => {
    const news_id = `${case_id}-N${i}`;
    const offset = [2, 32, 62][Math.floor(i / 8)] + i % 8;
    const date = new Date(Date.UTC(2025, 0, offset)).toISOString().slice(0, 10);
    return { pair_id: `${case_id}::${news_id}`, split: 'validation',
      case: { case_id, countries_regions: 'Unit fixture only', target_situation: 'Synthetic test only', news_start: '2025-01-01', news_end: '2025-03-31' },
      news: { news_id, title: 'Alpha and Beta news', text: `Alpha troops attacked Beta forces. Fixture ${i}.`, date, publisher: 'Unit fixture' },
    };
  }));
}
const labels = (action = false) => ({ relevance: true, action, threat: false, posture: false, cooperation: false });
function review(row, action = false, id = 'human-test-reviewer') {
  const judgement = { reviewer_type: 'human', reviewer_id: id, completed_at: '2026-11-04T10:00:00+08:00', labels: labels(action), evidence_quotes: action ? ['Alpha troops attacked Beta forces.'] : [], notes: 'Synthetic unit-test judgement, never a real human annotation.' };
  return { ...row, review_status: 'human-reviewed', labels: judgement.labels, reviews: [judgement] };
}

test('sampling is fixed, order independent, calendar stratified and prediction free', () => {
  const a = buildEvaluationSet(fixtures());
  const b = buildEvaluationSet(fixtures().reverse());
  assert.deepEqual(a, b);
  assert.equal(a.reviews.length, 60);
  for (const id of ['S016', 'S017', 'S018', 'S019', 'S020']) {
    for (const stratum of [0, 1, 2]) assert.equal(a.manifest.records.filter(r => r.case_id === id && r.time_stratum === stratum).length, 4);
  }
  assert.ok(a.reviews.every(r => r.labels === null && r.review_status === 'pending' && r.reviews.length === 0));
  assert.equal(a.manifest.independent_holdout, false);
});

test('training and held-out test rows are rejected instead of silently entering review selection', () => {
  for (const [split, case_id] of [['train', 'S001'], ['test', 'S021'], ['validation', 'S021']]) {
    const pair = fixtures()[0];
    assert.throws(() => buildEvaluationSet([{ ...pair, split, case: { ...pair.case, case_id } }]), /S016/);
  }
});

test('sparse date strata backfill deterministically without duplicating samples', () => {
  const pool = fixtures().filter(p => p.case.case_id === 'S016' && p.news.date <= '2025-02-15');
  const { manifest } = buildEvaluationSet(pool);
  assert.equal(manifest.records.length, 12);
  assert.equal(new Set(manifest.records.map(r => r.pair_id)).size, 12);
});

test('source edits, missing review rows and manifest mutation cannot change the evaluation silently', () => {
  const { manifest, reviews } = buildEvaluationSet(fixtures());
  verifyReviewSources(reviews, manifest);
  assert.throws(() => verifyReviewSources(reviews.slice(1), manifest), /全部固定样本/);
  const changed = structuredClone(reviews);
  changed[0].source.news.text = 'Different source text';
  assert.throws(() => verifyReviewSources(changed, manifest), /哈希/);
  assert.throws(() => verifyReviewSources(reviews, { ...manifest, seed: 'changed' }), /哈希/);
});

test('pending labels never become negatives and no detector is called before human review', () => {
  const { manifest, reviews } = buildEvaluationSet(fixtures());
  // A draft label does not make a pending row reviewed.
  reviews[0].labels = labels(false);
  const result = evaluateRecognition(reviews, manifest, () => { throw new Error('Must not predict'); });
  assert.equal(result.status, 'not_evaluable');
  assert.equal(result.metrics, null);
  assert.equal(result.coverage.reviewed, 0);
  assert.equal(result.coverage.excluded, 60);
});

test('partial human review computes transparent confusion matrices only on eligible rows', () => {
  const { manifest, reviews } = buildEvaluationSet(fixtures());
  reviews[0] = review(reviews[0], true);
  reviews[1] = review(reviews[1], false);
  const result = evaluateRecognition(reviews, manifest, () => labels(true));
  assert.equal(result.status, 'partially_evaluated');
  assert.equal(result.coverage.reviewed, 2);
  assert.equal(result.metrics.action.tp, 1);
  assert.equal(result.metrics.action.fp, 1);
  assert.equal(result.metrics.action.precision, 0.5);
  assert.equal(result.metrics.action.recall, 1);
  assert.equal(result.metrics.threat.precision, null);
  assert.equal(result.metrics.threat.recall, null);
  assert.equal(result.predictions.length, 2);
  assert.deepEqual(Object.keys(result.metrics), [...LABEL_FIELDS]);
});

test('auto labels, incomplete labels and invented quotes cannot masquerade as reviewed truth', () => {
  const row = buildEvaluationSet(fixtures()).reviews[0];
  const auto = review(row, true);
  auto.reviews[0].reviewer_type = 'model';
  assert.throws(() => acceptedReview(auto), /人工/);
  const incomplete = review(row, false);
  delete incomplete.labels.posture;
  assert.throws(() => acceptedReview(incomplete), /完整/);
  const invented = review(row, true);
  invented.reviews[0].evidence_quotes = ['Invented attack not in original'];
  assert.throws(() => acceptedReview(invented), /原文/);
});

test('conflicting human labels require an explicit adjudication record', () => {
  const row = buildEvaluationSet(fixtures()).reviews[0];
  const a = review(row, true, 'reviewer-A'), b = review(row, false, 'reviewer-B');
  a.reviews.push(b.reviews[0]);
  assert.throws(() => acceptedReview(a), /裁决/);
  a.review_status = 'needs_adjudication';
  assert.equal(acceptedReview(a), false);
  a.review_status = 'adjudicated';
  a.adjudication = { ...review(row, true, 'adjudicator-C').reviews[0] };
  assert.equal(acceptedReview(a), true);
});

test('repeat preparation preserves human edits and refuses a changed source pool', t => {
  const base = fs.realpathSync(os.tmpdir());
  const folder = fs.mkdtempSync(path.join(base, 'recognition-evaluation-'));
  t.after(() => {
    const resolved = fs.realpathSync(folder);
    if (path.dirname(resolved) !== base || !path.basename(resolved).startsWith('recognition-evaluation-')) throw new Error('Unsafe temporary cleanup path');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const inputPath = path.join(folder, 'validation_pairs.jsonl');
  const manifestPath = path.join(folder, 'manifest.json'), reviewPath = path.join(folder, 'review.jsonl');
  const pool = fixtures();
  const encode = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(inputPath, encode(pool));
  prepareEvaluation({ inputPath, manifestPath, reviewPath });
  const rows = fs.readFileSync(reviewPath, 'utf8').trim().split('\n').map(JSON.parse);
  rows[0] = review(rows[0], true);
  const edited = encode(rows);
  fs.writeFileSync(reviewPath, edited);
  assert.equal(prepareEvaluation({ inputPath, manifestPath, reviewPath }).existing_reviews_preserved, true);
  assert.equal(fs.readFileSync(reviewPath, 'utf8'), edited);
  pool[0].news.text += ' Changed';
  fs.writeFileSync(inputPath, encode(pool));
  assert.throws(() => prepareEvaluation({ inputPath, manifestPath, reviewPath }), /来源池或固定抽样/);
});

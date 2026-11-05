import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as currentEngine from '../lib/engine.mjs';
import { readDevelopmentData, trainingProvenance, ruleProvenance, PROJECT_ROOT } from '../lib/data.mjs';
import { loadFrozenModel } from '../server.mjs';

// Frozen v4 engine from the preceding repair, with a verified source hash.
// No network access, test news, test labels or validation-refitted predictions.
const BASELINE = 'scoped-assertion-v4';
const previousSource = fs.readFileSync(path.join(PROJECT_ROOT, 'research/baselines/scoped-assertion-v4-engine.mjs'), 'utf8');
const expectedHash = '7d36d35025ea125bf115c600ae7b2a15556bcaeb908b8439d9eb14c4109dd0c5';
if (createHash('sha256').update(previousSource).digest('hex') !== expectedHash) throw new Error('Frozen v4 baseline source changed; do not silently redefine the comparison.');
const previousEngine = await import('data:text/javascript;base64,' + Buffer.from(previousSource).toString('base64'));
const inputs = readDevelopmentData();
const previous = previousEngine.buildResearchModel(inputs);
const current = loadFrozenModel();
if (current.detector_rule_version !== 'event-context-coverage-v5') throw new Error('This historical comparison writes the v4 → v5 report. For the current v6 model use node scripts/compare-validation-v6.mjs; the historical report is preserved.');
const key = r => `${r.case_id}/${r.as_of}`;

function selectionData(engine, model) {
  const train = engine.researchInternals.rollingSamples(inputs.trainingCases, model).samples;
  const cutoff = [model.detector.trained_through, ...inputs.trainingCases.map(c => c.news_end)].sort().at(-1);
  const validation = engine.researchInternals.rollingSamples(inputs.validationCases, model).samples
    .filter(r => r.as_of > model.training_period.last_label_end && r.as_of >= cutoff);
  // The deployed model includes validation windows. Refit on TRAIN ONLY.
  const fit = engine.researchInternals.fitLogistic(train, model.forecast.lambda);
  return { train, validation, fit, byKey: new Map(validation.map(r => [key(r), r])) };
}
const old = selectionData(previousEngine, previous), fresh = selectionData(currentEngine, current);
const metrics = currentEngine.researchInternals.metrics;
const oldNative = metrics(old.validation, old.fit), newNative = metrics(fresh.validation, fresh.fit);
for (const [actual, expected] of [[oldNative, previous.validation_metrics], [newNative, current.validation_metrics]]) {
  for (const field of ['sample_count', 'positives', 'negatives', 'brier', 'log_loss', 'accuracy']) {
    if (actual[field] !== expected[field]) throw new Error(`Validation reconstruction mismatch: ${field}. Rebuild the model first.`);
  }
}
const common = fresh.validation.filter(r => old.byKey.has(key(r)));
const oldCommon = common.map(r => old.byKey.get(key(r)));
const report = {
  comparison_date: '2026-11-04', baseline_version: BASELINE,
  baseline_engine_sha256: createHash('sha256').update(previousSource).digest('hex'),
  current_source_sha256: ruleProvenance(),
  data_provenance: trainingProvenance(),
  evaluation_contract: {
    split_unchanged: true, fit_on_training_only: true, test_input_used: false, independent_gold_available: false,
    hyperparameters: 'Each version uses its own validation-selected lambda from the unchanged grid [0.1,1,10,50]. This is development validation, not an untouched test.',
    comparison_limit: 'Extraction and eligibility changed together, so native samples and targets may differ; inspect common_windows and changed_labels. Common-window matrices hold both windows and labels fixed, in both label definitions; neither label definition is independent gold.',
    scope_limit: 'Conservative lexical scope gates do not implement full actor-relation extraction. False negatives and residual false positives remain possible.',
  },
  native: {
    before: { rule_version: previous.detector_rule_version, train_windows: old.train.length, validation_cases: new Set(old.validation.map(r => r.case_id)).size, lambda: previous.forecast.lambda, metrics: oldNative },
    after: { rule_version: current.detector_rule_version, train_windows: fresh.train.length, validation_cases: new Set(fresh.validation.map(r => r.case_id)).size, lambda: current.forecast.lambda, metrics: newNative },
  },
  common_windows: {
    count: common.length, changed_labels: common.filter((r, i) => r.y !== oldCommon[i].y).length,
    evaluated_on_old_labels: {
      before: metrics(oldCommon, old.fit),
      after: metrics(common.map((r, i) => ({ ...r, y: oldCommon[i].y })), fresh.fit),
    },
    evaluated_on_new_labels: {
      before: metrics(oldCommon.map((r, i) => ({ ...r, y: common[i].y })), old.fit),
      after: metrics(common, fresh.fit),
    },
    note: 'Persistence uses each version’s own historical action detector; constant baselines use each version’s training rate.',
  },
  dropped_validation_windows: old.validation.filter(r => !fresh.byKey.has(key(r))).map(r => ({ key: key(r), old_label: r.y })),
  added_validation_windows: fresh.validation.filter(r => !old.byKey.has(key(r))).map(r => ({ key: key(r), new_label: r.y })),
  validation_predictions: [...new Set([...old.byKey.keys(), ...fresh.byKey.keys()])].sort().map(id => {
    const a = old.byKey.get(id), b = fresh.byKey.get(id);
    return { key: id,
      before: a ? { label: a.y, probability: previousEngine.researchInternals.forecastProbability(old.fit, a.x), persistence: a.persistence } : null,
      after: b ? { label: b.y, probability: currentEngine.researchInternals.forecastProbability(fresh.fit, b.x), persistence: b.persistence } : null,
    };
  }),
};
const output = path.join(PROJECT_ROOT, 'research', 'validation-comparison.json');
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ native: report.native, common_windows: report.common_windows, dropped_validation_windows: report.dropped_validation_windows, output }, null, 2));

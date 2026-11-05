import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_DATA_ROOT } from '../lib/data.mjs';
import { extractArticleSignals } from '../lib/engine.mjs';
import { loadFrozenModel } from '../server.mjs';
import { LABEL_FIELDS, MANIFEST_PATH, REVIEW_PATH, readLines, verifyReviewSources, digest } from './prepare-evaluation.mjs';

const normalize = text => String(text).normalize('NFKC').replace(/\s+/gu, ' ').trim();
function labelsEqual(a, b) { return LABEL_FIELDS.every(field => a?.[field] === b?.[field]); }

function validateLabels(labels, id) {
  if (!labels || LABEL_FIELDS.some(field => typeof labels[field] !== 'boolean')) throw new Error(`已审核标签必须完整填写五个布尔字段：${id}`);
  if (!labels.relevance && LABEL_FIELDS.slice(1).some(field => labels[field])) throw new Error(`不相关新闻不能同时标为范围内事件：${id}`);
}

function validateHumanReview(review, row) {
  if (!review || review.reviewer_type !== 'human' || typeof review.reviewer_id !== 'string' || !review.reviewer_id.trim()) throw new Error(`缺少具名人工审核声明：${row.pair_id}`);
  if (typeof review.completed_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(review.completed_at) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(review.completed_at) || !Number.isFinite(Date.parse(review.completed_at))) throw new Error(`缺少含时区的有效审核时间：${row.pair_id}`);
  if (typeof review.notes !== 'string' || !review.notes.trim()) throw new Error(`人工审核需填写判断依据：${row.pair_id}`);
  validateLabels(review.labels, row.pair_id);
  if (!Array.isArray(review.evidence_quotes)) throw new Error(`人工审核需保留 evidence_quotes 数组：${row.pair_id}`);
  if (LABEL_FIELDS.slice(1).some(field => review.labels[field]) && !review.evidence_quotes.length) throw new Error(`正事件标签必须附原文证据：${row.pair_id}`);
  const source = normalize(`${row.source.news.title}\n${row.source.news.text}`);
  for (const quote of review.evidence_quotes) {
    if (typeof quote !== 'string' || !normalize(quote) || !source.includes(normalize(quote))) throw new Error(`审核证据不是原文：${row.pair_id}`);
  }
}

export function acceptedReview(row) {
  if (['pending', 'needs_adjudication'].includes(row.review_status)) return false;
  if (!['human-reviewed', 'adjudicated'].includes(row.review_status)) throw new Error(`未知审核状态：${row.pair_id}`);
  validateLabels(row.labels, row.pair_id);
  if (!Array.isArray(row.reviews) || !row.reviews.length) throw new Error(`缺少人工审核记录：${row.pair_id}`);
  const ids = new Set();
  for (const review of row.reviews) {
    validateHumanReview(review, row);
    if (ids.has(review.reviewer_id.trim())) throw new Error(`独立审核者不能重复：${row.pair_id}`);
    ids.add(review.reviewer_id.trim());
  }
  if (row.review_status === 'human-reviewed') {
    if (row.reviews.some(review => !labelsEqual(review.labels, row.labels))) throw new Error(`审核意见不一致，须先裁决：${row.pair_id}`);
  } else {
    if (row.reviews.length < 2) throw new Error(`裁决前至少需要两名独立审核者：${row.pair_id}`);
    validateHumanReview(row.adjudication, row);
    if (!labelsEqual(row.adjudication.labels, row.labels)) throw new Error(`最终标签与裁决记录不一致：${row.pair_id}`);
  }
  return true;
}

function summarize(confusion) {
  const { tp, tn, fp, fn } = confusion;
  return { ...confusion,
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null,
    f1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : null,
    accuracy: (tp + tn) / (tp + tn + fp + fn),
  };
}

export function evaluateRecognition(rows, manifest, predict, { modelInfo = null } = {}) {
  verifyReviewSources(rows, manifest);
  const accepted = rows.filter(acceptedReview);
  const excluded = rows.filter(r => !['human-reviewed', 'adjudicated'].includes(r.review_status));
  const base = {
    schema_version: 1,
    status: !accepted.length ? 'not_evaluable' : accepted.length === rows.length ? 'evaluated' : 'partially_evaluated',
    evaluation_kind: 'development_recognition_evaluation', independent_holdout: false,
    label_provenance: 'Human review is declared by named records; software validates completeness and source evidence but cannot independently verify a person’s identity or whether a review was actually performed.',
    limitation: manifest.limitation,
    annotation_contract: 'Only complete human-reviewed/adjudicated rows are scored. Pending or unresolved rows are excluded, never counted as negative. This evaluates article-level extraction, not future seven-day real events.',
    manifest_sha256: manifest.manifest_sha256,
    review_file_content_sha256: digest(rows),
    coverage: { selected: rows.length, reviewed: accepted.length, excluded: excluded.length, fraction: accepted.length / rows.length,
      single_reviewer: accepted.filter(r => r.reviews.length === 1).length,
      multiple_reviewers: accepted.filter(r => r.reviews.length >= 2).length,
      adjudicated: accepted.filter(r => r.review_status === 'adjudicated').length,
      by_case: manifest.cases.map(c => ({ case_id: c.case_id, selected: rows.filter(r => r.source.case.case_id === c.case_id).length, reviewed: accepted.filter(r => r.source.case.case_id === c.case_id).length })),
    },
    excluded_rows: excluded.map(r => ({ pair_id: r.pair_id, review_status: r.review_status })),
    model_info: modelInfo,
    metrics: null, predictions: [],
    note: accepted.length ? '指标只代表已审核子集；请结合未审核比例、各案例覆盖及单人/双人审阅情况解释。' : '没有合格人工审核标签，不能计算识别准确率；请完成审阅后再评估。',
  };
  if (!accepted.length) return base;
  if (typeof predict !== 'function') throw new Error('评估已审核样本需要检测器');
  const confusion = Object.fromEntries(LABEL_FIELDS.map(field => [field, { tp: 0, tn: 0, fp: 0, fn: 0 }]));
  for (const row of accepted) {
    const prediction = predict(row.source, row);
    if (!prediction || LABEL_FIELDS.some(field => typeof prediction[field] !== 'boolean')) throw new Error(`模型必须返回五个布尔字段：${row.pair_id}`);
    for (const field of LABEL_FIELDS) {
      const outcome = row.labels[field] ? prediction[field] ? 'tp' : 'fn' : prediction[field] ? 'fp' : 'tn';
      confusion[field][outcome]++;
    }
    base.predictions.push({ pair_id: row.pair_id, labels: row.labels, prediction });
  }
  base.metrics = Object.fromEntries(LABEL_FIELDS.map(field => [field, summarize(confusion[field])]));
  return base;
}

export function runRecognitionEvaluation() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const rows = readLines(REVIEW_PATH);
  verifyReviewSources(rows, manifest);
  // A pending review set needs no model and must not fabricate any metrics.
  const hasAccepted = rows.some(acceptedReview);
  const model = hasAccepted ? loadFrozenModel() : null;
  const report = evaluateRecognition(rows, manifest, model ? source => {
    const s = extractArticleSignals(source.case, source.news, model);
    return { relevance: s.relevant, action: s.action, threat: s.threat, posture: s.posture, cooperation: s.cooperation };
  } : null, { modelInfo: model ? { rule_version: model.detector_rule_version, trained_through: model.trained_through, detector_examples: model.detector.examples } : null });
  const output = path.join(LOCAL_DATA_ROOT, 'evaluation', 'recognition-report.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  return { ...report, output };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error('用法：node scripts/evaluate-recognition.mjs');
  const report = runRecognitionEvaluation();
  console.log(JSON.stringify({ status: report.status, coverage: report.coverage, metrics: report.metrics, note: report.note, output: report.output }, null, 2));
}

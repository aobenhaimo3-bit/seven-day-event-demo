import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PROJECT_ROOT, LOCAL_DATA_ROOT } from '../lib/data.mjs';

export const EVALUATION_SEED = 'recognition-development-review-2026-11-04-v1';
export const LABEL_FIELDS = Object.freeze(['relevance', 'action', 'threat', 'posture', 'cooperation']);
export const MANIFEST_PATH = path.join(PROJECT_ROOT, 'research', 'evaluation-manifest.json');
export const REVIEW_PATH = path.join(LOCAL_DATA_ROOT, 'evaluation', 'review.jsonl');
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const readLines = filename => fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim()).map(JSON.parse);

function payload(pair) {
  return {
    case: { case_id: pair.case.case_id, countries_regions: pair.case.countries_regions || '', target_situation: pair.case.target_situation || '', news_start: pair.case.news_start, news_end: pair.case.news_end },
    news: { news_id: pair.news.news_id, title: pair.news.title, text: pair.news.text, date: pair.news.date, publisher: pair.news.publisher || '' },
  };
}

function sourceRows(pairs) {
  const seen = new Set();
  return pairs.map(pair => {
    if (pair.split !== 'validation' || !/^S0(?:16|17|18|19|20)$/.test(pair.case?.case_id)) throw new Error('评估池仅允许开发验证案例 S016–S020，不读取训练或测试输入');
    if (!pair.news || typeof pair.news.title !== 'string' || typeof pair.news.text !== 'string' || !pair.news.text.trim()) throw new Error('评估池必须提供新闻原文');
    if (pair.pair_id !== `${pair.case.case_id}::${pair.news.news_id}` || seen.has(pair.pair_id)) throw new Error('评估组合 ID 无效或重复');
    seen.add(pair.pair_id);
    for (const date of [pair.case.news_start, pair.case.news_end, pair.news.date]) {
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('评估日期无效');
    }
    if (pair.news.date < pair.case.news_start || pair.news.date > pair.case.news_end) throw new Error('评估新闻日期超出案例窗口');
    const source = payload(pair);
    return { pair_id: pair.pair_id, source_sha256: digest(source), source };
  }).sort((a, b) => a.pair_id.localeCompare(b.pair_id));
}

export function buildEvaluationSet(pairs, { seed = EVALUATION_SEED, perCase = 12 } = {}) {
  if (!Number.isInteger(perCase) || perCase < 3) throw new Error('每案例样本数必须为至少 3 的整数');
  const pool = sourceRows(pairs);
  if (!pool.length) throw new Error('开发验证评估池为空');
  const records = [];
  const caseIds = [...new Set(pool.map(r => r.source.case.case_id))].sort();
  const rank = row => digest(`${seed}\0${row.pair_id}`);
  const ranked = rows => rows.slice().sort((a, b) => rank(a).localeCompare(rank(b)) || a.pair_id.localeCompare(b.pair_id));
  for (const caseId of caseIds) {
    const rows = pool.filter(r => r.source.case.case_id === caseId);
    const strata = [[], [], []];
    for (const row of rows) {
      const { news_start, news_end } = row.source.case;
      const offset = Date.parse(row.source.news.date) - Date.parse(news_start);
      const duration = Date.parse(news_end) - Date.parse(news_start) + 86400000;
      const stratum = Math.min(2, Math.floor(offset / duration * 3));
      strata[stratum].push({ ...row, stratum });
    }
    const selected = strata.flatMap((rows, i) => ranked(rows).slice(0, Math.floor(perCase / 3) + (i < perCase % 3 ? 1 : 0)));
    const ids = new Set(selected.map(r => r.pair_id));
    const remainder = ranked(strata.flat().filter(r => !ids.has(r.pair_id)));
    selected.push(...remainder.slice(0, Math.max(0, perCase - selected.length)));
    records.push(...selected.sort((a, b) => a.source.news.date.localeCompare(b.source.news.date) || a.pair_id.localeCompare(b.pair_id)));
  }
  const manifest = {
    schema_version: 1, seed, per_case_limit: perCase,
    pool: 'local-data/validation_pairs.jsonl; S016-S020 only',
    evaluation_kind: 'development_recognition_evaluation',
    independent_holdout: false,
    limitation: 'These development validation cases have already been used for forecast hyperparameter selection. Human annotation is independent of detector output, but this is not an untouched generalization test or future-event gold standard.',
    sampling: 'Three equal calendar-time strata per case, SHA-256(seed + pair_id) ranking, proportional quotas then deterministic backfill. No model output or event keywords used for selection.',
    source_pool_sha256: digest(pool.map(({ pair_id, source_sha256 }) => ({ pair_id, source_sha256 }))),
    source_pool_count: pool.length,
    cases: caseIds.map(case_id => ({ case_id, pool_count: pool.filter(r => r.source.case.case_id === case_id).length, selected_count: records.filter(r => r.source.case.case_id === case_id).length })),
    records: records.map(r => ({ pair_id: r.pair_id, case_id: r.source.case.case_id, news_id: r.source.news.news_id, date: r.source.news.date, time_stratum: r.stratum, source_sha256: r.source_sha256 })),
  };
  manifest.manifest_sha256 = digest(manifest);
  const reviews = records.map(({ pair_id, source_sha256, source }) => ({
    schema_version: 1, pair_id, manifest_sha256: manifest.manifest_sha256, source_sha256, source,
    review_status: 'pending', labels: null, reviews: [], adjudication: null,
    instructions: 'Do not copy model predictions. Record human judgements, evidence and reviewer identity; see research/evaluation-protocol.md.',
  }));
  return { manifest, reviews };
}

export function verifyReviewSources(rows, manifest) {
  const { manifest_sha256, ...content } = manifest;
  if (digest(content) !== manifest_sha256) throw new Error('评估 manifest 哈希不一致');
  const expected = new Map(manifest.records.map(r => [r.pair_id, r]));
  if (rows.length !== expected.size) throw new Error('审核文件必须保留全部固定样本；未审核样本保留 pending');
  const seen = new Set();
  for (const row of rows) {
    const entry = expected.get(row.pair_id);
    if (!entry || seen.has(row.pair_id)) throw new Error('审核样本 ID 不在固定清单中或重复');
    seen.add(row.pair_id);
    if (row.manifest_sha256 !== manifest_sha256 || row.source_sha256 !== entry.source_sha256 || digest(row.source) !== entry.source_sha256) throw new Error(`审核原文或样本哈希被修改：${row.pair_id}`);
  }
}

export function prepareEvaluation({ inputPath = path.join(LOCAL_DATA_ROOT, 'validation_pairs.jsonl'), manifestPath = MANIFEST_PATH, reviewPath = REVIEW_PATH } = {}) {
  const result = buildEvaluationSet(readLines(inputPath));
  if (fs.existsSync(manifestPath)) {
    const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (JSON.stringify(existing) !== JSON.stringify(result.manifest)) throw new Error('来源池或固定抽样清单已变化；请建立有说明的新评估版本，不得静默重选样本');
  }
  if (fs.existsSync(reviewPath)) verifyReviewSources(readLines(reviewPath), result.manifest);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.mkdirSync(path.dirname(reviewPath), { recursive: true });
  if (!fs.existsSync(manifestPath)) fs.writeFileSync(manifestPath, JSON.stringify(result.manifest, null, 2) + '\n', { flag: 'wx' });
  const preserved = fs.existsSync(reviewPath);
  if (!preserved) fs.writeFileSync(reviewPath, result.reviews.map(r => JSON.stringify(r)).join('\n') + '\n', { flag: 'wx' });
  return { sample_count: result.reviews.length, manifest_sha256: result.manifest.manifest_sha256, manifest_path: manifestPath, review_path: reviewPath, existing_reviews_preserved: preserved, evaluation_kind: result.manifest.evaluation_kind, independent_holdout: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error('用法：node scripts/prepare-evaluation.mjs');
  console.log(JSON.stringify(prepareEvaluation(), null, 2));
  console.log('审核模板已准备；所有新记录为 pending，尚无人工真值。重新运行不会覆盖已有审核。');
}

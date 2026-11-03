import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { SOURCE_ROOT, loadSources, buildCases, splitForCase } from "./prepare-input.mjs";

export const RESEARCH_ROOT = fileURLToPath(new URL("../research/", import.meta.url));
export const DEVELOPMENT_ROOT = fileURLToPath(new URL("../local-data/", import.meta.url));
const ORDER = { train: 0, validation: 1, test: 2 };
const digest = value => createHash("sha256").update(value).digest("hex");
const normalize = value => String(value).normalize("NFKC").replace(/\s+/gu, " ").trim();
const contentKey = news => digest(normalize(`${news.title}\n${news.text}`).toLowerCase());

function readLines(content, filename) {
  return content.replace(/^\uFEFF/, "").split(/\r?\n/u).filter(line => line.trim()).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`${filename}第${index + 1}条非空记录不是有效JSON`); }
  });
}

function pairPayload(record, news) {
  return {
    pair_id: `${record.case_id}::${news.news_id}`, split: record.split,
    case: {
      case_id: record.case_id, countries_regions: record.countries_regions,
      target_situation: record.target_situation, news_start: record.news_start, news_end: record.news_end,
    },
    news: { news_id: news.news_id, title: news.title, text: news.text, date: news.date, publisher: news.publisher },
  };
}

export function validateTrainingAnnotations(annotations, trainPairs, aliases) {
  if (!Array.isArray(annotations) || !annotations.length) throw new Error("需要非空的训练试标文件；原始新闻没有自动提供人工真值");
  if (!aliases || typeof aliases !== "object" || !aliases.cases || typeof aliases.cases !== "object" || Array.isArray(aliases.cases)) throw new Error("主体别名配置需要cases对象");
  const byPair = new Map(trainPairs.map(pair => [pair.pair_id, pair]));
  const seen = new Set();
  const counts = { yes: 0, no: 0, uncertain: 0, review_required: 0, event_records: 0 };
  for (const row of annotations) {
    const pair = byPair.get(row?.pair_id);
    if (!pair || row.split !== "train") throw new Error(`试标只允许引用保留的训练组合：${row?.pair_id}`);
    if (seen.has(row.pair_id)) throw new Error(`训练试标重复：${row.pair_id}`);
    seen.add(row.pair_id);
    if (row.case_id !== undefined && row.case_id !== pair.case.case_id) throw new Error(`试标案例ID不匹配：${row.pair_id}`);
    if (row.news_id !== undefined && row.news_id !== pair.news.news_id) throw new Error(`试标新闻ID不匹配：${row.pair_id}`);
    if (!["yes", "no", "uncertain"].includes(row.relevance) || !Array.isArray(row.events)) throw new Error(`试标标签或events格式无效：${row.pair_id}`);
    const original = normalize(`${pair.news.title}\n${pair.news.text}`);
    for (const event of row.events) {
      const quote = typeof event?.evidence_quote === "string" ? normalize(event.evidence_quote) : "";
      if (!quote || !original.includes(quote)) throw new Error(`试标证据不是该训练新闻的原文片段：${row.pair_id}`);
      if (!/^\d{2,4}$/u.test(String(event.cameo_code))) throw new Error(`试标CAMEO代码无效：${row.pair_id}`);
      counts.event_records++;
    }
    counts[row.relevance]++;
    if (row.review_required) counts.review_required++;
  }
  return counts;
}

export function buildDevelopment(sources, annotations, aliases) {
  if (!Array.isArray(sources?.cases) || !Array.isArray(sources.news) || !Array.isArray(sources.links)) throw new Error("原始数据需要三个记录数组");
  const knownCases = new Map();
  for (const record of sources.cases) {
    if (!record || knownCases.has(record.case_id)) throw new Error("案例ID缺失或重复");
    knownCases.set(record.case_id, splitForCase(record.case_id));
  }
  const latestSplit = new Map();
  const splitsById = new Map();
  const rawCounts = { train: 0, validation: 0, test: 0 };
  const seenLinks = new Set();
  for (const link of sources.links) {
    const split = knownCases.get(link?.case_id);
    if (!split || typeof link.news_id !== "string" || !link.news_id) throw new Error("关联中的案例或新闻ID无效");
    const pairId = `${link.case_id}::${link.news_id}`;
    if (seenLinks.has(pairId)) throw new Error(`重复案例新闻关联：${pairId}`);
    seenLinks.add(pairId);
    rawCounts[split]++;
    if (!splitsById.has(link.news_id)) splitsById.set(link.news_id, new Set());
    splitsById.get(link.news_id).add(split);
    if (ORDER[split] > (ORDER[latestSplit.get(link.news_id)] ?? -1)) latestSplit.set(link.news_id, split);
  }
  // The held-out split contributes IDs only to this isolation decision. Its
  // news text is never passed to the development case/feature constructors.
  const retainedLinks = sources.links.filter(link => {
    const split = knownCases.get(link.case_id);
    return split !== "test" && latestSplit.get(link.news_id) === split;
  });
  const developmentIds = new Set(retainedLinks.map(link => link.news_id));
  const records = buildCases({
    cases: sources.cases.filter(record => knownCases.get(record.case_id) !== "test"),
    news: sources.news.filter(news => developmentIds.has(news.news_id)),
    links: retainedLinks,
  }, { all: true });
  const bySplit = { train: [], validation: [] };
  for (const record of records) bySplit[record.split].push(...record.news.map(news => pairPayload(record, news)));
  const countsAfterId = { train: bySplit.train.length, validation: bySplit.validation.length };
  // Different IDs can still carry identical text in development data. Apply
  // the same later-split priority to train versus validation without inspecting
  // held-out test text. For the bundled source this adds no extra exclusions.
  const validationContent = new Set(bySplit.validation.map(pair => contentKey(pair.news)));
  const duplicateTrainIds = new Set(bySplit.train.filter(pair => validationContent.has(contentKey(pair.news))).map(pair => pair.news.news_id));
  bySplit.train = bySplit.train.filter(pair => !duplicateTrainIds.has(pair.news.news_id));
  const annotationCounts = validateTrainingAnnotations(annotations, bySplit.train, aliases);
  const excludedIds = { train: [], validation: [] };
  for (const [newsId, retainedSplit] of latestSplit) {
    for (const split of splitsById.get(newsId)) {
      if (split !== "test" && ORDER[retainedSplit] > ORDER[split]) excludedIds[split].push(newsId);
    }
  }
  for (const split of Object.keys(excludedIds)) excludedIds[split].sort();
  return {
    trainPairs: bySplit.train, validationPairs: bySplit.validation,
    summary: {
      schema_version: 1,
      split_policy: "S001-S015 train; S016-S020 validation; S021-S030 test; duplicated IDs retained in latest split",
      raw_pairs: rawCounts,
      development_pairs: { train: bySplit.train.length, validation: bySplit.validation.length },
      id_excluded_pairs: { train: rawCounts.train - countsAfterId.train, validation: rawCounts.validation - countsAfterId.validation },
      content_excluded_train_pairs: countsAfterId.train - bySplit.train.length,
      excluded_news_ids: excludedIds,
      annotations: { articles: annotations.length, ...annotationCounts, status: "GPT/Codex辅助训练试标，保留原复核状态，不是真实未来事件金标签" },
      test_ids_used_for_isolation_only: true,
      test_text_used_for_development_features: false,
      test_answers_accessed: false,
      test_input_prepared_separately: "node scripts/prepare-input.mjs",
    },
  };
}

function atomicWrite(filename, data) {
  const temporary = `${filename}.tmp`;
  fs.writeFileSync(temporary, data);
  fs.renameSync(temporary, filename);
}

export function prepareDevelopment({ sourceRoot = SOURCE_ROOT, researchRoot = RESEARCH_ROOT, outputRoot = DEVELOPMENT_ROOT } = {}) {
  const annotationFile = path.join(researchRoot, "annotations.jsonl");
  const aliasesFile = path.join(researchRoot, "case_aliases.json");
  const annotationBytes = fs.readFileSync(annotationFile);
  const aliasesBytes = fs.readFileSync(aliasesFile);
  const annotations = readLines(annotationBytes.toString("utf8"), "research/annotations.jsonl");
  const aliases = JSON.parse(aliasesBytes.toString("utf8").replace(/^\uFEFF/, ""));
  const result = buildDevelopment(loadSources(sourceRoot), annotations, aliases);
  const trainBytes = Buffer.from(result.trainPairs.map(row => JSON.stringify(row)).join("\n") + "\n");
  const validationBytes = Buffer.from(result.validationPairs.map(row => JSON.stringify(row)).join("\n") + "\n");
  const summary = {
    ...result.summary,
    source_sha256: Object.fromEntries(["cases.json", "news.jsonl", "case_news.jsonl"].map(name => [`datasets/project3/${name}`, digest(fs.readFileSync(path.join(sourceRoot, name)))])),
    research_sha256: { "research/annotations.jsonl": digest(annotationBytes), "research/case_aliases.json": digest(aliasesBytes) },
    generated_sha256: { "local-data/train_pairs.jsonl": digest(trainBytes), "local-data/validation_pairs.jsonl": digest(validationBytes) },
  };
  fs.mkdirSync(outputRoot, { recursive: true });
  atomicWrite(path.join(outputRoot, "train_pairs.jsonl"), trainBytes);
  atomicWrite(path.join(outputRoot, "validation_pairs.jsonl"), validationBytes);
  atomicWrite(path.join(outputRoot, "annotations.jsonl"), annotationBytes);
  atomicWrite(path.join(outputRoot, "case_aliases.json"), aliasesBytes);
  atomicWrite(path.join(outputRoot, "development-preparation.json"), JSON.stringify(summary, null, 2) + "\n");
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error("用法：node scripts/prepare-development.mjs");
  console.log(JSON.stringify(prepareDevelopment(), null, 2));
  console.log("开发输入已准备：仅训练组合供试标检测器拟合、验证组合供选择参数；测试ID仅用于去重隔离，没有读取测试答案。下一步运行node build-model.mjs。");
}

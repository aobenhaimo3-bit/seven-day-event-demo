import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { SOURCE_ROOT, loadSources } from "../scripts/prepare-input.mjs";
import { RESEARCH_ROOT, buildDevelopment, prepareDevelopment, validateTrainingAnnotations } from "../scripts/prepare-development.mjs";

const jsonLines = filename => fs.readFileSync(filename, "utf8").trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
const sha = value => createHash("sha256").update(value).digest("hex");
const encode = rows => rows.map(row => JSON.stringify(row)).join("\n") + "\n";
const bodyKey = news => `${news.title}\n${news.text}`.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();

function fixture() {
  const cases = [["S001", "2020"], ["S016", "2021"], ["S021", "2022"]].map(([case_id, year]) => ({ case_id, countries_regions: "Unit-test fixture only", target_situation: "Synthetic fixture, never demo training data", news_start: `${year}-01-01`, news_end: `${year}-02-01` }));
  const article = (news_id, text, year = "2020") => ({ news_id, title: text, text, date: `${year}-01-02`, publisher: "Unit-test fixture only" });
  const news = [article("T", "Alpha troops attacked Beta military forces."), article("V", "Alpha and Beta officials met.", "2021"), article("H", "Held-out fixture only", "2022"), article("D", "Shared ID across development splits", "2021"), article("X", "Shared ID reserved for test", "2022"), article("T2", "Identical content under distinct IDs"), article("V2", "Identical content under distinct IDs", "2021")];
  const byId = new Map(news.map(row => [row.news_id, row]));
  const links = [["S001", "T"], ["S001", "D"], ["S001", "X"], ["S001", "T2"], ["S016", "V"], ["S016", "D"], ["S016", "X"], ["S016", "V2"], ["S021", "H"], ["S021", "X"]].map(([case_id, news_id]) => ({ case_id, news_id, title: byId.get(news_id).title, date: `${cases.find(c => c.case_id === case_id).news_start.slice(0, 4)}-01-02`, publisher: byId.get(news_id).publisher }));
  const annotations = [{ pair_id: "S001::T", split: "train", case_id: "S001", news_id: "T", relevance: "yes", review_required: true, events: [{ cameo_code: "190", evidence_quote: news[0].text }] }];
  return { sources: { cases, news, links }, annotations, aliases: { cases: { S001: { strong: ["Alpha", "Beta"], groups: [["Alpha"], ["Beta"]], context: ["military"] } } } };
}

test("bundled raw data reconstructs development pairs and training silver labels", () => {
  const sources = loadSources(SOURCE_ROOT);
  const annotations = jsonLines(path.join(RESEARCH_ROOT, "annotations.jsonl"));
  const aliases = JSON.parse(fs.readFileSync(path.join(RESEARCH_ROOT, "case_aliases.json"), "utf8"));
  const result = buildDevelopment(sources, annotations, aliases);
  assert.deepEqual(result.summary.raw_pairs, { train: 8370, validation: 1065, test: 3670 });
  assert.deepEqual(result.summary.development_pairs, { train: 8366, validation: 1042 });
  assert.deepEqual(result.summary.id_excluded_pairs, { train: 4, validation: 23 });
  assert.equal(result.summary.content_excluded_train_pairs, 0);
  assert.deepEqual(result.summary.annotations, { articles: 150, yes: 117, no: 31, uncertain: 2, review_required: 73, event_records: 237, status: "GPT/Codex辅助训练试标，保留原复核状态，不是真实未来事件金标签" });
  const trainIds = new Set(result.trainPairs.map(row => row.news.news_id));
  const validationIds = new Set(result.validationPairs.map(row => row.news.news_id));
  const testIds = new Set(sources.links.filter(row => +row.case_id.slice(1) >= 21).map(row => row.news_id));
  assert.ok([...trainIds].every(id => !validationIds.has(id) && !testIds.has(id)));
  assert.ok([...validationIds].every(id => !testIds.has(id)));
  const validationBodies = new Set(result.validationPairs.map(row => bodyKey(row.news)));
  assert.ok(result.trainPairs.every(row => !validationBodies.has(bodyKey(row.news))));
  assert.ok(result.trainPairs.every(row => row.pair_id === `${row.case.case_id}::${row.news.news_id}` && row.split === "train"));
  // Changing held-out text cannot affect development pairs or their hashes.
  const changed = { ...sources, news: sources.news.map(row => testIds.has(row.news_id) ? { ...row, title: "Changed held-out fixture", text: "Held-out text must not reach development features." } : row) };
  const changedResult = buildDevelopment(changed, annotations, aliases);
  assert.equal(sha(encode(result.trainPairs)), sha(encode(changedResult.trainPairs)));
  assert.equal(sha(encode(result.validationPairs)), sha(encode(changedResult.validationPairs)));
});

test("later split ID priority and development body deduplication preserve split isolation", () => {
  const { sources, annotations, aliases } = fixture();
  const result = buildDevelopment(sources, annotations, aliases);
  assert.deepEqual(result.trainPairs.map(row => row.news.news_id), ["T"]);
  assert.deepEqual(result.validationPairs.map(row => row.news.news_id), ["D", "V", "V2"]);
  assert.equal(result.summary.content_excluded_train_pairs, 1);
  assert.deepEqual(result.summary.excluded_news_ids, { train: ["D", "X"], validation: ["X"] });
  assert.equal(result.summary.test_answers_accessed, false);
  assert.equal(result.summary.test_text_used_for_development_features, false);
});

test("annotation evidence and references must belong to retained training pairs", () => {
  const { sources, annotations, aliases } = fixture();
  const result = buildDevelopment(sources, annotations, aliases);
  assert.throws(() => validateTrainingAnnotations([{ ...annotations[0], pair_id: "S016::V", split: "validation" }], result.trainPairs, aliases), /训练组合/u);
  assert.throws(() => validateTrainingAnnotations([{ ...annotations[0], pair_id: "S001::X" }], result.trainPairs, aliases), /训练组合/u);
  assert.throws(() => validateTrainingAnnotations([{ ...annotations[0], events: [{ cameo_code: "190", evidence_quote: "Invented claim absent from the source" }] }], result.trainPairs, aliases), /原文片段/u);
  assert.throws(() => buildDevelopment({ ...sources, links: [...sources.links, sources.links[0]] }, annotations, aliases), /重复/u);
  assert.throws(() => buildDevelopment({ ...sources, links: sources.links.map(row => row.news_id === "T" ? { ...row, date: "2020-02-31" } : row) }, annotations, aliases), /日期/u);
  assert.throws(() => buildDevelopment({ ...sources, links: sources.links.map(row => row.news_id === "T" ? { ...row, date: "2021-01-02" } : row) }, annotations, aliases), /窗口/u);
});

test("preparation writes only local development inputs and preserves the reviewed files", t => {
  const temporaryBase = fs.realpathSync(os.tmpdir());
  const temporaryRoot = fs.mkdtempSync(path.join(temporaryBase, "project3-development-"));
  t.after(() => {
    const resolved = fs.realpathSync(temporaryRoot);
    if (path.dirname(resolved) !== temporaryBase || !path.basename(resolved).startsWith("project3-development-")) throw new Error("Temporary cleanup target is outside the expected directory");
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const { sources, annotations, aliases } = fixture();
  const sourceRoot = path.join(temporaryRoot, "raw"), researchRoot = path.join(temporaryRoot, "research"), outputRoot = path.join(temporaryRoot, "local-data");
  fs.mkdirSync(sourceRoot); fs.mkdirSync(researchRoot);
  fs.writeFileSync(path.join(sourceRoot, "cases.json"), JSON.stringify(sources.cases));
  fs.writeFileSync(path.join(sourceRoot, "news.jsonl"), encode(sources.news));
  fs.writeFileSync(path.join(sourceRoot, "case_news.jsonl"), encode(sources.links));
  const annotationBytes = encode(annotations), aliasesBytes = JSON.stringify(aliases, null, 2) + "\n";
  fs.writeFileSync(path.join(researchRoot, "annotations.jsonl"), annotationBytes);
  fs.writeFileSync(path.join(researchRoot, "case_aliases.json"), aliasesBytes);
  const report = prepareDevelopment({ sourceRoot, researchRoot, outputRoot });
  assert.deepEqual(fs.readdirSync(outputRoot).sort(), ["annotations.jsonl", "case_aliases.json", "development-preparation.json", "train_pairs.jsonl", "validation_pairs.jsonl"]);
  assert.equal(fs.readFileSync(path.join(outputRoot, "annotations.jsonl"), "utf8"), annotationBytes);
  assert.equal(fs.readFileSync(path.join(outputRoot, "case_aliases.json"), "utf8"), aliasesBytes);
  assert.equal(report.generated_sha256["local-data/train_pairs.jsonl"], sha(fs.readFileSync(path.join(outputRoot, "train_pairs.jsonl"))));
  assert.equal(report.test_ids_used_for_isolation_only, true);
  assert.equal(fs.existsSync(path.join(outputRoot, "test_input.jsonl")), false);
});

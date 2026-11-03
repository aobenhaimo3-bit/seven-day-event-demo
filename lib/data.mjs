import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const DEMO_ROOT = PROJECT_ROOT;
export const MODEL_PATH = path.join(DEMO_ROOT, "artifacts", "research-model.json");
export const LOCAL_DATA_ROOT = path.join(PROJECT_ROOT, "local-data");

const INPUTS = Object.freeze({
  train: path.join(LOCAL_DATA_ROOT, "train_pairs.jsonl"),
  validation: path.join(LOCAL_DATA_ROOT, "validation_pairs.jsonl"),
  test: path.join(LOCAL_DATA_ROOT, "test_input.jsonl"),
  pilot: path.join(LOCAL_DATA_ROOT, "annotations.jsonl"),
  aliases: path.join(LOCAL_DATA_ROOT, "case_aliases.json"),
});

function readKnown(name, jsonl = true) {
  const filename = INPUTS[name];
  if (!filename || filename.split(path.sep).some(part => part.toLowerCase() === "gold")) {
    throw new Error("This data source is not allowed");
  }
  if (!fs.existsSync(filename)) throw new Error(`缺少可选本地数据：local-data/${path.basename(filename)}。普通预测无需重新训练，请直接启动服务并导入新闻。`);
  const content = fs.readFileSync(filename, "utf8");
  return jsonl ? content.split(/\r?\n/).filter(line => line.trim()).map(JSON.parse) : JSON.parse(content);
}

export function groupPairs(pairs, expectedSplit) {
  const grouped = new Map();
  for (const pair of pairs) {
    if (pair.split !== expectedSplit) throw new Error("Prepared input split mismatch");
    const id = pair.case.case_id;
    if (!grouped.has(id)) grouped.set(id, { ...pair.case, split: expectedSplit, news: [] });
    grouped.get(id).news.push({ ...pair.news });
  }
  return [...grouped.values()].sort((a, b) => a.case_id.localeCompare(b.case_id)).map(row => ({
    ...row,
    news: row.news.sort((a, b) => a.date.localeCompare(b.date) || a.news_id.localeCompare(b.news_id)),
  }));
}

export function readDevelopmentData() {
  const pilotPairs = readKnown("train");
  return {
    trainingCases: groupPairs(pilotPairs, "train"),
    validationCases: groupPairs(readKnown("validation"), "validation"),
    pilotPairs,
    pilotAnnotations: readKnown("pilot"),
    aliases: readKnown("aliases", false),
  };
}

export function trainingProvenance() {
  return Object.fromEntries(["train", "validation", "pilot", "aliases"].map(name => [name, {
    path: path.relative(PROJECT_ROOT, INPUTS[name]).split(path.sep).join("/"),
    sha256: crypto.createHash("sha256").update(fs.readFileSync(INPUTS[name])).digest("hex"),
  }]));
}

export function hasDevelopmentData() {
  return ["train", "validation", "pilot", "aliases"].every(name => fs.existsSync(INPUTS[name]));
}

export function readDemoCases() {
  if (!fs.existsSync(INPUTS.test)) return [];
  return readKnown("test").map(row => ({ ...validateImportedCase(row), split: ["train", "validation", "test"].includes(row.split) ? row.split : "test" }));
}

export function readPilotSummary() {
  return {
    articles: 150,
    event_records: 237,
    pending_review: 73,
    status: "原研究的GPT/Codex辅助试标聚合数量；公开版不包含新闻原文或标注证据，未作为真实事件预测金标准",
  };
}

export function inputTemplate() {
  return {
    template_only: true,
    template_note: "仅展示文件格式，不包含演示新闻或真实事件。请将自己有权使用的带日期新闻填入news数组后再导入。",
    case_id: "YOUR_CASE_ID",
    countries_regions: "填写研究对象",
    target_situation: "填写预先确定的研究范围",
    news_start: "2025-06-01",
    news_end: "2025-08-31",
    actors: ["replace-with-English-actor-name"],
    news: [],
    news_record_template: { news_id: "唯一新闻编号", date: "2025-08-31", title: "新闻标题", text: "英文新闻正文", publisher: "媒体名称" },
  };
}

export function validateImportedCase(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("每个案例需要是一个JSON对象");
  if (Object.hasOwn(value, "predicted_event_family") || Object.hasOwn(value, "outcome") || Object.hasOwn(value, "gold")) {
    throw new Error("请导入原始新闻案例，不要导入预测结果或答案");
  }
  const iso = date => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  if (typeof value.case_id !== "string" || !value.case_id.trim() || value.case_id.length > 120) throw new Error("缺少有效的case_id");
  if (!iso(value.news_start) || !iso(value.news_end) || value.news_start > value.news_end) throw new Error("news_start和news_end需要是有效的年月日");
  if (!Array.isArray(value.news) || value.news.length > 20000) throw new Error("news需要是新闻数组，最多20,000条");
  const seen = new Set();
  const news = value.news.map((article, index) => {
    if (!article || typeof article !== "object" || typeof article.news_id !== "string" || !article.news_id.trim()) throw new Error(`第${index + 1}条新闻缺少news_id`);
    if (seen.has(article.news_id)) throw new Error(`新闻ID重复：${article.news_id}`);
    seen.add(article.news_id);
    if (!iso(article.date) || article.date < value.news_start || article.date > value.news_end) throw new Error(`新闻${article.news_id}的日期不在案例窗口内`);
    if (typeof article.title !== "string" || typeof article.text !== "string") throw new Error(`新闻${article.news_id}需要title和text文本`);
    return { news_id: article.news_id, date: article.date, title: article.title, text: article.text, publisher: String(article.publisher || "未注明来源") };
  });
  return {
    case_id: value.case_id.trim(),
    countries_regions: String(value.countries_regions || value.case_id),
    target_situation: String(value.target_situation || "用户导入的研究局势"),
    news_start: value.news_start, news_end: value.news_end, news,
    ...(Array.isArray(value.actors) ? { actors: value.actors.map(String).slice(0, 50) } : {}),
  };
}

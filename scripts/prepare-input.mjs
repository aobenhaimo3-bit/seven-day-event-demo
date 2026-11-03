import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE_ROOT = fileURLToPath(new URL("../datasets/project3/", import.meta.url));
export const OUTPUT_PATH = fileURLToPath(new URL("../local-data/test_input.jsonl", import.meta.url));
export const DEFAULT_TEST_IDS = Object.freeze(Array.from({ length: 10 }, (_, index) => `S${String(index + 21).padStart(3, "0")}`));
const SOURCE_FILES = ["cases.json", "news.jsonl", "case_news.jsonl"];

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + "T00:00:00Z"))
    && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}

function jsonLines(text, filename) {
  return text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`${filename}第${index + 1}条非空记录不是有效JSON`); }
  });
}

export function loadSources(sourceRoot = SOURCE_ROOT) {
  // The source allowlist is deliberately limited to these three raw files.
  const input = Object.fromEntries(SOURCE_FILES.map(name => [name, fs.readFileSync(path.join(sourceRoot, name), "utf8")]));
  return {
    cases: JSON.parse(input["cases.json"].replace(/^\uFEFF/, "")),
    news: jsonLines(input["news.jsonl"], "news.jsonl"),
    links: jsonLines(input["case_news.jsonl"], "case_news.jsonl"),
  };
}

export function splitForCase(caseId) {
  const match = /^S(\d{3})$/.exec(caseId);
  if (!match || +match[1] < 1 || +match[1] > 30) throw new Error(`未知项目案例ID：${caseId}`);
  return +match[1] <= 15 ? "train" : +match[1] <= 20 ? "validation" : "test";
}

export function parseSelection(args) {
  if (!args.length) return {};
  if (args.length === 1 && args[0] === "--all") return { all: true };
  if (args.length === 2 && args[0] === "--case" && /^S\d{3}$/.test(args[1])) return { caseId: args[1] };
  throw new Error("用法：node scripts/prepare-input.mjs [--all | --case S021]");
}

export function buildCases(sources, { all = false, caseId } = {}) {
  if (all && caseId) throw new Error("--all和--case不能同时使用");
  if (!Array.isArray(sources.cases) || !Array.isArray(sources.news) || !Array.isArray(sources.links)) throw new Error("原始数据需要三个记录数组");
  const cases = new Map();
  for (const row of sources.cases) {
    if (!row || typeof row.case_id !== "string" || cases.has(row.case_id)) throw new Error("cases.json案例ID缺失或重复");
    splitForCase(row.case_id);
    if (!validDate(row.news_start) || !validDate(row.news_end) || row.news_start > row.news_end) throw new Error(`案例${row.case_id}的历史窗口无效`);
    if (typeof row.countries_regions !== "string" || typeof row.target_situation !== "string") throw new Error(`案例${row.case_id}缺少研究范围文本`);
    cases.set(row.case_id, row);
  }
  const byNews = new Map();
  for (const row of sources.news) {
    if (!row || typeof row.news_id !== "string" || !row.news_id || byNews.has(row.news_id)) throw new Error("news.jsonl新闻ID缺失或重复");
    if (typeof row.text !== "string" || typeof row.title !== "string" || !validDate(row.date)) throw new Error(`新闻${row.news_id}缺少正文、标题或有效日期`);
    byNews.set(row.news_id, row);
  }
  const grouped = new Map([...cases.keys()].map(id => [id, []]));
  const seen = new Set();
  for (const link of sources.links) {
    const record = cases.get(link?.case_id);
    if (!record) throw new Error(`case_news.jsonl引用未知案例：${link?.case_id}`);
    const article = byNews.get(link.news_id);
    if (!article) throw new Error(`关联新闻不存在：${link.news_id}`);
    const key = `${link.case_id}\0${link.news_id}`;
    if (seen.has(key)) throw new Error(`重复案例新闻关联：${link.case_id}/${link.news_id}`);
    seen.add(key);
    if (!validDate(link.date) || link.date < record.news_start || link.date > record.news_end) throw new Error(`新闻${link.news_id}在案例${record.case_id}中日期超出窗口`);
    if (typeof link.title !== "string" || !link.title.trim()) throw new Error(`关联新闻${link.news_id}缺少标题`);
    // Shared article text comes from news.jsonl. Case-specific title/date take
    // precedence because one shared ID can have different association metadata.
    grouped.get(link.case_id).push({
      news_id: article.news_id, title: link.title, text: article.text, date: link.date,
      publisher: String(link.publisher ?? article.publisher ?? "未注明来源"),
      url: String(link.url ?? article.url ?? ""),
      captured_at: String(link.captured_at ?? article.captured_at ?? ""),
    });
  }
  const selectedIds = all ? [...cases.keys()].sort() : caseId ? [caseId] : [...DEFAULT_TEST_IDS];
  return selectedIds.map(id => {
    const row = cases.get(id);
    if (!row) throw new Error(`所选案例不存在：${id}`);
    const news = grouped.get(id).sort((a, b) => a.date.localeCompare(b.date) || a.news_id.localeCompare(b.news_id));
    if (!news.length) throw new Error(`所选案例没有新闻：${id}`);
    return {
      case_id: row.case_id, countries_regions: row.countries_regions,
      target_situation: row.target_situation, news_start: row.news_start, news_end: row.news_end,
      split: splitForCase(row.case_id), news,
    };
  });
}

export function prepareInput(selection = {}, { sourceRoot = SOURCE_ROOT, outputPath = OUTPUT_PATH } = {}) {
  const rows = buildCases(loadSources(sourceRoot), selection);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp`;
  fs.writeFileSync(temporary, rows.map(row => JSON.stringify(row)).join("\n") + "\n", "utf8");
  fs.renameSync(temporary, outputPath);
  return { cases: rows.length, news_associations: rows.reduce((count, row) => count + row.news.length, 0), case_ids: rows.map(row => row.case_id), output: outputPath, trained_model_changed: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = prepareInput(parseSelection(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
  console.log("仅准备无标签案例输入，不训练模型。S021–S030是本项目固定测试案例，不是独立真实冲突真值；--all中的split仅保留本项目划分。请启动或重启node server.mjs读取结果。");
}

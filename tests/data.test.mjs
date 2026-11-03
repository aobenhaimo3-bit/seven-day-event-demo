import test from "node:test";
import assert from "node:assert/strict";
import { validateImportedCase, groupPairs } from "../lib/data.mjs";

const example = () => ({
  case_id: "UNIT", countries_regions: "Unit test only", target_situation: "Test fixture",
  news_start: "2025-01-01", news_end: "2025-03-31",
  news: [{ news_id: "N1", date: "2025-02-01", title: "A report", text: "Unit test text", publisher: "Fixture" }],
});

test("raw input never carries supplied outcome fields into the research model", () => {
  assert.throws(() => validateImportedCase({ ...example(), outcome: { event: true } }), /答案/);
  const value = example();
  value.news[0].future_label = 1;
  value.private_notes = "not a feature";
  const parsed = validateImportedCase(value);
  assert.equal(Object.hasOwn(parsed, "private_notes"), false);
  assert.equal(Object.hasOwn(parsed.news[0], "future_label"), false);
});

test("invalid or out-of-window dates and repeated IDs are rejected", () => {
  const value = example();
  value.news[0].date = "2025-02-30";
  assert.throws(() => validateImportedCase(value), /日期/);
  value.news[0].date = "2025-04-01";
  assert.throws(() => validateImportedCase(value), /日期/);
  value.news[0].date = "2025-02-01";
  value.news.push({ ...value.news[0] });
  assert.throws(() => validateImportedCase(value), /重复/);
});

test("development grouping enforces the declared split", () => {
  const value = example();
  assert.throws(() => groupPairs([{ split: "test", case: value, news: value.news[0] }], "train"), /split/);
});

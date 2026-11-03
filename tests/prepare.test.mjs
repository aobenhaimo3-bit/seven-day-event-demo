import test from "node:test";
import assert from "node:assert/strict";
import { buildCases, DEFAULT_TEST_IDS, loadSources, parseSelection, splitForCase } from "../scripts/prepare-input.mjs";

const sources = loadSources();

test("raw dataset yields the fixed unlabeled project test inputs", () => {
  assert.equal(sources.cases.length, 30);
  assert.equal(sources.news.length, 11343);
  assert.equal(sources.links.length, 13105);
  const rows = buildCases(sources);
  assert.deepEqual(rows.map(row => row.case_id), DEFAULT_TEST_IDS);
  assert.equal(rows.reduce((sum, row) => sum + row.news.length, 0), 3670);
  assert.ok(rows.every(row => row.split === "test"));
  assert.ok(rows.every(row => !Object.hasOwn(row, "gold") && !Object.hasOwn(row, "outcome")));
  assert.ok(rows.every(row => row.news.every(article => article.date >= row.news_start && article.date <= row.news_end)));
});

test("all and single-case selection preserve IDs and project splits", () => {
  const all = buildCases(sources, { all: true });
  assert.equal(all.length, 30);
  assert.equal(all.reduce((sum, row) => sum + row.news.length, 0), 13105);
  assert.equal(all.filter(row => row.split === "train").length, 15);
  assert.equal(all.filter(row => row.split === "validation").length, 5);
  assert.equal(all.filter(row => row.split === "test").length, 10);
  assert.equal(buildCases(sources, { caseId: "S021" })[0].news.length, 686);
  assert.throws(() => buildCases(sources, { caseId: "S999" }), /不存在/);
  assert.throws(() => splitForCase("S999"), /未知/);
  assert.throws(() => parseSelection(["--all", "--case", "S021"]), /用法/);
});

test("case-specific metadata overrides shared news and invalid references are rejected", () => {
  const fixture = {
    cases: [{ case_id: "S021", countries_regions: "Unit fixture", target_situation: "Unit fixture only", news_start: "2025-01-01", news_end: "2025-03-31" }],
    news: [{ news_id: "N1", title: "Shared title", text: "Unit-test fixture only", date: "2025-02-01", publisher: "Shared" }],
    links: [{ case_id: "S021", news_id: "N1", title: "Case title", date: "2025-03-01", publisher: "Case-specific" }],
  };
  const row = buildCases(fixture, { caseId: "S021" })[0].news[0];
  assert.equal(row.title, "Case title");
  assert.equal(row.date, "2025-03-01");
  assert.equal(row.text, "Unit-test fixture only");
  assert.equal(row.publisher, "Case-specific");
  assert.throws(() => buildCases({ ...fixture, links: [{ ...fixture.links[0], news_id: "missing" }] }, { caseId: "S021" }), /不存在/);
  assert.throws(() => buildCases({ ...fixture, links: [fixture.links[0], fixture.links[0]] }, { caseId: "S021" }), /重复/);
  assert.throws(() => buildCases({ ...fixture, links: [{ ...fixture.links[0], date: "2025-02-30" }] }, { caseId: "S021" }), /窗口/);
  assert.throws(() => buildCases({ ...fixture, links: [{ ...fixture.links[0], date: "2025-04-01" }] }, { caseId: "S021" }), /窗口/);
});

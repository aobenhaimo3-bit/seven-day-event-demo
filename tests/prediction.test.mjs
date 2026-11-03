import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { MODEL_PATH } from "../lib/data.mjs";
import { buildCases, loadSources } from "../scripts/prepare-input.mjs";
import { predictTestCases } from "../scripts/predict-batch.mjs";

test("released data and frozen model produce ten test forecasts without fitting or answers", () => {
  const model = JSON.parse(fs.readFileSync(MODEL_PATH, "utf8"));
  const serialized = JSON.stringify(model);
  const cases = buildCases(loadSources(), { all: true });
  const results = predictTestCases(cases, model);
  assert.equal(results.length, 10);
  assert.deepEqual(results.map(row => row.case.case_id), Array.from({ length: 10 }, (_, i) => "S" + String(i + 21).padStart(3, "0")));
  assert.equal(JSON.stringify(model), serialized);
  for (const result of results) {
    assert.equal(result.probability.real_event_probability, null);
    assert.equal(result.forecast_window.horizon_days, 7);
    assert.ok(result.events.every(event => event.published_date <= result.as_of));
    if (result.probability.available) assert.ok(result.probability.value >= 0 && result.probability.value <= 1);
    else assert.ok(result.probability.reason);
  }
  assert.throws(() => predictTestCases(cases.filter(row => row.split === "train"), model), /没有测试输入/);
});

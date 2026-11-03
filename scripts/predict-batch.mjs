import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeCase } from "../lib/engine.mjs";
import { LOCAL_DATA_ROOT, readDemoCases } from "../lib/data.mjs";
import { loadFrozenModel } from "../server.mjs";

// Keep this CLI outside Node's default *-test.mjs discovery pattern.
export function predictTestCases(cases, model) {
  const selected = cases.filter(row => row.split === "test");
  if (!selected.length) throw new Error("没有测试输入。请先运行 node scripts/prepare-input.mjs；训练和验证案例不会作为测试预测。 ");
  return selected.map(row => analyzeCase(row, { asOf: row.news_end, model }));
}

export function runTestPrediction() {
  const results = predictTestCases(readDemoCases(), loadFrozenModel());
  const outputRoot = path.join(LOCAL_DATA_ROOT, "predictions");
  fs.mkdirSync(outputRoot, { recursive: true });
  const outputPath = path.join(outputRoot, "test-predictions.jsonl");
  const temporary = outputPath + ".tmp";
  fs.writeFileSync(temporary, results.map(row => JSON.stringify(row)).join("\n") + "\n", "utf8");
  fs.renameSync(temporary, outputPath);
  const summary = {
    target: "未来7天出现19类军事行动报道",
    target_kind: "weak_supervision_proxy",
    test_cases: results.length,
    available_predictions: results.filter(row => row.probability.available).length,
    withheld_predictions: results.filter(row => !row.probability.available).length,
    case_ids: results.map(row => row.case.case_id),
    output: "local-data/predictions/test-predictions.jsonl",
    fitted_during_prediction: false,
    test_gold_used: false,
    real_event_probability: null,
    note: "这是无标签测试输入的批量预测，不是独立真实事件准确率评估。缺少报道覆盖等条件时保留拒答原因。",
  };
  fs.writeFileSync(path.join(outputRoot, "summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(runTestPrediction(), null, 2));
}

import fs from "node:fs";
import path from "node:path";
import { buildResearchModel, summarizeModel } from "./lib/engine.mjs";
import { readDevelopmentData, trainingProvenance, MODEL_PATH } from "./lib/data.mjs";

const inputs = readDevelopmentData();
console.log("Training the research-only seven-day report model from train/validation inputs...");
const model = await buildResearchModel(inputs);
model.data_provenance = trainingProvenance();
model.build_contract = {
  client_date: "2026-11-03",
  target: "Future seven days contain a locally detected CAMEO-19 report in the supplied news stream",
  actual_event_probability_validated: false,
  real_event_probability: null,
  test_input_used_for_fit: false,
  test_gold_used: false,
  synthetic_training_data_used: false,
  runtime_llm_api_required: false,
};
fs.mkdirSync(path.dirname(MODEL_PATH), { recursive: true });
const temporary = `${MODEL_PATH}.tmp`;
fs.writeFileSync(temporary, JSON.stringify(model, null, 2) + "\n", "utf8");
fs.renameSync(temporary, MODEL_PATH);
const summary = { ...summarizeModel(model), data_provenance: model.data_provenance, build_contract: model.build_contract };
fs.writeFileSync(path.join(path.dirname(MODEL_PATH), "model-report.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
console.log(JSON.stringify(summary, null, 2));
console.log(`Saved model: ${MODEL_PATH}`);

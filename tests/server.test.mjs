import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer, loadFrozenModel } from "../server.mjs";

test("public server starts without private datasets and accepts local imports", async t => {
  const model = loadFrozenModel();
  assert.equal(model.provenance.test_used_for_training, false);
  const server = createDemoServer({ model, cases: [] });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const root = `http://127.0.0.1:${server.address().port}`;
  const overview = await (await fetch(root + "/api/overview")).json();
  assert.deepEqual(overview.cases, []);
  assert.equal(overview.model.target_kind, "weak_supervision_proxy");
  const template = await (await fetch(root + "/api/example")).json();
  assert.equal(template.template_only, true);
  assert.deepEqual(template.news, []);
  const rejection = await fetch(root + "/api/analyze", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ case: { ...template, outcome: true } }),
  });
  assert.equal(rejection.status, 400);
  assert.match((await rejection.json()).error, /答案/);
  const imported = { ...template, case_id: "HTTP_UNIT_FIXTURE", actors: ["Alpha", "Beta"], news: [{ news_id: "fixture1", date: "2025-08-31", title: "Alpha and Beta met", text: "Alpha and Beta officials met for peace talks.", publisher: "Unit-test fixture only" }] };
  const response = await fetch(root + "/api/analyze", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ case: imported }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.probability.available, false);
  assert.equal(result.probability.real_event_probability, null);
  assert.equal(result.forecast_window.start, "2025-09-01");
  assert.equal(result.forecast_window.end, "2025-09-07");
  const crossSite = await fetch(root + "/health", { headers: { Origin: "https://example.com" } });
  assert.equal(crossSite.status, 403);
});

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { analyzeCase, summarizeModel } from "./lib/engine.mjs";
import { MODEL_PATH, DEMO_ROOT, readDemoCases, readPilotSummary, trainingProvenance, hasDevelopmentData, inputTemplate, validateImportedCase } from "./lib/data.mjs";

const MAX_BODY_BYTES = 25 * 1024 * 1024;

export function loadFrozenModel() {
  if (!fs.existsSync(MODEL_PATH)) throw new Error("缺少artifacts/research-model.json，请恢复公开仓库附带的冻结模型，或自行准备本地数据后运行npm run build-model");
  const model = JSON.parse(fs.readFileSync(MODEL_PATH, "utf8"));
  if (model.schema_version !== 1 || model.model_type !== "cameo19_observed_news_week_ahead_research" || !model.forecast || !model.detector) throw new Error("模型结构或预测目标不匹配");
  if (model.build_contract?.test_gold_used !== false || model.build_contract?.actual_event_probability_validated !== false) throw new Error("模型的实验边界声明不完整");
  const current = hasDevelopmentData() ? trainingProvenance() : {};
  for (const [key, value] of Object.entries(current)) {
    if (model.data_provenance?.[key]?.sha256 !== value.sha256) throw new Error(`模型输入${key}已变化，请重新构建新版模型`);
  }
  return model;
}

function send(response, status, payload, type = "application/json; charset=utf-8") {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(type.startsWith("application/json") ? JSON.stringify(payload) : payload);
  response.writeHead(status, {
    "Content-Type": type, "Content-Length": body.length, "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  });
  response.end(body);
}

async function readBody(request) {
  const type = String(request.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw new Error("请求需要使用JSON格式");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("文件超过25MB的本地演示上限");
    chunks.push(chunk);
  }
  if (!size) throw new Error("请求内容为空");
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("无法解析JSON内容"); }
}

export function createDemoServer({ model = loadFrozenModel(), cases = readDemoCases() } = {}) {
  const byId = new Map(cases.map(row => [row.case_id, row]));
  const metadata = summarizeModel(model);
  const overview = {
    model: { ...metadata, build_contract: model.build_contract },
    cases: cases.map(row => ({
      case_id: row.case_id, title: row.countries_regions, countries_regions: row.countries_regions,
      target_situation: row.target_situation, news_start: row.news_start, news_end: row.news_end,
      split: row.split, news_count: row.news.length,
    })),
    pilot: readPilotSummary(),
  };
  const staticFiles = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/index.html", ["index.html", "text/html; charset=utf-8"]],
    ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
    ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ]);
  return http.createServer(async (request, response) => {
    try {
      const host = String(request.headers.host || "");
      if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) return send(response, 403, { error: "仅允许本机访问" });
      if (request.headers.origin && request.headers.origin !== `http://${host}`) return send(response, 403, { error: "不接受其他网站发起的请求" });
      const route = new URL(request.url, `http://${host}`).pathname;
      if (request.method === "GET" && staticFiles.has(route)) {
        const [filename, type] = staticFiles.get(route);
        return send(response, 200, fs.readFileSync(path.join(DEMO_ROOT, "static", filename)), type);
      }
      if (request.method === "GET" && route === "/health") return send(response, 200, { status: "ok", target: "reported_event_proxy" });
      if (request.method === "GET" && route === "/api/overview") return send(response, 200, overview);
      if (request.method === "GET" && route === "/api/model-report") return send(response, 200, { model: metadata, build_contract: model.build_contract, provenance: model.data_provenance });
      if (request.method === "GET" && route === "/api/example") return send(response, 200, inputTemplate());
      if (request.method === "GET" && route.startsWith("/api/case/")) {
        const row = byId.get(decodeURIComponent(route.slice("/api/case/".length)));
        return row ? send(response, 200, { case: row }) : send(response, 404, { error: "找不到该案例" });
      }
      if (request.method === "POST" && route === "/api/analyze") {
        const payload = await readBody(request);
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("请求需要包含案例对象");
        const record = payload.case ? validateImportedCase(payload.case) : byId.get(String(payload.case_id || ""));
        if (!record) throw new Error("请先选择案例或导入新闻");
        const asOf = payload.as_of || record.news_end;
        const result = await analyzeCase(record, { asOf, model });
        return send(response, 200, result);
      }
      return send(response, 404, { error: "页面不存在" });
    } catch (error) {
      console.error("[research-demo]", error.message);
      if (!response.headersSent) send(response, 400, { error: error.message || "无法完成分析" });
      else response.end();
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = process.argv.indexOf("--port");
  const port = flag === -1 ? 8766 : Number(process.argv[flag + 1]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("端口需要在1024到65535之间");
  const server = createDemoServer();
  server.requestTimeout = 120000;
  server.listen(port, "127.0.0.1", () => console.log(`Seven-day research demo: http://127.0.0.1:${port}/`));
}

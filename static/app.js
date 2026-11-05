"use strict";

const $ = id => document.getElementById(id);
const MAX_BYTES = 25 * 1024 * 1024;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const state = {overview: null, projectCases: [], importedCases: [], currentCase: null, currentOrigin: "project", selectedKey: "", result: null, shownEvents: 12, selectionEpoch: 0, runEpoch: 0, stale: false, busy: false};
const STATUS_LABELS = {candidate: "自动候选", reported: "已报告", occurred: "已报告", claimed: "单方说法", disputed: "存在争议", uncertain: "待核实", planned: "计划", future: "未来计划", risk: "风险描述", historical: "历史回顾", background: "背景回顾", ongoing: "持续状态"};
const FEATURE_LABELS = {action_rate_7: "近七天军事行动报道占比", action_rate_28: "近二十八天军事行动报道占比", action_days_7: "近七天行动报道日数", action_count_7: "近七天军事行动报道", action_count_28: "近二十八天军事行动报道", action_trend: "军事行动报道变化", threat_count_7: "近七天威胁线索", posture_count_7: "近七天部署线索", cooperation_count_7: "近七天协商线索", coverage_7: "近七天新闻覆盖", news_count_7: "近七天新闻数量", active_days_7: "近七天有报道天数", history_days: "可用历史长度"};

function el(tag, className, text) {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text !== undefined && text !== null) value.textContent = String(text);
  return value;
}

function dateValid(value) { return typeof value === "string" && DATE_RE.test(value) && Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value; }
function addDays(value, amount) { const date = new Date(value + "T00:00:00Z"); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); }
function shortDate(value) { return dateValid(value) ? value.slice(5).replace("-", "/") : "日期未知"; }
function numeric(value) { return typeof value === "number" && Number.isFinite(value); }
function percent(value, digits = 0) { return numeric(value) ? (Math.min(1, Math.max(0, value)) * 100).toFixed(digits) + "%" : "—"; }
function number(value) { return numeric(value) ? value.toLocaleString("zh-CN", {maximumFractionDigits: 2}) : "—"; }
function setStatus(message, kind = "") { $("status").textContent = message; $("status").className = "status" + (kind ? " " + kind : ""); $("status").setAttribute("role", kind === "error" ? "alert" : "status"); }

async function request(url, options) {
  let response;
  try { response = await fetch(url, options); }
  catch (_) { throw new Error("无法连接本地服务。请确认演示服务正在运行后重试。"); }
  let payload;
  try { payload = await response.json(); }
  catch (_) { throw new Error("服务没有返回可读取的数据，请重试。"); }
  if (!response.ok) throw new Error(payload.error || payload.message || `请求失败（${response.status}）`);
  return payload;
}

function markStale() {
  if (!state.result) return;
  state.stale = true;
  $("stale-note").hidden = false;
  $("result-content").classList.add("result-content-stale");
  $("export").disabled = true;
}

function setBusy(value) {
  state.busy = value;
  $("run").disabled = value || !state.currentCase;
  $("case-select").disabled = value || !state.projectCases.length && !state.importedCases.length;
  $("as-of").disabled = value || !state.currentCase;
  $("run").firstElementChild.textContent = value ? "正在读取证据…" : "运行七日预测";
  $("results").setAttribute("aria-busy", String(value));
}

function splitLabel(value) { return ({train: "训练案例回放", validation: "验证案例回放", test: "项目测试案例"})[value] || "导入案例"; }
function caseName(value) { return value.title || value.countries_regions || value.case_id || "未命名案例"; }

function buildCaseOptions(preferred) {
  const select = $("case-select");
  select.replaceChildren();
  const groups = state.importedCases.length ? [["本次导入", state.importedCases, "imported"]] : [["项目测试案例", state.projectCases.filter(x => x.split === "test"), "project"], ["训练与验证回放", state.projectCases.filter(x => x.split !== "test"), "project"]];
  for (const [label, items, origin] of groups) {
    if (!items.length) continue;
    const group = el("optgroup"); group.label = label;
    items.forEach((item, index) => { const option = el("option", "", `${item.case_id} · ${caseName(item)}`); option.value = origin + ":" + (origin === "imported" ? index : item.case_id); group.append(option); });
    select.append(group);
  }
  if ([...select.options].some(x => x.value === preferred)) select.value = preferred;
  else if (select.options.length) select.selectedIndex = 0;
  select.disabled = !select.options.length;
  $("restore-project").hidden = !state.importedCases.length || !state.projectCases.length;
}

async function selectCase({run = false} = {}) {
  const epoch = ++state.selectionEpoch;
  ++state.runEpoch;
  state.selectedKey = $("case-select").value;
  const [origin, id] = state.selectedKey.split(":");
  state.currentCase = null;
  state.currentOrigin = origin;
  markStale(); setBusy(true);
  setStatus("正在读取选定案例…", "loading");
  try {
    const selected = origin === "imported" ? state.importedCases[Number(id)] : (await request("/api/case/" + encodeURIComponent(id))).case;
    if (epoch !== state.selectionEpoch) return;
    if (!selected || !Array.isArray(selected.news)) throw new Error("该案例缺少新闻数组，请换一份原始输入。");
    state.currentCase = selected;
    const known = state.projectCases.find(x => x.case_id === selected.case_id);
    $("case-split").textContent = (origin === "imported" ? "本地导入" : splitLabel(known && known.split)) + ` · ${selected.news.length.toLocaleString("zh-CN")} 条新闻`;
    const start = dateValid(selected.news_start) ? selected.news_start : selected.news.map(x => x.date).filter(dateValid).sort()[0];
    const end = dateValid(selected.news_end) ? selected.news_end : selected.news.map(x => x.date).filter(dateValid).sort().at(-1);
    if (!start || !end) throw new Error("案例缺少有效日期，无法设置预测窗口。");
    $("as-of").min = start;
    $("as-of").max = end;
    $("as-of").value = end;
    $("history-range").textContent = `${start} 至 ${end} · 可选择截止日回放`;
    setBusy(false);
    setStatus("案例已就绪。只使用截止日及此前的新闻。");
    if (run) await runAnalysis({scroll: false});
  } catch (error) {
    if (epoch !== state.selectionEpoch) return;
    setBusy(false); setStatus(error.message, "error");
  }
}

function parseText(text) {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) throw new Error("文件为空，请选择包含案例新闻的 JSON 或 JSONL。");
  let value;
  try { value = JSON.parse(trimmed); }
  catch (_) {
    value = trimmed.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
      try { return JSON.parse(line); }
      catch (_) { throw new Error(`JSONL 第 ${index + 1} 行格式不正确。`); }
    });
  }
  if (value && !Array.isArray(value) && Array.isArray(value.rows)) value = value.rows;
  return Array.isArray(value) ? value : [value];
}

function validateCases(values) {
  if (!values.length || values.length > 60) throw new Error("请导入 1 至 60 个案例。");
  const seen = new Set();
  for (const [index, item] of values.entries()) {
    if (!item || typeof item !== "object" || !Array.isArray(item.news)) throw new Error(`第 ${index + 1} 项不是案例新闻输入。请参照下载示例，而不是导入旧版预测结果。`);
    if (typeof item.case_id !== "string" || !item.case_id.trim() || seen.has(item.case_id)) throw new Error(`第 ${index + 1} 项的 case_id 为空或重复。`);
    seen.add(item.case_id);
    if (!dateValid(item.news_start) || !dateValid(item.news_end) || item.news_start > item.news_end) throw new Error(`${item.case_id} 的 news_start / news_end 日期无效。`);
    if (!item.news.length) throw new Error(`${item.case_id} 没有新闻，请补充原始新闻后导入。`);
    const newsIds = new Set();
    for (const [n, news] of item.news.entries()) {
      if (!news || typeof news !== "object" || typeof news.news_id !== "string" || !news.news_id || newsIds.has(news.news_id)) throw new Error(`${item.case_id} 第 ${n + 1} 条新闻的 news_id 为空或重复。`);
      newsIds.add(news.news_id);
      if (!dateValid(news.date) || news.date < item.news_start || news.date > item.news_end) throw new Error(`${item.case_id} 第 ${n + 1} 条新闻日期无效或超出案例范围。`);
      if (typeof news.title !== "string" && typeof news.text !== "string") throw new Error(`${item.case_id} 第 ${n + 1} 条新闻缺少 title 或 text。`);
    }
  }
  return values;
}

async function runAnalysis({scroll = true} = {}) {
  if (!state.currentCase || state.busy) return;
  const asOf = $("as-of").value;
  if (!dateValid(asOf) || asOf < $("as-of").min || asOf > $("as-of").max) { setStatus("请选择案例日期范围内的有效截止日。", "error"); return; }
  const epoch = ++state.runEpoch;
  const selectedKey = state.selectedKey;
  const payload = {case_id: state.currentCase.case_id, as_of: asOf};
  if (state.currentOrigin === "imported") payload.case = state.currentCase;
  markStale(); setBusy(true); setStatus("正在提取截止日前的报道线索并计算七日实验预测…", "loading");
  try {
    const result = await request("/api/analyze", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload)});
    if (epoch !== state.runEpoch || selectedKey !== state.selectedKey) return;
    if (!result || !result.probability || !result.forecast_window) throw new Error("预测结果格式不完整，请重试。");
    state.result = result; state.stale = false; state.shownEvents = 12;
    renderResult(result);
    $("stale-note").hidden = true;
    $("result-content").classList.remove("result-content-stale");
    $("export").disabled = false;
    setStatus(result.probability.available ? "七日实验预测已完成。可以查看时间线和原文证据。" : "历史证据已整理；当前输入不满足数值预测条件，请查看原因。");
    if (scroll) { $("results").focus({preventScroll: true}); $("results").scrollIntoView({behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start"}); }
  } catch (error) { if (epoch === state.runEpoch) setStatus(error.message, "error"); }
  finally { if (epoch === state.runEpoch) setBusy(false); }
}

function renderResult(result) {
  $("initial-state").hidden = true; $("result-content").hidden = false;
  const context = result.case || state.currentCase || {};
  const history = result.history || {};
  const probability = result.probability || {};
  $("result-id").textContent = `CASE ${context.case_id || "—"} · 截止日前证据`;
  $("result-title").textContent = caseName(context);
  $("case-situation").textContent = context.target_situation || "根据所导入案例的新闻范围进行实验预测。";
  $("history-window").textContent = `${history.start || context.news_start || "—"} — ${history.end || result.as_of || "—"}`;
  $("cutoff-date").textContent = result.as_of || "—";
  $("future-window").textContent = `${result.forecast_window.start || "—"} — ${result.forecast_window.end || "—"}`;
  const available = probability.available === true && numeric(probability.value);
  $("probability-value").textContent = available ? percent(probability.value, 1) : "暂不提供数值";
  $("probability-value").className = available ? "" : "unavailable";
  $("probability-description").textContent = available ? "新闻弱标签上的模型估计，未经真实事件标签校准。" : probability.reason || "数据覆盖或时间条件不足，仍可检查历史新闻证据。";
  $("probability-track").hidden = !available;
  $("probability-fill").className = "pct-" + (available ? Math.round(Math.min(1, Math.max(0, probability.value)) * 20) : 0);
  renderBaselines(result.baselines || {});
  renderFutureDays(result.forecast_window);
  renderHistorySummary(history);
  renderTimeline(result.timeline || [], result.as_of);
  renderSignals(result.signals || {});
  renderDrivers(result.explanation || []);
  renderEvents();
  renderQuality(result.data_quality || [], history);
  renderModelFacts(result.model_info || state.overview && state.overview.model || {});
}

function renderBaselines(baselines) {
  const box = $("baselines"); box.replaceChildren();
  for (const [label, value] of [["历史报道率基线", baselines.base_rate], ["上一周报道延续基线", baselines.persistence]]) {
    if (!numeric(value)) continue;
    const span = el("span", "", label); span.append(el("strong", "", percent(value, 0))); box.append(span);
  }
}

function renderFutureDays(window) {
  const box = $("future-days"); box.replaceChildren();
  if (!dateValid(window.start)) return;
  for (let i = 0; i < 7; i++) { const day = addDays(window.start, i); const piece = el("div", "future-day"); piece.append(el("strong", "", shortDate(day)), el("span", "", `第 ${i + 1} 天`)); box.append(piece); }
}

function renderHistorySummary(history) {
  const defs = [["去重相关新闻", history.news_count, "条"], ["可用历史", history.available_days, "天"], ["相关报道日期", history.active_days, "天"], ["最近相关报道距截止日", history.latest_relevant_news_age_days, "天"], ["排除重复新闻", history.excluded_duplicate_count, "条"], ["排除无关新闻", history.excluded_irrelevant_count, "条"], ["排除未来新闻", history.excluded_future_count, "条"]];
  $("history-summary").replaceChildren(...defs.map(([label, value, unit]) => { const div = el("div"); const dd = el("dd", "", number(value)); dd.append(el("small", "", unit)); div.append(el("dt", "", label), dd); return div; }));
}

function svgEl(tag, attrs = {}, text) { const value = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [key, item] of Object.entries(attrs)) value.setAttribute(key, String(item)); if (text !== undefined) value.textContent = String(text); return value; }

function renderTimeline(timeline, asOf) {
  const box = $("timeline-chart"); box.replaceChildren();
  const days = timeline.filter(x => dateValid(x.date) && (!dateValid(asOf) || x.date <= asOf)).sort((a, b) => a.date.localeCompare(b.date));
  $("chart-start").textContent = days[0] && days[0].date || "暂无时间线";
  if (!days.length) { box.append(el("div", "chart-placeholder", "当前截止日之前没有可展示的新闻。")); return; }
  const width = 880, height = 140, left = 2, bottom = 126, top = 10;
  const svg = svgEl("svg", {viewBox: `0 0 ${width} ${height}`, role: "group", "aria-label": "按报道日排列的新闻篇数和军事行动候选报道篇数，点击柱形设置截止日"});
  for (let i = 0; i < 4; i++) svg.append(svgEl("line", {x1: 0, x2: width, y1: top + i * (bottom - top) / 3, y2: top + i * (bottom - top) / 3, class: "chart-grid"}));
  const max = Math.max(1, ...days.map(d => Number(d.news_count) || 0));
  const slot = (width - 10) / days.length;
  days.forEach((day, i) => {
    const x = left + i * slot, bar = Math.max(.7, slot * .72);
    const news = Math.max(0, Number(day.news_count) || 0), actions = Math.max(0, Number(day.action_count) || 0);
    const newsHeight = Math.max(news ? 1 : 0, news / max * (bottom - top));
    const actionHeight = Math.max(actions ? 2 : 0, Math.min(news || actions, actions) / max * (bottom - top));
    const group = svgEl("g", {class: "day-group", tabindex: "0", role: "button", "aria-label": `${day.date}，${news}篇新闻，${actions}篇19类候选报道；设为截止日`});
    group.append(svgEl("title", {}, `${day.date} · ${news} 篇新闻 · ${actions} 篇军事行动候选报道`));
    group.append(svgEl("rect", {x, y: bottom - newsHeight, width: bar, height: newsHeight, rx: 1, class: "news-bar"}));
    group.append(svgEl("rect", {x, y: bottom - actionHeight, width: bar, height: actionHeight, rx: 1, class: "action-bar"}));
    group.append(svgEl("rect", {x: x - slot * .1, y: 0, width: slot, height, class: "day-hitbox"}));
    const choose = () => { if (state.busy) return; $("as-of").value = day.date; markStale(); runAnalysis({scroll: false}); };
    group.addEventListener("click", choose);
    group.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); } });
    svg.append(group);
  });
  svg.append(svgEl("line", {x1: width - 3, x2: width - 3, y1: 1, y2: bottom + 4, class: "cutoff-rule"}));
  box.append(svg);
}

function renderSignals(signals) {
  const defs = [["军事行动候选报道", signals.military_actions], ["威胁候选报道", signals.threats], ["军事姿态候选报道", signals.posture], ["协商候选报道", signals.negotiations]];
  $("signal-strip").replaceChildren(...defs.map(([label, value]) => { const span = el("span", "", label); span.append(el("strong", "", `${number(value)} 篇`)); return span; }));
}

function renderDrivers(explanation) {
  const box = $("drivers"); box.replaceChildren();
  const items = explanation.filter(x => x && numeric(x.contribution)).slice(0, 6);
  if (!items.length) { box.append(el("p", "driver-empty", "当前结果没有可展示的模型特征贡献。历史证据仍列在下方。")); return; }
  for (const item of items) {
    const entry = el("div", "driver");
    entry.append(el("p", "driver-label", item.label || FEATURE_LABELS[item.feature] || item.feature || "历史特征"));
    const bottom = el("div", "driver-bottom");
    bottom.append(el("strong", "driver-value", number(item.value)), el("span", "driver-impact" + (item.contribution < 0 ? " negative" : ""), item.contribution > 0 ? "推高实验估计" : item.contribution < 0 ? "降低实验估计" : "影响较小"));
    entry.append(bottom); box.append(entry);
  }
}

function eventStatus(event) {
  const status = String(event.status || "candidate").toLowerCase();
  if (status === "candidate" && event.assertion === "claimed_or_disputed") return "uncertain";
  return status;
}
function statusMatches(event, selected) {
  const status = eventStatus(event);
  if (selected === "all") return true;
  if (selected === "uncertain") return ["uncertain", "claimed", "disputed"].includes(status);
  if (selected === "planned") return ["planned", "future", "risk"].includes(status);
  if (selected === "historical") return ["historical", "background"].includes(status);
  if (selected === "reported") return ["reported", "occurred", "ongoing"].includes(status);
  return status === selected;
}

function renderEvents() {
  const events = state.result && Array.isArray(state.result.events) ? state.result.events : [];
  const type = $("type-filter").value, status = $("status-filter").value;
  const filtered = events.filter(event => { const code = String(event.code || event.cameo_code || ""); return (type === "all" || type === "cooperation" && /^(03|04)/.test(code) || type !== "cooperation" && code.startsWith(type)) && statusMatches(event, status); });
  const box = $("events"); box.replaceChildren();
  $("evidence-count").textContent = `显示 ${Math.min(state.shownEvents, filtered.length)} / ${filtered.length} 条`;
  if (!filtered.length) { box.append(el("div", "empty-evidence", events.length ? "当前筛选下没有证据。可以切换类型或状态。" : "当前没有识别到事件候选。这不等于现实中没有事件。")); }
  for (const event of filtered.slice(0, state.shownEvents)) {
    const article = el("article", "event-item");
    const code = String(event.code || event.cameo_code || "—");
    const statusValue = eventStatus(event);
    const top = el("div", "event-top");
    top.append(el("span", "event-code", `${code} ${event.code_label || "事件候选"}`), el("span", "event-status" + (["uncertain", "claimed", "disputed", "planned", "risk", "future"].includes(statusValue) ? " attention" : ""), STATUS_LABELS[statusValue] || statusValue), el("span", "event-published", event.published_date || event.date || "日期未知"));
    article.append(top, el("h4", "", event.headline || event.title || "未提供新闻标题"));
    const meta = [event.source || event.publisher || "来源未注明", "按报道日展示"];
    if (event.scope === "context") meta.push("区域背景");
    if (event.scope === "unverified") meta.push("案例归属待核实");
    article.append(el("p", "event-meta", meta.join(" · ")));
    const details = el("details");
    details.append(el("summary", "", "查看原文证据"));
    const quote = event.evidence || event.evidence_quote;
    if (quote) details.append(el("blockquote", "", quote));
    else details.append(el("p", "event-note", "该候选缺少可展示的证据片段，需要进一步核实。"));
    if (event.note) details.append(el("p", "event-note", event.note));
    details.append(el("p", "event-note", "自动识别结果需核验；报道日期不自动等于事件发生日期。"));
    article.append(details); box.append(article);
  }
  $("show-more").hidden = filtered.length <= state.shownEvents;
}

function renderQuality(quality, history) {
  const values = [...quality];
  if (!values.length) values.push({level: "info", message: "当前数据已通过输入格式检查，事件识别和未来预测仍属于实验结果。"});
  if (numeric(history.available_days) && history.available_days < 89) values.push({level: "warning", message: `本次只有 ${history.available_days} 天可用历史，尚未达到完整约三个月回看。`});
  values.push({level: "info", message: "无新闻或未识别到事件，不等于实际没有发生；事件候选不替代人工事实核验。"});
  $("quality-list").replaceChildren(...values.map(item => el("li", item.level === "warning" || item.level === "error" ? "warning" : "", item.message || item.reason || String(item))));
}

function modelValue(model, keys) { for (const key of keys) { const value = key.split(".").reduce((obj, part) => obj && obj[part], model); if (value !== undefined && value !== null) return value; } return undefined; }

function renderModelFacts(model) {
  const facts = [
    ["训练信息截至", modelValue(model, ["trained_through", "training_cutoff", "forecast_trained_through", "training.trained_through"])],
    ["训练滚动样本", modelValue(model, ["training_sample_count", "train_samples", "sample_counts.train", "training.samples"])],
    ["验证滚动样本", modelValue(model, ["validation_sample_count", "validation_samples", "sample_counts.validation", "validation.samples"])],
    ["最短训练历史", modelValue(model, ["minimum_history_days", "min_history_days", "configuration.minimum_history_days"])],
    ["最长历史窗口", modelValue(model, ["maximum_history_days", "max_history_days", "configuration.maximum_history_days"])],
    ["真实事件概率", "尚未验证"]
  ];
  $("model-facts").replaceChildren(...facts.filter(([, value]) => value !== undefined).map(([label, value]) => { const div = el("div"); div.append(el("dt", "", label), el("dd", "", typeof value === "object" ? JSON.stringify(value) : value)); return div; }));
  const metrics = modelValue(model, ["validation_metrics", "evaluation.validation", "validation.metrics", "validation"]) || {};
  const brier = metrics.brier ?? metrics.brier_score;
  const baseline = metrics.baseline_brier;
  const defs = [["模型 Brier", brier], ["常数报道率基线 Brier", baseline], ["上一周延续基线 Brier", metrics.persistence_brier], ["模型 Log loss", metrics.log_loss ?? metrics.logloss], ["常数基线 Log loss", metrics.baseline_log_loss]];
  $("evaluation-metrics").replaceChildren(...defs.filter(([, value]) => numeric(value)).map(([label, value]) => { const span = el("span", "", label); span.append(el("strong", "", value.toFixed(6))); return span; }));
  const compared = numeric(brier) && numeric(baseline);
  const beats = compared && brier < baseline;
  $("benchmark-note").hidden = !compared;
  $("benchmark-note").textContent = compared ? `验证集：模型 Brier ${brier.toFixed(6)}，常数基线 ${baseline.toFixed(6)}（越低越好）。${beats ? "在新闻弱标签上低于该基线，仍未验证真实事件概率。" : "目前未优于常数基线，尚不能证明模型预测更好。"}` : "";
  $("evaluation-note").textContent = `验证指标只针对新闻弱标签，不是真实事件准确率。Brier 越低越好。${compared && !beats ? "当前模型未优于常数报道率基线。" : ""}${numeric(brier) && numeric(metrics.persistence_brier) && brier >= metrics.persistence_brier ? "当前模型未优于上一周延续基线。" : ""}`;
}

function downloadJson(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: "application/json;charset=utf-8"}));
  const link = el("a"); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("analysis-form").addEventListener("submit", event => { event.preventDefault(); runAnalysis(); });
$("case-select").addEventListener("change", () => selectCase());
$("as-of").addEventListener("change", () => { markStale(); setStatus("截止日已改变，运行预测以更新结果。"); });
$("type-filter").addEventListener("change", () => { state.shownEvents = 12; renderEvents(); });
$("status-filter").addEventListener("change", () => { state.shownEvents = 12; renderEvents(); });
$("show-more").addEventListener("click", () => { state.shownEvents += 12; renderEvents(); });
$("export").addEventListener("click", () => { if (!state.result || state.stale) return; const id = String(state.result.case && state.result.case.case_id || "case").replace(/[^a-zA-Z0-9_-]/g, "_"); downloadJson(state.result, `project3-seven-day-${id}-${state.result.as_of || "result"}.json`); setStatus("已导出当前完整结果，包含目标口径与数据限制。"); });
$("restore-project").addEventListener("click", () => { state.importedCases = []; $("import-meta").textContent = "无外部 API 调用"; buildCaseOptions("project:S021"); selectCase(); });
$("file-input").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (state.busy) throw new Error("当前分析尚未完成，请稍后导入。");
    if (file.size > MAX_BYTES) throw new Error("文件超过 25 MB，请拆成较小批次。");
    const cases = validateCases(parseText(await file.text()));
    state.importedCases = cases;
    $("import-meta").textContent = `${file.name} · ${cases.length} 个案例 · 仅在本机处理`;
    buildCaseOptions("imported:0"); await selectCase();
    setStatus(`已导入 ${cases.length} 个案例。请选择截止日并运行预测。`);
  } catch (error) { setStatus(error.message + " 当前已加载的数据仍保留。", "error"); }
  finally { event.target.value = ""; }
});
$("model-report-button").addEventListener("click", async () => { try { const report = await request("/api/model-report"); downloadJson(report, "project3-seven-day-model-report.json"); } catch (error) { setStatus(error.message, "error"); } });

async function initialize() {
  try {
    const overview = await request("/api/overview");
    if (!Array.isArray(overview.cases)) throw new Error("本地服务返回的案例列表格式不正确。");
    state.overview = overview; state.projectCases = overview.cases;
    $("model-state").classList.add("ready");
    $("model-state").replaceChildren(el("span"), document.createTextNode("本地实验模型已载入"));
    renderModelFacts(overview.model || {});
    if (!overview.cases.length) {
      $("case-select").replaceChildren(el("option", "", "请先导入自己的新闻案例"));
      $("case-split").textContent = "尚未准备案例输入，可使用自带原始数据或自行导入";
      $("initial-state").querySelector("h2").textContent = "模型已就绪，等待导入新闻";
      $("initial-state").querySelector("p").textContent = "先运行 node scripts/prepare-input.mjs 准备自带案例并重启服务，或直接导入自己的 JSON / JSONL 新闻文件。格式模板仅说明字段。";
      setStatus("冻结模型已载入。请先准备自带案例输入，或从左侧导入新闻。");
      return;
    }
    buildCaseOptions("project:S021");
    await selectCase({run: true});
  } catch (error) {
    $("model-state").textContent = "本地服务未就绪";
    setStatus(error.message, "error");
  }
}

initialize();

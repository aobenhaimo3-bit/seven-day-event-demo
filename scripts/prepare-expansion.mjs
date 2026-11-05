import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const EXPANSION_ROOT = path.join(ROOT, 'local-data/expansion/2026-11-04');
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const normalize = text => String(text).normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
const lines = file => fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateValid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
export function matchesNeutralTerm(row, window) {
  if (!window.terms?.length) return true;
  const text=normalize(`${row.title || ''}\n${row.text || ''}`);
  return window.terms.some(term=>new RegExp('(?<![a-z])'+normalize(term).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![a-z])','i').test(text));
}
export function sourceAuthorized(row) {
  if(row.publisher==='Voice of America') return row.editorial_origin===row.publisher
    && row.license==='Public domain (VOA original text)'
    && row.license_url==='https://www.voanews.com/p/5338.html'
    && !row.authors?.some(name=>/\b(?:Reuters|Associated Press|Agence France|AFP|AP)\b/i.test(name))
    && Array.isArray(row.author_urls) && row.author_urls.length>=row.authors?.length
    && row.author_urls.every(url=>/^https:\/\/(?:www\.)?voanews\.com\/author\//.test(url));
  if(row.publisher==='Global Voices') return row.editorial_origin===row.publisher
    && row.license==='CC BY 3.0' && row.license_url==='https://creativecommons.org/licenses/by/3.0/'
    && row.license_source_url==='https://globalvoices.org/about/global-voices-attribution-policy/'
    && Array.isArray(row.author_urls) && row.author_urls.length>=row.authors?.length
    && row.author_urls.every(url=>/^https:\/\/(?:[a-z-]+\.)?globalvoices\.org\/author\//.test(url));
  return false;
}

export function eligible(row, window, publisher) {
  return row.publisher === publisher && row.full_text_status === 'available'
    && typeof row.text === 'string' && row.text.trim().length >= 100
    && dateValid(row.published_date) && row.published_date >= window.start && row.published_date <= window.end
    && row.window_ids?.includes(window.id)
    && matchesNeutralTerm(row,window)
    && /^https:\/\//.test(row.canonical_url || '')
    && Array.isArray(row.authors) && row.authors.some(a => typeof a === 'string' && a.trim())
    && row.content_sha256 === sha256(row.text)
    && Boolean(row.license && row.license_url && row.retrieved_at) && sourceAuthorized(row);
}

export function pickByMonth(rows, window, publisher, plan) {
  const byUrl = new Map();
  for (const row of rows.filter(r => eligible(r, window, publisher))) {
    const previous = byUrl.get(row.canonical_url);
    if (previous && previous.content_sha256 !== row.content_sha256) throw new Error(`Conflicting snapshots: ${row.canonical_url}`);
    byUrl.set(row.canonical_url, row);
  }
  const rank = r => sha256(`${plan.seed}|${window.id}|${publisher}|${r.canonical_url}`);
  const buckets = new Map();
  for (const row of [...byUrl.values()].sort((a,b) => rank(a).localeCompare(rank(b)))) {
    const month = row.published_date.slice(0,7);
    if (!buckets.has(month)) buckets.set(month, []);
    buckets.get(month).push(row);
  }
  const selected = [], seenText = new Set();
  const months = [...buckets.keys()].sort();
  while (selected.length < plan.target_per_source_window && months.some(m => buckets.get(m).length)) {
    for (const month of months) {
      while (buckets.get(month).length && selected.length < plan.target_per_source_window) {
        const row = buckets.get(month).shift(), key = sha256(normalize(row.text));
        if (seenText.has(key)) continue;
        seenText.add(key); selected.push(row); break;
      }
    }
  }
  return selected;
}

export function buildExpansion(candidates, plan, existingTexts = []) {
  const known = new Set(existingTexts.map(t => sha256(normalize(t))));
  const pool = candidates.filter(r => !known.has(sha256(normalize(r.text || ''))));
  const selected = [], coverage = [];
  for (const window of plan.windows) for (const publisher of plan.sources) {
    const available = pool.filter(r => eligible(r, window, publisher));
    const picks = pickByMonth(pool, window, publisher, plan);
    coverage.push({window_id:window.id,stratum:window.stratum,publisher,
      candidates:candidates.filter(r=>r.publisher===publisher && r.window_ids?.includes(window.id)).length,
      neutral_term_mismatches:pool.filter(r=>r.publisher===publisher&&r.full_text_status==='available'&&r.window_ids?.includes(window.id)&&!matchesNeutralTerm(r,window)).length,
      usable_candidates:available.length,target:plan.target_per_source_window,selected:picks.length,
      shortage:Math.max(0,plan.target_per_source_window-picks.length),
      status:picks.length===plan.target_per_source_window?'quota_met':'coverage_missing'});
    for (const row of picks) selected.push({
      schema_version:1,pair_id:`EXP-${window.id}::${row.news_id}`,
      sampling_window:{...window},split:'unassigned',review_status:'pending',labels:null,reviews:[],
      relevance_verified:false,negative_label_verified:false,
      historical_snapshot_verified:false,
      modified_after_publication_day:Boolean(row.source_modified_at && String(row.source_modified_at).slice(0,10)>row.published_date),
      news:{...row},content_group:sha256(normalize(row.text)),
    });
  }
  const bySource = Object.fromEntries(plan.sources.map(s=>[s,selected.filter(r=>r.news.publisher===s).length]));
  const strata = [...new Set(plan.windows.map(w=>w.stratum))];
  const groups = new Map();
  for (const row of selected) { if(!groups.has(row.content_group)) groups.set(row.content_group,[]); groups.get(row.content_group).push(row.pair_id); }
  return {selected,report:{
    version:plan.version,selection_seed:plan.seed,target_pairs:plan.windows.length*plan.sources.length*plan.target_per_source_window,
    candidate_records:candidates.length,usable_records:candidates.filter(r=>r.full_text_status==='available').length,
    existing_development_text_duplicates:candidates.length-pool.length,
    selected_pairs:selected.length,unique_news:new Set(selected.map(r=>r.news.canonical_url)).size,
    unique_normalized_texts:groups.size,selected_pairs_by_publisher:bySource,
    selected_pairs_by_stratum:Object.fromEntries(strata.map(s=>[s,selected.filter(r=>r.sampling_window.stratum===s).length])),
    exclusions:Object.fromEntries([...new Set(candidates.filter(r=>r.full_text_status!=='available').map(r=>r.exclusion_reason || 'unspecified'))].sort().map(reason=>[reason,candidates.filter(r=>(r.exclusion_reason||'unspecified')===reason).length])),
    review_status:'all_pending',verified_negative_labels:0,used_for_training:false,frozen_60_changed:false,
    neutral_term_filter:'API/slug retrieval is checked against whole-word country/region terms in title or body; multiword terms such as Red Sea must occur as a phrase. No military/peace outcome keywords or model scores are used.',
    coverage,shared_content_groups:[...groups].filter(([,ids])=>ids.length>1).map(([hash,pair_ids])=>({hash,pair_ids})),
    limitations:[
      'General-calendar control means dates selected without an event trigger, not verified peaceful periods or negative outcomes.',
      'Country/region retrieval is broader than bilateral event relevance; every selected pair needs human relevance and event labels.',
      'Global Voices and VOA form an accessible-source panel, not a representative sample of all media. Genre and editorial origin must be reported separately.',
      'VOA discovery uses sitemap lastmod and URL terms with a fixed 30-candidate/window cap; true publication dates are checked afterward. This is not complete historical coverage.',
      'Same text or story can appear under several cases/windows. Group related reports before future data splitting; different publishers do not guarantee independent factual evidence.',
      'Sparse quotas remain missing. No failure, absence of news or uncertain judgement is converted to a negative label.',
      'New samples are unassigned and unreviewed. Existing training data, validation data, model and fixed 60-item review set are not replaced.',
      'Retrieved pages are current versions of historical articles, not authenticated publication-time snapshots. Preserve modification timestamps and verify archived versions before any point-in-time forecasting experiment.',
    ],
  }};
}

function catalogHtml(samples, report) {
  const cards=samples.map(row=>`<article data-source="${escape(row.news.publisher)}" data-stratum="${escape(row.sampling_window.stratum)}"><h2>${escape(row.news.title)}</h2><p class="meta">${escape(row.pair_id)} · ${escape(row.news.published_date)} · ${escape(row.news.publisher)} · ${row.sampling_window.stratum==='general_calendar_control'?'一般日历对照':'原窗口跨媒体'}</p><p>研究范围：${escape(row.sampling_window.topic)}。相关性与事件标签均待人工审核。</p><p>作者：${escape(row.news.authors.join('、'))} · <a href="${escape(row.news.canonical_url)}">原始报道</a> · <a href="${escape(row.news.license_url)}">${escape(row.news.license)}</a></p><details><summary>展开全文</summary><div class="body">${escape(row.news.text)}</div><p class="meta">仅提取文字并规范化空白；移除图片、图注及嵌入媒体。来源及署名如上。本文不代表模型或研究者的观点。</p></details></article>`).join('\n');
  return `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>补充新闻样本</title><style>body{font:16px/1.65 system-ui,sans-serif;margin:36px auto;max-width:1040px;padding:0 24px;background:#f5f7fa;color:#1d2939}header,article{background:#fff;border:1px solid #dce3eb;border-radius:10px;padding:24px;margin:18px 0}h1{margin:0}h2{font-size:21px;margin:0}a{color:#1762a0}.meta{color:#617187;font-size:14px}.body{white-space:pre-wrap;font-family:Georgia,serif;margin-top:18px}select{font:inherit;padding:6px;margin:12px 18px 0 0}summary{cursor:pointer;color:#1762a0}article[hidden]{display:none}</style><header><h1>补充新闻样本</h1><p>${report.selected_pairs}个案例—新闻组合，${report.unique_news}篇独立新闻；全部待审核。</p><p>“一般日历对照”按日期取样，不表示和平时期或负例。新闻体裁、报道来源与事实独立性仍需审阅。</p><label>媒体 <select id="source"><option value="">全部</option><option>Global Voices</option><option>Voice of America</option></select></label><label>采样层 <select id="stratum"><option value="">全部</option><option value="same_window_cross_media">原窗口跨媒体</option><option value="general_calendar_control">一般日历对照</option></select></label><p id="count" class="meta"></p></header>${cards}<script>function filter(){let n=0;for(const a of document.querySelectorAll('article')){a.hidden=(source.value&&a.dataset.source!==source.value)||(stratum.value&&a.dataset.stratum!==stratum.value);if(!a.hidden)n++;}document.getElementById('count').textContent='显示 '+n+' 条';}const source=document.getElementById('source'),stratum=document.getElementById('stratum');source.onchange=filter;stratum.onchange=filter;filter();</script></html>`;
}

export function assertFrozenSamplesUnchanged(prior, selected) {
  if(JSON.stringify(prior)!==JSON.stringify(selected)) throw new Error('已有样本或审核字段发生变化，禁止覆盖。请保留原始记录并另建版本。');
}

export function prepareExpansion() {
  const planFile=path.join(ROOT,'research/data-expansion-plan.json'),plan=JSON.parse(fs.readFileSync(planFile,'utf8'));
  const files=['globalvoices-candidates.jsonl','voa-candidates.jsonl'];
  const sources=files.map(file=>({file:path.join(EXPANSION_ROOT,file),name:file}));
  const candidates=sources.flatMap(s=>lines(s.file));
  const existing=['train_pairs.jsonl','validation_pairs.jsonl'].flatMap(f=>lines(path.join(ROOT,'local-data',f)).map(r=>r.news.text));
  const {selected,report}=buildExpansion(candidates,plan,existing);
  report.plan_sha256=sha256(fs.readFileSync(planFile));
  report.fixed_review_input_sha256=sha256(fs.readFileSync(path.join(ROOT,'local-data/evaluation/review.jsonl')));
  report.frozen_model_sha256=sha256(fs.readFileSync(path.join(ROOT,'artifacts/research-model.json')));
  report.source_files=sources.map(s=>({name:s.name,sha256:sha256(fs.readFileSync(s.file))}));
  if(!/^[a-z0-9.-]+$/i.test(plan.version)) throw new Error('Invalid expansion version');
  const output=path.join(EXPANSION_ROOT,`samples-${plan.version}.jsonl`);
  report.selected_file=path.basename(output);
  if(fs.existsSync(output)) {
    const prior=lines(output);
    assertFrozenSamplesUnchanged(prior,selected);
  }
  fs.writeFileSync(output,selected.map(r=>JSON.stringify(r)).join('\n')+'\n');
  fs.writeFileSync(path.join(EXPANSION_ROOT,'catalog.html'),catalogHtml(selected,report));
  const manifest={...report,selected:selected.map(r=>({pair_id:r.pair_id,window:r.sampling_window.id,publisher:r.news.publisher,date:r.news.published_date,url:r.news.canonical_url,sha256:r.news.content_sha256,content_group:r.content_group}))};
  fs.writeFileSync(path.join(ROOT,'research/data-expansion-report.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({target:report.target_pairs,selected:report.selected_pairs,unique_news:report.unique_news,by_publisher:report.selected_pairs_by_publisher,by_stratum:report.selected_pairs_by_stratum,shortage:report.coverage.reduce((n,r)=>n+r.shortage,0),output},null,2));
  return {selected,report};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) prepareExpansion();

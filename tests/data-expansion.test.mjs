import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExpansion, pickByMonth, sha256, matchesNeutralTerm, eligible, assertFrozenSamplesUnchanged } from '../scripts/prepare-expansion.mjs';
const window={id:'calendar-X',stratum:'general_calendar_control',start:'2024-01-01',end:'2024-03-31'};
const publisher='Global Voices';
const plan={version:'test',seed:'fixed',sources:[publisher],target_per_source_window:4,windows:[window]};
const row=(i,date)=>{const text='Synthetic parser regression text only. '.repeat(5)+i;return {news_id:'n'+i,publisher,editorial_origin:publisher,canonical_url:'https://example.com/'+i,text,published_date:date,authors:['Named author'],author_urls:['https://globalvoices.org/author/test-fixture'],window_ids:[window.id],full_text_status:'available',content_sha256:sha256(text),license:'CC BY 3.0',license_url:'https://creativecommons.org/licenses/by/3.0/',license_source_url:'https://globalvoices.org/about/global-voices-attribution-policy/',retrieved_at:'2026-11-04T00:00:00Z'};};

test('expansion sampling is order invariant and spreads across observed months',()=>{
  const rows=Array.from({length:12},(_,i)=>row(i,`2024-0${1+i%3}-10`));
  const picked=pickByMonth(rows,window,publisher,plan);
  assert.deepEqual(picked,pickByMonth(rows.toReversed(),window,publisher,plan));
  assert.equal(new Set(picked.map(r=>r.published_date.slice(0,7))).size,3);
});
test('missing, excluded, forged, invalid-date and duplicate texts do not fill quotas',()=>{
  const a=row(1,'2024-01-10');
  const rows=[a,{...a,news_id:'copy',canonical_url:'https://example.com/copy'}, {...row(2,'2024-02-10'),full_text_status:'excluded'},row(3,'2024-02-31'),{...row(4,'2024-03-10'),content_sha256:'wrong'},{...row(5,'2024-03-10'),authors:[]}];
  const result=buildExpansion(rows,plan);
  assert.equal(result.selected.length,1);
  assert.equal(result.report.coverage[0].shortage,3);
  assert.equal(result.report.coverage[0].status,'coverage_missing');
});
test('calendar control is never auto-labelled negative or merged into training',()=>{
  const result=buildExpansion([row(1,'2024-01-10')],plan);
  const sample=result.selected[0];
  assert.equal(sample.labels,null);assert.equal(sample.split,'unassigned');assert.equal(sample.review_status,'pending');
  assert.equal(sample.negative_label_verified,false);assert.equal(sample.relevance_verified,false);
  assert.equal(result.report.used_for_training,false);
});
test('known development text is excluded and same URL with changing snapshots is rejected',()=>{
  const a=row(1,'2024-01-10');
  assert.equal(buildExpansion([a],plan,[a.text.toUpperCase()]).selected.length,0);
  assert.throws(()=>pickByMonth([a,{...row(2,'2024-01-10'),canonical_url:a.canonical_url}],window,publisher,plan),/Conflicting snapshots/);
});
test('broad search hits need the actual country or region phrase, not disconnected query words',()=>{
  const w={...window,terms:['Red Sea','Yemen']};
  assert.equal(matchesNeutralTerm({text:'Red flags were shown on a boat in the Mediterranean Sea.'},w),false);
  assert.equal(matchesNeutralTerm({text:'Shipping trade in the Red Sea.'},w),true);
  assert.equal(matchesNeutralTerm({text:'Music and education in Yemen.'},w),true);
});
test('wire bylines cannot inherit an original VOA license from an available flag',()=>{
  const a={...row(1,'2024-01-10'),publisher:'Voice of America',editorial_origin:'Voice of America',authors:['Reporter'],author_urls:['https://www.voanews.com/author/reporter'],license:'Public domain (VOA original text)',license_url:'https://www.voanews.com/p/5338.html'};
  assert.equal(eligible(a,window,'Voice of America'),true);
  assert.equal(eligible({...a,authors:['Reuters']},window,'Voice of America'),false);
  assert.equal(eligible({...a,author_urls:['https://example.com/author']},window,'Voice of America'),false);
});
test('pending human notes and verification changes are protected from overwrite',()=>{
  const samples=buildExpansion([row(1,'2024-01-10')],plan).selected;
  assert.doesNotThrow(()=>assertFrozenSamplesUnchanged(structuredClone(samples),samples));
  for(const change of [{notes:'Human notes'},{relevance_verified:true},{negative_label_verified:true},{historical_snapshot_verified:true},{labels:{action:false}},{reviews:[{reviewer:'human'}]}]) {
    assert.throws(()=>assertFrozenSamplesUnchanged([{...samples[0],...change}],samples),/禁止覆盖/);
  }
});
test('English Global Voices articles can credit authors on its multilingual profile sites',()=>{
  const a={...row(1,'2024-01-10'),author_urls:['https://fr.globalvoices.org/author/test-fixture/']};
  assert.equal(eligible(a,window,publisher),true);
  assert.equal(eligible({...a,author_urls:['https://globalvoices.org.other-domain.com/author/test-fixture/']},window,publisher),false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {sha256} from '../scripts/prepare-expansion.mjs';
import {shingles} from '../scripts/audit-expansion.mjs';
import {neutralFocus,supplementEligible,authorizedSupplement,nearDuplicate,buildSupplement} from '../scripts/prepare-expansion-supplement.mjs';
const w={id:'cross-S017',reference_case:'S017',start:'2024-10-23',end:'2025-01-22',terms:['Congo'],stratum:'same_window_cross_media'};
const original={windows:[w],sources:['Global Voices','Voice of America'],target_per_source_window:1};
const plan={version:'test-v3',seed:'seed',sources:['Global Voices','Voice of America','African Arguments','Common Dreams'],target_per_window:2,terms:{S017:['Congo','Congolese','DRC','Rwanda']}};
function article(id=1,publisher='Voice of America'){
 const text='Congo. '+Array.from({length:100},(_,i)=>`word${id}part${i}`).join(' ');
 const voa=publisher==='Voice of America';
 return {news_id:`test-${id}`,publisher,editorial_origin:publisher,canonical_url:`https://${voa?'www.voanews.com':'globalvoices.org'}/a/article-${id}`,title:`Congo topic ${id}`,text,published_date:'2024-11-06',window_ids:[w.id],authors:['Jane Journalist'],author_urls:[`https://${voa?'www.voanews.com':'globalvoices.org'}/author/jane`],full_text_status:'available',content_sha256:sha256(text),retrieved_at:'2026-11-04T00:00:00Z',license:voa?'Public domain (VOA original text)':'CC BY 3.0',license_url:voa?'https://www.voanews.com/p/5338.html':'https://creativecommons.org/licenses/by/3.0/',license_source_url:voa?'https://www.voanews.com/p/5338.html':'https://globalvoices.org/about/global-voices-attribution-policy/'};
}
function pair(n){return {pair_id:`EXP-${w.id}::${n.news_id}`,news:n,sampling_window:w,labels:null,reviews:[],review_status:'pending',split:'unassigned',relevance_verified:false};}
test('new candidates require actual publication date, full text hash and source provenance',()=>{
 const n=article();assert.ok(supplementEligible(n,w,plan));
 for(const patch of [{published_date:'2025-01-23'},{published_date:'2024-11-31'},{text:n.text+' changed'},{window_ids:[]},{canonical_url:'https://evil.example/a/1'},{editorial_origin:'Reuters'}])assert.equal(Boolean(supplementEligible({...n,...patch},w,plan)),false);
});
test('a passing domain or generic source flag cannot authorize an unknown license',()=>{
 assert.equal(authorizedSupplement({...article(),publisher:'Unknown',authorized:true}),false);
 assert.equal(authorizedSupplement({...article(),publisher:'Common Dreams',editorial_origin:'Common Dreams',canonical_url:'https://www.commondreams.org/news/example',license:'CC BY 4.0'}),false);
 const memo={...article(),publisher:'Middle East Monitor',editorial_origin:'Middle East Monitor',canonical_url:'https://www.middleeastmonitor.com/20250101-example/',license:'CC BY-NC-SA 4.0',license_url:'https://creativecommons.org/licenses/by-nc-sa/4.0/',license_source_url:'https://www.middleeastmonitor.com/20250101-example/',article_license_verified:true};
 assert.equal(authorizedSupplement(memo),false);
 memo.author_verification={kind:'article_byline',source_url:memo.canonical_url,display_names:memo.authors};assert.equal(authorizedSupplement(memo),true);
 memo.author_verification.kind='visible_article_byline';assert.equal(authorizedSupplement(memo),true);
 memo.authors=['Reuters'];memo.author_verification.display_names=memo.authors;assert.equal(authorizedSupplement(memo),false);
});
test('geographic focus requires a whole neutral term in title or lead, not a late mention',()=>{
 assert.equal(neutralFocus({title:'Other subject',text:'x '.repeat(500)+'Congo'},w,plan),false);
 assert.equal(neutralFocus({title:'Congolese public health',text:''},w,plan),true);
 assert.equal(neutralFocus({title:'congology',text:''},w,plan),false);
});
test('priority cases reject lead country lists and Red Sea stories without Yemen context',()=>{
 const strict={...plan,title_focus_cases:['S017','S018']};
 assert.equal(neutralFocus({title:'Letter to the UN on Israel',text:'Rwanda is among the signatories.'},w,strict),false);
 const sea={...w,reference_case:'S018',terms:['Red Sea','Yemen']};
 assert.equal(neutralFocus({title:'Red Sea trade in the Horn of Africa',text:'Ethiopia and Somalia signed an agreement.'},sea,strict),false);
 assert.equal(neutralFocus({title:'Red Sea shipping costs',text:'Companies discuss Yemen and Houthi operations.'},sea,strict),true);
});
test('supplement preserves every base review field and leaves new labels unassigned',()=>{
 const base=[pair(article(1,'Global Voices'))];base[0].reviews=[{reviewer:'human',note:'retain this'}];
 const before=JSON.stringify(base);const {selected,report}=buildSupplement(base,[article(2)],original,plan);
 assert.equal(JSON.stringify(base),before);assert.deepEqual(selected[0],base[0]);
 assert.equal(selected.length,2);assert.equal(selected[1].labels,null);assert.equal(selected[1].split,'unassigned');assert.equal(selected[1].relevance_verified,false);assert.equal(report.remaining_window_shortage,0);
});
test('duplicate URLs, titles, development text and strong rewrites never fill missing slots',()=>{
 const base=[pair(article(1,'Global Voices'))];const b=article(2);b.text=base[0].news.text;b.content_sha256=sha256(b.text);
 assert.equal(buildSupplement(base,[b],original,plan).report.added_pairs,0);
 assert.equal(buildSupplement(base,[article(3)],original,plan,[article(3)]).report.added_pairs,0);
 const c={...article(4),title:base[0].news.title};assert.equal(buildSupplement(base,[c],original,plan).report.added_pairs,0);
 assert.ok(nearDuplicate(shingles(article(7).text),shingles(article(7).text+' added ending')));
 const training=article(8),rewrite={...article(9),text:training.text+' Additional sentence.'};rewrite.content_sha256=sha256(rewrite.text);
 assert.equal(buildSupplement([], [rewrite],original,plan,[training]).report.added_pairs,0);
});
test('deterministic selection is input-order independent and does not inflate another publisher quota',()=>{
 const base=[pair(article(1,'Global Voices'))],pool=[article(2),article(3),article(4)];
 const a=buildSupplement(base,pool,original,plan),b=buildSupplement(base,[...pool].reverse(),original,plan);
 assert.deepEqual(a.selected,b.selected);
 const onlyGV=buildSupplement(base,[article(5,'Global Voices')],original,plan);
 assert.equal(onlyGV.report.remaining_window_shortage,0);assert.equal(onlyGV.report.original_publisher_shortage,1);
});
test('conflicting snapshots of the same candidate URL fail loudly',()=>{
 const a=article(2),b={...article(3),canonical_url:a.canonical_url};
 assert.throws(()=>buildSupplement([], [a,b],original,plan),/Conflicting candidate snapshots/);
});

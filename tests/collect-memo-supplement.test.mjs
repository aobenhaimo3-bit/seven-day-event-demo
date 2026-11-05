import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMemo,memoText} from '../scripts/collect-memo-supplement.mjs';
const w=[{id:'cross-S018',reference_case:'S018',start:'2024-12-15',end:'2025-03-14'}];
const post={id:1,link:'https://www.middleeastmonitor.com/20250101-test/',title:{rendered:'Yemen education'},date_gmt:'2025-01-01T10:00:00',modified_gmt:'2025-01-02T10:00:00',author:17,content:{rendered:'<p>'+('Education in Yemen and trade in the Red Sea. '.repeat(20))+'</p><p>READ: Unrelated Syria story</p>'}};
const page='<div class="memo-news-date"><p>January 1, 2025 at 10:00 am</p></div><div class="memo-news-author-content"></div><p>Unless otherwise stated in the article above</p><a href="http://creativecommons.org/licenses/by-nc-sa/4.0/">license</a>';
test('unsigned institutional attribution never uses WP internal account',()=>{const r=parseMemo(post,page,'now',w);assert.equal(r.full_text_status,'available');assert.deepEqual(r.authors,['Middle East Monitor (unsigned)']);assert.equal(r.source_type,'publisher_unsigned_news');assert.equal(r.author_verification.kind,'publisher_unsigned_byline');assert.equal(r.factual_independence_verified,false);assert.ok(!r.text.includes('READ:'));});
test('whole agency byline excluded but ordinary quotation does not imply whole reprint',()=>{const byline=page.replace('<div class="memo-news-author-content"></div>','<div class="memo-news-author-content"><a href="https://www.middleeastmonitor.com/authors/reuters/">Reuters</a></div>');assert.equal(parseMemo(post,byline,'now',w).exclusion_reason,'agency_byline');const quote={...post,content:{rendered:post.content.rendered+'<p>A minister told Reuters the talks were continuing.</p>'}};assert.equal(parseMemo(quote,page,'now',w).full_text_status,'available');assert.deepEqual(parseMemo(quote,page,'now',w).quoted_source_mentions,['Reuters']);});
test('article license required and related link cannot manufacture neutral relevance',()=>{assert.equal(parseMemo(post,'','now',w).exclusion_reason,'article_license_unverified');assert.ok(!memoText('<p>Ordinary text</p><p><b>READ: Yemen attacks</b></p>').text.includes('Yemen'));});
test('publication date is cross-checked against visible article date without local-time shift',()=>{const r=parseMemo(post,page,'now',w);assert.equal(r.visible_publication_date,'2025-01-01');assert.equal(r.public_article_date_verified,true);assert.equal(parseMemo(post,page.replace('January 1, 2025','January 2, 2025'),'now',w).exclusion_reason,'api_and_visible_publication_date_mismatch');});
test('explicit agency report attribution includes has reported and newsroom comment requests',()=>{for(const text of ['Yemen officials met, Reuters has reported.','Yemen officials met, Anadolu has reported.','The official did not immediately respond to a request for comment from AFP.']){const p={...post,content:{rendered:'<p>'+text+'</p>'+post.content.rendered}};assert.equal(parseMemo(p,page,'now',w).exclusion_reason,'agency_report_attribution');}});
test('standalone centered bold internal related headline is removed; ordinary linked prose stays',()=>{
 const url='https://www.middleeastmonitor.com/20240910-related-syria-story/';
 const result=memoText(`<p>Body cites <a href="${url}"><b>another article</b></a> as evidence.</p><p style="text-align: center;"><a href="${url}"><b>Standalone recommendation</b></a></p><p style="text-align:center"><b><a href="https://example.org/report">External source report</a></b></p><p><a href="${url}"><b>Non-centred linked evidence</b></a></p>`);
 assert.equal(result.removed_related_blocks.length,1);assert.ok(!result.text.includes('Standalone recommendation'));assert.ok(result.text.includes('Body cites another article as evidence.'));assert.ok(result.text.includes('External source report'));assert.ok(result.text.includes('Non-centred linked evidence'));
});
test('unsigned lead wire attribution excluded regardless of verb order; named citation remains marked',()=>{
 for(const sentence of ['A source familiar with the matter told Reuters on Friday.','Officials discussed Yemen according to Reuters.','Yemen officials met, AFP said.']){
  const p={...post,content:{rendered:'<p>'+sentence+'</p>'+post.content.rendered}};
  assert.equal(parseMemo(p,page,'now',w).exclusion_reason,'agency_report_attribution');
  const named=page.replace('<div class="memo-news-author-content"></div>','<div class="memo-news-author-content"><a href="https://www.middleeastmonitor.com/authors/named-writer/">Named Writer</a></div>');
  const r=parseMemo(p,named,'now',w);assert.equal(r.full_text_status,'available');assert.ok(r.quoted_source_mentions.length);
 }
});

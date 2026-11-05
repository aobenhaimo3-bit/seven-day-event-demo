import test from 'node:test';
import assert from 'node:assert/strict';
import {extractArticle,extractAuthors,exclusionReason,queryUrl} from '../scripts/collect-globalvoices.mjs';
test('author extraction keeps coauthors but excludes translators and recommended article bylines',()=>{
 const html=`<div id='post-header-credit'><div class='contributor-name'><span>Written by</span><a href='https://x/a'>Alice</a>, <a href='https://x/b'>Bob</a></div><div class='contributor-name'><span>Translated by</span><a href='https://x/c'>Translator</a></div></div><div class='post-translations'><div class='contributor-name'>Written by<a href='https://x/d'>Other</a></div>`;
 assert.deepEqual(extractAuthors(html),{names:['Alice','Bob'],urls:['https://x/a','https://x/b']});
 assert.deepEqual(extractAuthors(html.replace('Written by','Written (Français) by')),{names:['Alice','Bob'],urls:['https://x/a','https://x/b']});
 assert.deepEqual(extractAuthors(html.replaceAll('contributor-name','text-credits-section')),{names:['Alice','Bob'],urls:['https://x/a','https://x/b']});
});
test('keeps paragraph and quoted text, removes nested captions and embeds without fetching images',()=>{
 const r=extractArticle('<div class="wp-caption"><div><img src="x"></div><p>Caption</p></div><p>A &amp; B <a href="https://example.org/a">report</a>.</p><blockquote><p>Quoted &#8217; text</p></blockquote><iframe>Video</iframe><p>Final.</p>');
 assert.equal(r.text,'A & B report.\n\nQuoted ’ text\n\nFinal.'); assert.deepEqual(r.source_links,['https://example.org/a']);
});
test('preserves ordinary subject matter and excludes identified third party republication',()=>{
 const body='The story of the community and the people is in the report. It was written for the readers and has information on the culture of the region and its artists.';
 assert.equal(exclusionReason(body,'https://globalvoices.org/2024/story/'),null);
 assert.equal(exclusionReason('This article was originally published by Partner. '+body,'https://globalvoices.org/2024/story/'),'third_party_republication_notice');
 assert.equal(exclusionReason('This article originally appeared on Global Voices. '+body,'https://globalvoices.org/2024/story/'),null);
 assert.equal(exclusionReason('This article was first published by Partner. It is republished on Global Voices. '+body,'https://globalvoices.org/2024/story/'),'third_party_republication_notice');
 assert.equal(exclusionReason('These images first appeared on a forum. '+body,'https://globalvoices.org/2024/story/'),null);
 assert.equal(exclusionReason('The award is for a collection of verse first published in England. '+body,'https://globalvoices.org/2024/story/'),null);
 assert.equal(exclusionReason('This report was initially published by Partner. '+body,'https://globalvoices.org/2024/story/'),'third_party_republication_notice');
 assert.equal(exclusionReason('This article is published as part of a content-sharing agreement. '+body,'https://globalvoices.org/2024/story/'),'third_party_republication_notice');
 assert.equal(exclusionReason('This article is reproduced courtesy of Partner. '+body,'https://globalvoices.org/2024/story/'),'third_party_republication_notice');
 assert.equal(exclusionReason('','https://globalvoices.org/2024/story/'),'empty_body');
 assert.equal(exclusionReason(body,'https://fr.globalvoices.org/2024/story/'),'non_english_site');
});
test('date bounds include first day midnight and entire final date, with explicit complete pagination',()=>{
 const u=new URL(queryUrl({start:'2024-01-01',end:'2024-03-31'},'Red Sea',2));
 assert.equal(u.searchParams.get('after'),'2023-12-31T23:59:59'); assert.equal(u.searchParams.get('before'),'2024-04-01T00:00:00'); assert.equal(u.searchParams.get('page'),'2'); assert.equal(u.searchParams.get('per_page'),'100'); assert.equal(u.searchParams.get('search'),'Red Sea');
});
test('excludes explicit ongoing republication and media partnership notices, preserves original fellowship reporting',()=>{
 const url='https://globalvoices.org/2025/story/';
 const body='The community and the people in the region have a story to tell. This report is about their work and the changes that are taking place in the country.';
 for(const notice of [
  'Global Voices is republishing the article, edited for length and clarity, with permission from Russia Post.',
  'Global Voices is reprinting this story from Russia Post.',
  'This article was written by Shukhat Hurramov for Vlast.kz. An edited version is published on Global Voices under a media partnership agreement.',
  'This story is published on Global Voices with permission from Partner.',
 ]) assert.equal(exclusionReason(notice+'\n\n'+body,url),'third_party_republication_notice',notice);
 assert.equal(exclusionReason('This article was produced as part of the Global Voices Climate Justice fellowship.\n\n'+body,url),null);
 assert.equal(exclusionReason('This article was produced in partnership with Global Voices as part of its Climate Justice fellowship.\n\n'+body,url),null);
});

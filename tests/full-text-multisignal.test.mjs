import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {extractArticleSignals} from '../lib/engine.mjs';
const aliases=JSON.parse(fs.readFileSync(new URL('../research/case_aliases.json',import.meta.url),'utf8'));
const model={aliases,detector:{prior_log_odds:0,log_ratios:{}}};
const news=(text,title='Russia and Ukraine report')=>({news_id:'unit-only',date:'2025-06-01',publisher:'Synthetic regression fixture',title,text});
const sig=(text,title,case_id='S001')=>extractArticleSignals({case_id},news(text,title),model);

test('late paragraphs and late scope evidence are read without silent text truncation',()=>{
 const filler=Array.from({length:40},(_,i)=>`Paragraph ${i} describes the publication format and archival process. ${'Neutral background text. '.repeat(8)}`).join('\n');
 const positive=sig(filler+'\nRussia launched airstrikes against Ukraine today.','A long dispatch');
 assert.equal(positive.relevant,true);assert.equal(positive.action,true);
 assert.ok(positive.events.some(e=>e.evidence==='Russia launched airstrikes against Ukraine today.'));
 const historical=sig(filler+'\nRussia launched airstrikes against Ukraine in 2023.','A long dispatch');
 assert.equal(historical.action,false);
});

test('distinct signals in one scoped clause do not suppress each other',()=>{
 const deployed=sig('Russia deployed troops to Ukraine and launched airstrikes against Ukraine.');
 assert.equal(deployed.action,true);assert.equal(deployed.posture,true);
 assert.ok(deployed.events.some(e=>e.code==='15'&&e.status==='candidate'));
 assert.ok(deployed.events.some(e=>e.code.startsWith('19')&&e.status==='candidate'));
 const talks=sig('Russia and Ukraine held talks following Russian shelling of Ukraine today.');
 assert.equal(talks.action,true);assert.equal(talks.cooperation,true);
 assert.equal(sig('Russia did not deploy troops to Ukraine but launched airstrikes against Ukraine.').posture,false);
});

test('late positive signals retain evidence after multiple historical candidates',()=>{
 const r=sig('In 2023 Russia launched airstrikes against Ukraine.\nIn 2023 Russia shelled Ukraine.\nIn 2023 Russia invaded Ukraine.\nIn 2023 Russia deployed troops to Ukraine.\nIn 2023 Russia and Ukraine held talks.\nRussia launched airstrikes against Ukraine today.');
 assert.equal(r.action,true);assert.ok(r.events.some(e=>e.code.startsWith('19')&&e.status==='candidate'));
});

test('independent labels keep other named subjects and their time out of the case',()=>{
 for(const text of ['Russia shelled Ukraine while India and Pakistan held talks.','Russia shelled Ukraine after France and Germany held talks.']){
  const r=sig(text);assert.equal(r.action,true);assert.equal(r.cooperation,false);
 }
 const posture=sig('Russia shelled Ukraine and China deployed troops near Taiwan.');assert.equal(posture.action,true);assert.equal(posture.posture,false);
 const threat=sig('Russian forces shelled Ukraine while China warned of legal consequences.');assert.equal(threat.action,true);assert.equal(threat.threat,false);
 const same=sig('Russia shelled Ukraine and deployed troops near Kyiv.');assert.equal(same.action,true);assert.equal(same.posture,true);
 const talks=sig('Russia shelled Ukraine while Russian and Ukrainian officials held talks.');assert.equal(talks.action,true);assert.equal(talks.cooperation,true);
 const time=sig('Russia shelled Ukraine today while China deployed troops near Taiwan in 2023.');assert.equal(time.action,true);assert.equal(time.posture,false);
});

test('coordinated noun modifiers do not become independent event clauses',()=>{
 const aliases={cases:{CHECK:{strong:['Alpha'],context:['Bay'],groups:[['Alpha'],['Beta']]}}};
 const m={...model,aliases};
 const a=extractArticleSignals({case_id:'CHECK'},news('Alpha attacked a vessel in Bay in response to Gamma and Delta air strikes today.','Alpha and Beta report'),m);
 const b=extractArticleSignals({case_id:'CHECK'},news('Alpha attacked a vessel in Bay in response to air strikes by Gamma and Delta today.','Alpha and Beta report'),m);
 assert.equal(a.action,true);assert.equal(b.action,true);
});

test('alias substrings and reporter datelines do not establish theatre relevance',()=>{
 assert.equal(sig('Scientists in the Democratic Republic of the Congo studied forest plants.','Forest research','S017').relevant,false);
 assert.equal(sig('Goma, Democratic Republic of the Congo – Doctors investigated an outbreak in western Panzi.','Medical research','S017').relevant,false);
 assert.equal(sig('Congolese army forces confronted M23 rebels in Goma today.','Eastern conflict','S017').relevant,true);
 assert.equal(sig('DRC officials discussed humanitarian operations in Goma.','Eastern update','S017').relevant,true);
 assert.equal(sig('Russia and Ukraine — officials held talks today.').relevant,true);
});

test('diplomatic descriptions, legal consequences and sports are not military signals',()=>{
 assert.equal(sig('Russia and Ukraine face a diplomatic crisis.').cooperation,false);
 assert.equal(sig('Russia and Ukraine discussed the legal consequences of occupation.').threat,false);
 assert.equal(sig('Russia warned of airstrikes in Ukraine.').threat,true);
 assert.equal(sig('Syria and Assad officials described the Idlib Paralympic games.','Syria Paralympic games','S016').relevant,false);
 assert.equal(sig('India and Pakistan face off in the Champions Trophy.','India and Pakistan Champions Trophy','S020').relevant,false);
});

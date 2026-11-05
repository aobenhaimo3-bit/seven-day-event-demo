import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {extractArticleSignals} from '../lib/engine.mjs';
const aliases=JSON.parse(fs.readFileSync(new URL('../research/case_aliases.json',import.meta.url),'utf8'));
const model={aliases,detector:{prior_log_odds:0,log_ratios:{}}};
const sig=(text,case_id='S001',title='Russia and Ukraine update')=>extractArticleSignals({case_id},{news_id:'context-test-only',date:'2025-06-01',title,text,publisher:'Synthetic regression only'},model);
test('initialisms preserve actor and predicate in the same source sentence',()=>{
 const r=sig('The U.S. military launched airstrikes against Houthi targets in Yemen today.','S018','US and Yemen security update');
 assert.equal(r.action,true);assert.ok(r.events.some(e=>e.evidence.includes('U.S. military launched airstrikes')));
});
test('regional security scope admits actual local actions without a mandatory second country',()=>{
 assert.equal(sig('Turkish forces launched airstrikes on targets in Syria today.','S016','Syria security update').action,true);
 assert.equal(sig('Syrian air defences shot down some of the missiles near Damascus today.','S016','Syria security update').relevant,true);
 assert.equal(sig('Houthis launched missiles against Israel today.','S018','Yemen security update').action,true);
 assert.equal(sig('Syrian officials condemned Israeli airstrikes against Gaza.','S016','Syria statement').action,false);
});
test('bullet and pronominal continuations retain a nearby anchor with literal evidence',()=>{
 const r=sig('Russia and Ukraine troops confronted each other.\n- They exchanged gunfire near the border today.');
 assert.equal(r.action,true);assert.ok(r.events.some(e=>e.evidence==='They exchanged gunfire near the border today.'));
});
test('context cannot cross a new named actor, a historical anchor or a distant gap',()=>{
 assert.equal(sig('Russia and Ukraine held peace talks. China launched airstrikes against Taiwan today.').action,false);
 assert.equal(sig('Russia and Ukraine troops confronted each other in 2020. They exchanged gunfire.','S001','Archive').action,false);
 assert.equal(sig('Russia and Ukraine troops confronted each other.\nA neutral note describes page layout.\nAnother note explains the archive.\nThey exchanged gunfire today.','S001','Archive').action,false);
 for(const text of ['They said China shelled Taiwan.','They said China warned Taiwan of military attacks.','The officials said India and Pakistan met in Delhi.']){
  const r=sig('Russia and Ukraine discussed the war. '+text);assert.equal(r.action,false);assert.equal(r.threat,false);assert.equal(r.cooperation,false);
 }
});

test('threat time belongs to the actual warning rather than a future attack',()=>{
 const r=sig('Russia warned Ukraine today that it would launch military attacks tomorrow.');
 assert.equal(r.threat,true);assert.equal(r.action,false);assert.ok(r.events.some(e=>e.code==='13'&&e.temporal.status==='current'));
 assert.equal(sig('In 2023 Russia warned Ukraine that it would launch military attacks.').threat,false);
 assert.equal(sig('Russia will warn Ukraine tomorrow that it will launch military attacks.').threat,false);
 assert.equal(sig('Houthis warn Israel today of renewed naval attacks if aid is not delivered in four days.','S018','Houthis warning').threat,true);
});
test('refugee nationality and military status do not create a new local action or deployment',()=>{
 assert.equal(sig('Syrian nationals were killed in an Israeli airstrike in Lebanon today.','S016','Syria refugee update').action,false);
 assert.equal(sig('Refugees who fled war in Syria were bombed in the country where they sought shelter.','S016','Syria refugee update').action,false);
 assert.equal(sig('Israeli jets launched airstrikes in Syria from Lebanon today.','S016','Syria security update').action,true);
 assert.equal(sig('Iran maintains a military presence in Syria.','S016','Syria military update').posture,false);
 assert.equal(sig('Syrian military forces deployed reinforcements today.','S016','Syria military update').posture,true);
 assert.equal(sig('Palestinian students participated in conferences and mobilisations.','S019','Palestine solidarity').posture,false);
});
test('resuming an announced campaign and bypassing a blockade do not assert a new engagement',()=>{
 assert.equal(sig('Houthis to resume shipping attacks on Israeli vessels.','S018','Houthi announcement').action,false);
 assert.equal(sig('Houthis announced the resumption of their attacks on Israeli ships.','S018','Houthi announcement').action,false);
 assert.equal(sig('Russia helped Ukraine bypass the naval blockade.').action,false);
 assert.equal(sig('Russia imposed a naval blockade against Ukraine today.').action,true);
 assert.equal(sig('Russia resumed shelling Ukraine today.').action,true);
});

import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {extractArticleSignals} from '../lib/engine.mjs';
const aliases=JSON.parse(fs.readFileSync(new URL('../research/case_aliases.json',import.meta.url)));
const model={aliases,detector:{prior_log_odds:0,log_ratios:{}}};
const signal=(text,id='S018')=>extractArticleSignals({case_id:id},{news_id:'integration-fixture',date:'2025-06-01',title:id==='S018'?'Yemen Houthi security update':'Gaza political update',text},model);
test('defined officials retain identity for communication without borrowing unrelated reported subjects',()=>{
 const definition='Houthi military spokesman Yahya Saree described attacks in Yemen.\n';
 const gap='A neutral paragraph explains the page format.\n'.repeat(4);
 const good=signal(definition+gap+'Saree vowed to carry out more military operations against Israeli ships.');
 assert.equal(good.threat,true);assert.ok(good.events.some(e=>e.code==='13'&&e.communication_context?.term==='Saree'));
 const other=signal(definition+gap+'Saree said China warned Taiwan of military attacks.');assert.equal(other.threat,false);
 assert.equal(signal(definition+gap+'Saree met his childhood friend in Paris.').cooperation,false);
 assert.equal(signal(definition+gap+'In 2020 Saree met with foreign officials.').cooperation,false);
});
test('actual direct military commitments and real regional diplomatic interactions are retained',()=>{
 const r=signal('The Houthi military spokesman said:\n“I will not hesitate to direct further measures.”');
 assert.equal(r.threat,true);assert.equal(r.action,false);
 assert.equal(signal('Jordan and Yemen have signed a memorandum of understanding.').cooperation,true);
 assert.equal(signal('The official met with the Sanaa government’s Foreign Minister.').cooperation,true);
 assert.equal(signal('The UN chief briefed member states about the military situation in Rafah.','S019').cooperation,true);
});
test('figurative and risk statements remain excluded even with source-bound actors',()=>{
 assert.equal(signal('The Houthis vowed to meet “escalation with escalation”.').cooperation,false);
 assert.equal(signal('The Houthi ministry said the armed group poses a “threat to national security”.').threat,false);
 assert.equal(signal('A UN official warns an attack on Rafah by Israel would be the largest military offensive.','S019').threat,false);
 assert.equal(signal('Previous meetings of the Syrian Constitutional Committee have failed to make progress.','S016').cooperation,false);
 assert.equal(signal('The recent fighting shows the military faces difficulty in meeting its mandate in Yemen.').cooperation,false);
 assert.equal(signal('Officials discussed military attacks in Gaza.\n“I can end this war,” the president said, dismissing the Ukrainian President’s concern about the Riyadh meeting.','S019').cooperation,false);
});
test('undated campaign consequences do not silently refresh a historical deployment',()=>{
 const old=signal('From November 2023, Houthis launched attacks off Yemen.\nTwo vessels were sunk in the offensive. Many more seafarers were taken captive.\nThe campaign provoked the United States to deploy naval missions in the Red Sea.');
 assert.equal(old.posture,false);
 assert.equal(signal('From November 2023, Houthis launched attacks off Yemen.\nThe campaign prompted forces to deploy naval missions in Yemen today.').posture,true);
});

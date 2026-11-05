import test from 'node:test';
import assert from 'node:assert/strict';
import {extractArticleSignals,DETECTOR_RULE_VERSION} from '../lib/engine.mjs';
import {assertionFor} from '../lib/assertions.mjs';
import {actionRelation} from '../lib/event-relations.mjs';
const model={detector_rule_version:DETECTOR_RULE_VERSION,aliases:{cases:{}},detector:{prior_log_odds:0,log_ratios:{}}};
const record={case_id:'VOCABULARY_FIXTURE',actors:['Alpha']};
const signal=text=>extractArticleSignals(record,{news_id:'synthetic-vocabulary-only',title:'Alpha security update',text,date:'2025-06-01',publisher:'Unit-test fixture only'},model);
function compatible(text){const relation=actionRelation(text),assertion=assertionFor(text,{kind:'action'});assert.equal(relation.supported,true,text);assert.ok(assertion.mentions.some(m=>m.start<relation.action_end&&m.end>relation.action_start),text);assert.equal(assertion.status,'asserted',text);assert.equal(signal(text).action,true,text);}
test('weapon interception and opening fire have compatible relation, assertion and action gates',()=>{
 for(const text of ['Alpha forces shot down all the drones and missiles today.','Alpha air defences shot down some of the missiles today.','Alpha troops intercepted three incoming missiles today.','Alpha soldiers opened fire on opposing troops today.'])compatible(text);
});
test('geographic capture and taking control accept quantities and plural targets across all gates',()=>{
 for(const text of ['Alpha rebels have taken control of a strategic town today.','Alpha soldiers took control of two villages today.','Alpha troops captured two towns today.','Alpha forces recaptured the city today.','Alpha rebels seized control of the district today.']){compatible(text);assert.ok(signal(text).events.some(e=>e.code==='192'),text);}
});
test('new verbs retain negation, planning, dispute, exercise and time gates',()=>{
 for(const text of ['Alpha forces did not shoot down the drones today.','Alpha troops will intercept the missiles tomorrow.','Alpha forces denied intercepting the missiles today.','Alpha forces shot down drones during military exercises today.','Alpha troops plan to capture two towns tomorrow.','Alpha rebels did not take control of the town today.','Alpha troops captured two towns in 2020.'])assert.equal(signal(text).action,false,text);
});
test('messages, proposals, imagery and financial control are not military action verbs',()=>{
 for(const text of ['Alpha military officials shot down the proposal today.','Alpha intelligence intercepted messages about missiles today.','Alpha troops intercepted missile shipments today.','Alpha military intercepted drone signals today.','Alpha troops captured photos of two towns today.','Alpha army officials took control of the bank today.','Alpha military officials seized control of a company today.']){assert.equal(actionRelation(text).supported,false,text);assert.equal(signal(text).action,false,text);}
});
test('capture still requires armed context and lexical additions do not lower the score threshold',()=>{
 assert.equal(signal('Alpha photographers captured two towns in photographs today.').action,false);
 const low={...model,detector:{prior_log_odds:-10,log_ratios:{}}};
 for(const text of ['Alpha troops intercepted missiles today.','Alpha forces captured two towns today.'])assert.equal(extractArticleSignals(record,{news_id:'synthetic-low-score',title:'Alpha security update',text,date:'2025-06-01'},low).action,false,text);
});

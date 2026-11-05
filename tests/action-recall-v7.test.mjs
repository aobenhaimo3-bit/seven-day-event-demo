import test from 'node:test';
import assert from 'node:assert/strict';
import {ACTION_PATTERN,FORCE_PATTERN,HARD_ACTION_PATTERN} from '../lib/action-vocabulary.mjs';
import {actionRelation,actionRelations} from '../lib/event-relations.mjs';

test('all action candidates retain exact source offsets rather than only the first mention',()=>{
 const text='Russia denied an attack on Ukraine, but Russian forces shelled Donetsk today.';
 const rows=actionRelations(text);assert.ok(rows.length>=2);
 assert.ok(rows.some(r=>r.action_text==='shelled'));
 for(const r of rows)assert.equal(text.slice(r.action_start,r.action_end),r.action_text);
 assert.equal(actionRelation(text).action_text,'attack');
});
test('military strikes and ongoing heavy-weapons fire share candidate vocabulary',()=>{
 for(const text of ['Israeli strikes hit Damascus.','M23 forces have been launching heavy artillery on the town.','Syrian troops exchanged ground fire.']){
  assert.ok(ACTION_PATTERN.test(text));assert.ok(actionRelation(text).supported);
 }
 assert.ok(FORCE_PATTERN.test('Houthi fighters'));assert.ok(FORCE_PATTERN.test('Houthis'));
 assert.ok(HARD_ACTION_PATTERN.test('launching heavy artillery'));
 assert.equal(HARD_ACTION_PATTERN.test('strike a commercial deal'),false);
});
test('neutral lexical senses do not gain a hard military-action bypass',()=>{
 for(const text of ['workers on strike','strike a deal','economic violence','combat disease','offensive comments','a blockade of social media'])assert.equal(HARD_ACTION_PATTERN.test(text),false,text);
});
test('multi-candidate API preserves reporter exclusions and explicit new actors',()=>{
 const r=actionRelations('Russia and Ukraine discussed Israeli strikes against Gaza.')[0];
 assert.ok(!/Russia|Ukraine/.test(r.event_text));assert.match(r.event_text,/Israeli.*Gaza/);
});

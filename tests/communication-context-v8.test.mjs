import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCommunicationBindings,communicationBinding} from '../lib/communication-context.mjs';
const scoped=s=>/\b(?:Yemen|Syria|Gaza)\b/.test(s);
const c={case_id:'S018'},aliases={cases:{S018:{strong:['Houthi'],groups:[],context:[]}}};
test('only source-defined officials and institutional abbreviations establish bindings',()=>{
 const b=buildCommunicationBindings(['Houthi military spokesman Yahya Saree described operations in Yemen.','Central Command, or CENTCOM, reported strikes in Syria.','President Random Person spoke about sports.'],scoped);
 assert.ok(b.some(e=>e.term==='Saree'));assert.ok(b.some(e=>e.term==='CENTCOM'));assert.ok(!b.some(e=>e.term.includes('Random')));
 assert.equal(communicationBinding(c,'Saree vowed more military operations.',{bindings:b,isScoped:scoped,aliases}).term,'Saree');
 assert.equal(communicationBinding(c,'Random Person held talks.',{bindings:b,isScoped:scoped,aliases}),null);
 assert.equal(communicationBinding(c,'Saree held talks about Ukraine.',{bindings:b,isScoped:scoped,aliases}),null);
 assert.equal(communicationBinding(c,'Saree said China warned Taiwan of military attacks.',{bindings:b,isScoped:scoped,aliases}),null);
 assert.equal(communicationBinding(c,'Saree discussed the meeting with the Ukrainian President.',{bindings:b,isScoped:scoped,aliases}),null);
});
test('a country name elsewhere in an article is insufficient for an unrelated interlocutor',()=>{
 const b=buildCommunicationBindings(['President Alpha Leader discussed Gaza.'],scoped);
 assert.equal(communicationBinding(c,'China met Russia.',{bindings:b,nearbyText:'Yemen security update.',isScoped:scoped,aliases}),null);
});

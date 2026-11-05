import test from 'node:test';
import assert from 'node:assert/strict';
import {THREAT_PATTERN,COOPERATION_PATTERN,communicationDecision} from '../lib/communication.mjs';
import {assertionFor} from '../lib/assertions.mjs';
const decide=(text,kind,contextText='')=>communicationDecision(text,{kind,contextText,baseStatus:assertionFor(text,{kind}).status});

test('actual conditional military threat differs from the future attack and future speech',()=>{
 for(const text of ['Russia warned that it would attack Ukraine if talks failed.','Russia said Ukraine would pay the full price for attacks.','Russia pledged to hunt down armed rebels.','The military said it will continue attacks until the hostages are freed.'])assert.equal(decide(text,'threat').status,'asserted',text);
 assert.equal(assertionFor('Russia warned that it would attack Ukraine if talks failed.',{kind:'action'}).status,'planned');
 for(const text of ['Russia will warn Ukraine of airstrikes tomorrow.','Russia might issue an ultimatum for troops to withdraw from Ukraine.'])assert.equal(decide(text,'threat').status,'planned',text);
 assert.notEqual(decide('Russia denied threatening military action against Ukraine.','threat').status,'asserted');
});

test('civilian warnings, analyst predictions and legal consequences do not become military threats',()=>{
 for(const text of ['Analysts said Russia would attack Ukraine.','Humanitarian agencies warned that attacks threaten food supplies.','The WHO warned of health consequences in the war.','Officials warned of legal consequences for Israel.','The bank promised to respond to the financial crisis.'])assert.equal(decide(text,'threat').status,'unknown',text);
});

test('reported direct threats can inherit a bounded already scoped speech context',()=>{
 const s='Any ship shall be targeted if it enters the area.';
 assert.equal(decide(s,'threat','The Houthi military spokesman said:').status,'asserted');
 assert.notEqual(decide(s,'threat','Analysts discussed shipping risks.').status,'asserted');
});

test('meetings, calls, actual briefings and resolutions share cooperation assertion coverage',()=>{
 for(const text of ['Rubio meets Netanyahu in Jerusalem.','Blinken spoke with Guterres on Thursday.','The president described his calls over the weekend with the Egyptian president.','The Security Council adopted a resolution on Gaza.','The UN chief briefed member states on Gaza.','The UNSC has begun negotiations to renew the mandate.','Jordan and Yemen have signed a memorandum of understanding.']){
  assert.equal(COOPERATION_PATTERN.test(text),true,text);assert.equal(decide(text,'cooperation').status,'asserted',text);
 }
});

test('requested, cancelled, denied and prospective diplomatic interactions remain excluded',()=>{
 for(const text of ['Officials called for talks on Gaza.','Officials urged negotiations over Gaza.','Leaders will meet in Cairo.','The planned meeting in Cairo is expected tomorrow.','Rubio to meet Netanyahu tomorrow.','The minister will call his counterpart.'])assert.equal(decide(text,'cooperation').status,'planned',text);
 for(const text of ['The meeting was cancelled.','Angola called off the meeting.','Officials did not hold talks.'])assert.equal(decide(text,'cooperation').status,'negated',text);
 assert.equal(COOPERATION_PATTERN.test('Relations faced a diplomatic crisis.'),false);
 assert.equal(THREAT_PATTERN.test('Russia warned of airstrikes.'),true);
 assert.equal(decide('Officials met in Cairo and will hold another meeting tomorrow.','cooperation').status,'asserted');
 assert.equal(decide('The army met the requirements of the inspection.','cooperation').status,'unknown');
});

test('figurative meeting, violence and private reminiscence do not establish diplomacy',()=>{
 for(const text of ['The armed group promised to meet escalation with escalation.','The demonstrators were met with harsh beatings and live bullets.','We had last met four days ago.','Prisoners were exchanged under the ceasefire agreement.'])assert.equal(decide(text,'cooperation','War continued in Gaza.').status,'unknown',text);
 for(const text of ['Officials discussed the upcoming meeting.','The minister accepted an invitation to a meeting.','The president declined the invitation to a meeting.'])assert.equal(decide(text,'cooperation').status,'planned',text);
 assert.equal(decide('Officials held talks and accepted an invitation to another meeting.','cooperation').status,'asserted');
 assert.equal(decide('Diplomats met under the ceasefire agreement.','cooperation').status,'asserted');
});

test('threat descriptions and explanations differ from a new actual threat commitment',()=>{
 for(const text of ['The army said the rebel group poses a serious military threat.','The spokesman described military efforts to degrade the rebels.','The military described an effort to threaten the enemy.'])assert.equal(decide(text,'threat').status,'unknown',text);
 assert.equal(decide('The military spokesman said forces will continue to degrade ISIS capabilities.','threat').status,'asserted');
 assert.equal(decide('The group said it will limit its attacks to commercial ships only.','threat').status,'asserted');
 assert.notEqual(decide('The group said it will stop all attacks.','threat').status,'asserted');
});

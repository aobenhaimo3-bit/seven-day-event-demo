import test from 'node:test';
import assert from 'node:assert/strict';
import {cooperationDecision as d,COOPERATION_PATTERN} from '../lib/cooperation.mjs';
const decide=(s,b='asserted')=>d(s,{baseStatus:b}).status;
test('actual resumed and ongoing interactions survive a different prospective clause',()=>{
 for(const s of ['The president wants to end war, even as the administration continues its diplomatic push for a ceasefire.','The UNSC has begun negotiations to renew the mandate.','The parties are negotiating with other countries.','Jordan and Yemen have signed a memorandum of understanding.','Indirect negotiations resumed in Qatar.']){assert.equal(COOPERATION_PATTERN.test(s),true);assert.equal(decide(s,'planned'),'asserted',s);}
 assert.equal(decide('Officials held talks and will hold another meeting tomorrow.'),'asserted');
});
test('quoted figurative meet, violence and nominal summaries are excluded',()=>{
 for(const s of ['The group pledged to meet “escalation with escalation”.','Demonstrators were met with harsh beatings and live bullets.','The two separate talks reflect a growing role in attempts to end wars.','People evacuated under the ceasefire agreement.','We had last met four days ago.','The army met the requirements.'])assert.equal(decide(s),'unknown',s);
});
test('requests, planned votes, invitations and denied interactions are not completed',()=>{
 for(const s of ['The council will adopt a resolution tomorrow.','Officials called for talks.','Leaders are scheduled to meet in Cairo.','Rubio to meet Netanyahu tomorrow.','The minister accepted an invitation to a meeting.','The UNSC proposed negotiations.','The meeting will be held tomorrow.','Talks scheduled for next month concern Gaza.'])assert.equal(decide(s),'planned',s);
 for(const s of ['Officials did not hold talks.','The meeting was cancelled.','Angola called off the meeting.','Officials refused to meet in Cairo.'])assert.equal(decide(s),'negated',s);
 assert.equal(decide('Officials denied holding talks.'),'disputed');
});
test('real calls, briefings and resolutions remain covered',()=>{
 for(const s of ['Blinken spoke with Guterres on Thursday.','The president described his calls over the weekend with the Egyptian president.','The council adopted a resolution.','The UN chief briefed member states.','Officials met with the foreign minister.'])assert.equal(decide(s),'asserted',s);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {THREAT_PATTERN,threatDecision} from '../lib/threat.mjs';
const d=(text,baseStatus='asserted',contextText='')=>threatDecision(text,{baseStatus,contextText});
test('explicit military commitments include object negation and continued operations',()=>{
 for(const text of ['The military said it will not hesitate to direct further measures.','The spokesman confirmed military operations will continue until the aggression stops.','The armed group vowed to carry out more military operations.','The leader issued a threat to Hamas, ensuring it pays the full price.','Israel issues more war threats.']){assert.equal(THREAT_PATTERN.test(text),true,text);assert.equal(d(text,'planned').status,'asserted',text);}
 assert.equal(d('The army said it will not hesitate to attack.','negated').status,'asserted');
 assert.equal(d('The army said if aid is not supplied it will attack.','negated').status,'asserted');
});
test('actual speech proof may be supplied only by scoped direct-quote context',()=>{
 assert.equal(d('We will continue to take appropriate action to protect ships from Houthi attacks.','planned','The military spokesman said:').status,'asserted');
 assert.notEqual(d('We will continue to take appropriate action to protect ships from Houthi attacks.','planned','Analysts discussed shipping.').status,'asserted');
 assert.equal(d('If they did that they would be obliterated.','planned','The military commander said:').status,'asserted');
});
test('denied or hypothetical speech and analyst predictions remain excluded',()=>{
 assert.equal(d('Houthis warn Israel today of renewed naval attacks if aid is not delivered in four days.','planned').status,'asserted');
 assert.notEqual(d('If Houthis warn Israel of naval attacks, talks might fail.','planned').status,'asserted');
 for(const text of ['The army denied threatening attacks.','The army did not issue a threat of military action.','The military warning was denied.'])assert.notEqual(d(text,'negated').status,'asserted',text);
 for(const text of ['The army will warn of attacks tomorrow.','If the army threatened military action, talks might fail.','Analysts said the army would launch attacks.'])assert.notEqual(d(text,'planned').status,'asserted',text);
});
test('quoted dangers, military rationales and civilian consequences are not uttered threats',()=>{
 for(const text of ['The ministry said the armed group poses a "threat to national security".','The army said the strikes were part of an effort to degrade rebels.','The health agency warned of humanitarian consequences in the war.','The army warned of legal consequences.','The ministry said it will stop all attacks.'])assert.notEqual(d(text).status,'asserted',text);
 assert.equal(d('The military spokesman said forces will continue to degrade ISIS capabilities.').status,'asserted');
});

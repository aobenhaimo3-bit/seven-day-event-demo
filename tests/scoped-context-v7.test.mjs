import test from 'node:test';
import assert from 'node:assert/strict';
import {regionalSecurityScope,caseEntityHit,contextContinuation} from '../lib/scope.mjs';
test('declared regional scope accepts local force and diplomacy, not unrelated countries',()=>{
 assert.equal(regionalSecurityScope('S016','Turkish forces struck targets in Syria.'),true);
 assert.equal(regionalSecurityScope('S018','Houthis attacked an Israeli ship.'),true);
 assert.equal(regionalSecurityScope('S018','Yemen officials held talks in Cairo.'),true);
 assert.equal(regionalSecurityScope('S001','Russian forces attacked targets in Syria.'),false);
 assert.equal(regionalSecurityScope('S016','A Syrian artist held an exhibition.'),false);
 assert.equal(regionalSecurityScope('S016','The Syrian government received five thousand Russian language books for schools.'),false);
 assert.equal(regionalSecurityScope('S016','Syria cultural update. Russia attacked Ukraine.'),false);
});
test('case context is bounded to explicit entities or unambiguous continuations',()=>{
 const c={case_id:'X',actors:['Alpha']};assert.equal(caseEntityHit(c,'Alpha officials met diplomats.',{}),true);
 assert.equal(caseEntityHit(c,'Beta officials met diplomats.',{}),false);
 assert.equal(contextContinuation('They held talks today.'),true);
 assert.equal(contextContinuation('China held talks today.'),false);
});

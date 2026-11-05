import test from 'node:test';
import assert from 'node:assert/strict';
import { actionRelation } from '../lib/event-relations.mjs';

test('reporters and commentators are excluded from the local combat span', () => {
  const r = actionRelation('Russia and Ukraine discussed Israeli airstrikes against Gaza.');
  assert.equal(r.actor_text, 'Israeli');
  assert.equal(r.target_text, 'Gaza');
  assert.ok(!/Russia|Ukraine/.test(r.event_text));
  const q = actionRelation('Russia launched airstrikes against Syria and Ukraine officials condemned the attack.');
  assert.equal(q.target_text, 'Syria');
  assert.ok(!q.event_text.includes('Ukraine'));
  const mixed='Russia did not attack Ukraine, but Israel launched airstrikes against Gaza.';
  const local=actionRelation(mixed);
  assert.ok(!local.event_text.includes('Gaza'));
  assert.equal(mixed.slice(local.action_start,local.action_end),'attack');
});

test('reported direct engagements and passive engagements retain their participants', () => {
  assert.match(actionRelation('Officials said Russia launched airstrikes against Ukraine.').event_text, /Russia.*Ukraine/);
  assert.match(actionRelation('Russia said its troops launched airstrikes against Ukraine.').event_text, /Russia.*Ukraine/);
  assert.match(actionRelation('Ukraine was struck by Russian missiles.').event_text, /Ukraine.*Russian/);
  assert.match(actionRelation('Russian forces shelled Donetsk.').event_text, /Russian.*Donetsk/);
});

test('an explicitly new actor does not inherit the reporting actor', () => {
  const r = actionRelation('Russia said Israel launched airstrikes against Gaza.');
  assert.ok(!r.event_text.includes('Russia'));
  assert.match(r.event_text, /Israel.*Gaza/);
});

test('simple agreeing reporting subjects survive direct and passive pronominal references', () => {
  for (const text of [
    'Russia said it launched airstrikes against Ukraine.',
    'Russia said that it launched airstrikes against Ukraine.',
    'Ukraine said it was attacked by Russian forces.',
    'Russian forces said they launched airstrikes against Ukraine.',
    'Russian forces said their troops launched airstrikes against Ukraine.',
  ]) {
    const r = actionRelation(text);
    assert.match(r.event_text, /Russia|Russian/, text);
    assert.match(r.event_text, /Ukraine/, text);
    assert.equal(r.speaker_inherited, true, text);
  }
});

test('attribution insertions and reporting relative clauses preserve the main subject', () => {
  for (const text of [
    'Russian forces, officials said, launched airstrikes against Ukraine.',
    'Russian forces, Ukraine said, launched airstrikes against Kyiv.',
    'Russian forces, which Ukraine said had crossed the border, launched airstrikes against Kyiv.',
  ]) {
    const r = actionRelation(text);
    assert.match(r.actor_text, /^Russian forces/, text);
    assert.match(r.event_text, /Ukraine|Kyiv/, text);
    assert.ok(!/officials|which|said/.test(r.event_text), text);
  }
});

test('ambiguous pronouns, nested reports and new named actors cannot inherit an unrelated speaker', () => {
  for (const text of [
    'Russia said Israel launched airstrikes against Gaza.',
    'Russia said Israeli troops launched airstrikes against Gaza.',
    'Russia said they launched airstrikes against Gaza.',
    'Russia and Ukraine said it launched airstrikes against Gaza.',
    'Russia said Israel said it launched airstrikes against Gaza.',
    'Officials in Russia said it launched airstrikes against Gaza.',
  ]) {
    const r = actionRelation(text);
    assert.equal(r.speaker_inherited, false, text);
    assert.ok(!r.event_text.includes('Russia'), text);
  }
});

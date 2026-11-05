import test from 'node:test';
import assert from 'node:assert/strict';
import { assertionFor } from '../lib/assertions.mjs';

const status = (text, kind = 'action', followingSentence = '') => assertionFor(text, { kind, followingSentence }).status;

test('negation and plans govern posture and cooperation as well as actions', () => {
  for (const [text, kind, expected] of [
    ['Russia did not deploy troops to Ukraine.', 'posture', 'negated'],
    ['Russia and Ukraine did not hold talks.', 'cooperation', 'negated'],
    ['Russia never attacked Ukraine.', 'action', 'negated'],
    ['Russia will deploy troops to Ukraine.', 'posture', 'planned'],
    ['Russia and Ukraine plan to hold talks.', 'cooperation', 'planned'],
    ['Russia could launch airstrikes against Ukraine.', 'action', 'planned'],
    ['Russia did not warn Ukraine of retaliation.', 'threat', 'negated'],
    ['Russia deployed troops to Ukraine.', 'posture', 'asserted'],
    ['Russia and Ukraine held talks.', 'cooperation', 'asserted'],
  ]) assert.equal(status(text, kind), expected, text);
});

test('disputed place modifiers do not become disputes of the action assertion', () => {
  assert.equal(status('Russia launched airstrikes against Ukraine, causing damage to a disputed border village.'), 'asserted');
  assert.equal(status('Russia attacked Ukraine near disputed territory.'), 'asserted');
  assert.equal(status('Russia attacked disputed border villages in Ukraine.'), 'asserted');
  assert.equal(status('Russia denied launching airstrikes against Ukraine.'), 'disputed');
  assert.equal(status('Russia disputed reports of airstrikes against Ukraine.'), 'disputed');
  assert.equal(status('Russia claimed it launched airstrikes against Ukraine.'), 'disputed');
});

test('negation or planning of another signal does not suppress an asserted action', () => {
  const mixed = 'Russia launched airstrikes against Ukraine but denied holding talks.';
  assert.equal(status(mixed), 'asserted');
  assert.equal(status(mixed, 'cooperation'), 'disputed');
  const future = 'Russia launched airstrikes against Ukraine and will hold talks tomorrow.';
  assert.equal(status(future), 'asserted');
  assert.equal(status(future, 'cooperation'), 'planned');
  assert.equal(status('Russia did not hold talks but launched airstrikes against Ukraine.'), 'asserted');
  assert.equal(status('Russia denied holding talks after launching airstrikes against Ukraine.'), 'asserted');
});

test('only an adjacent explicit reference can dispute a preceding assertion', () => {
  const text = 'Russia launched airstrikes against Ukraine.';
  assert.equal(status(text, 'action', 'This claim was denied by both governments.'), 'disputed');
  assert.equal(status('Russia launched airstrikes against Ukraine, killing soldiers.', 'action', 'This claim was denied by both governments.'), 'disputed');
  assert.equal(status(text, 'action', 'It was denied by both governments.'), 'disputed');
  assert.equal(status(text, 'action', 'The government denied this claim.'), 'disputed');
  assert.equal(status(text, 'action', 'Russia denied holding talks with Ukraine.'), 'asserted');
  assert.equal(status(text, 'action', 'This meeting was denied by both governments.'), 'asserted');
});

test('generic subsequent denial attaches to the last event kind and retains independent facts', () => {
  const text = 'Russia launched airstrikes against Ukraine; its officials held talks.';
  const next = 'This claim was denied by both governments.';
  assert.equal(status(text, 'action', next), 'asserted');
  assert.equal(status(text, 'cooperation', next), 'disputed');
  const two = assertionFor('Russia attacked Ukraine; Belarus attacked Poland.', { kind: 'action', followingSentence: next });
  assert.equal(two.status, 'asserted');
  assert.deepEqual(two.mentions.map(m => m.status), ['asserted', 'disputed']);
});

test('not only, calendar May and conditional attacks have distinct meanings', () => {
  assert.equal(status('Russia not only attacked Ukraine but also shelled its positions.'), 'asserted');
  assert.equal(status('On May 3 Russia launched airstrikes against Ukraine.'), 'asserted');
  assert.equal(status('Russia would attack Ukraine if its troops were killed.'), 'planned');
});

test('absence of a signal is unknown, and invalid kind is rejected', () => {
  assert.equal(status('Russia and Ukraine held talks.', 'posture'), 'unknown');
  assert.throws(() => assertionFor('A sentence.', { kind: 'anything' }), /Unknown/);
});

test('passive plans, aid restrictions and unverified assertions retain their distinct meanings', () => {
  assert.equal(status('Russia says airstrikes could be launched in Ukraine tomorrow.'), 'planned');
  assert.equal(status('Russia says airstrikes will not be launched in Ukraine tomorrow.'), 'negated');
  assert.equal(status('Russia military aid to Ukraine will not be used to attack.'), 'negated');
  assert.equal(status('Ukraine said Russia could not be independently verified to have launched airstrikes.'), 'disputed');
  // A separate planned negotiation must not make the preceding attack planned.
  assert.equal(status('Russia launched airstrikes against Ukraine and will hold talks tomorrow.'), 'asserted');
});

test('an actual warning is an asserted threat about a planned action', () => {
  const text = 'Russia warned of airstrikes in Ukraine.';
  assert.equal(status(text, 'threat'), 'asserted');
  assert.equal(status(text, 'action'), 'planned');
  assert.equal(status('Russia threatened to attack Ukraine.', 'threat'), 'asserted');
  assert.equal(status('Russia threatened to attack Ukraine.', 'action'), 'planned');
  assert.equal(status('Russia warned Ukraine before launching airstrikes.', 'action'), 'asserted');
});

test('May date variants are calendar mentions while the modal may remains planning', () => {
  for (const date of ['May 3rd', 'May 3, 2025', 'MAY 3', 'May 2025', '3 May', '3rd MAY']) {
    assert.equal(status(`On ${date} Russia launched airstrikes against Ukraine.`), 'asserted', date);
  }
  assert.equal(status('Russia may launch airstrikes against Ukraine.'), 'planned');
});

test('action and posture trigger forms used by the extraction engine have assertion coverage', () => {
  for (const text of [
    'Russia and Ukraine troops exchanged fire in a shoot-out.',
    'Russia and Ukraine troops exchanged fire in a shootout.',
    'Russia captured a village in Ukraine.',
    'Russia captured territory in Ukraine.',
    'Russia launched an offensive against Ukraine.',
    'Russia carried out a drone strike against Ukraine.',
  ]) assert.equal(status(text), 'asserted', text);
  for (const text of [
    'Russia conducted military drills near Ukraine.',
    'Russia continued its troop building near Ukraine.',
    'Russia continued its troop build-up near Ukraine.',
    'Russia mobilised troops near Ukraine.',
    'Russia mobilized troops near Ukraine.',
    'Russia maintained heightened alert near Ukraine.',
  ]) assert.equal(status(text, 'posture'), 'asserted', text);
  assert.equal(status('Russia said Ukraine would pay a price.', 'threat'), 'planned');
  assert.equal(status('Russia issued an ultimatum to Ukraine.', 'threat'), 'asserted');
});

test('passive event nonoccurrence is distinct from an unsuccessful or unprevented event', () => {
  for (const [text, kind] of [
    ['Russia and Ukraine talks were not held.', 'cooperation'],
    ['Russia and Ukraine talks have not been held.', 'cooperation'],
    ['Russia and Ukraine talks never took place.', 'cooperation'],
    ['Russia and Ukraine military exercises were never conducted.', 'posture'],
    ['Russia and Ukraine military exercises have not been conducted.', 'posture'],
    ['Russia airstrikes were not carried out in Ukraine.', 'action'],
  ]) assert.equal(status(text, kind), 'negated', text);
  for (const [text, kind] of [
    ['Russia and Ukraine talks were not successful.', 'cooperation'],
    ['Russia airstrikes were not intercepted in Ukraine.', 'action'],
    ['Russia and Ukraine talks were held despite objections.', 'cooperation'],
  ]) assert.equal(status(text, kind), 'asserted', text);
});

test('scheduled meetings remain planned and diplomatic relations alone are not meetings', () => {
  for (const text of [
    'Russia and Ukraine talks are scheduled for Friday.',
    'Russia and Ukraine talks were planned.',
    'Russia and Ukraine negotiations have been proposed.',
  ]) assert.equal(status(text, 'cooperation'), 'planned', text);
  assert.equal(status('Russia and Ukraine are in a diplomatic crisis.', 'cooperation'), 'unknown');
  assert.equal(status('Russia and Ukraine restored diplomatic relations.', 'cooperation'), 'unknown');
  assert.equal(status('Russia met with Ukraine officials.', 'cooperation'), 'asserted');
  assert.equal(status('Russia and Ukraine held talks.', 'cooperation'), 'asserted');
});

test('reporter restrictions do not negate a separately reported proposition', () => {
  const text = 'An official, speaking anonymously because they were not authorized to speak to the press, said Russian military aircraft struck targets in Ukraine.';
  assert.equal(status(text), 'asserted');
  assert.equal(status('An official who could only speak anonymously said Russia attacked Ukraine.'), 'asserted');
  assert.equal(status('An official said Russia did not attack Ukraine.'), 'negated');
  assert.equal(status('Russia did not say its army attacked Ukraine.'), 'negated');
  assert.equal(status('Russia will say its army attacked Ukraine.'), 'planned');
  assert.equal(status('Russia said its army would attack Ukraine.'), 'planned');
  assert.equal(status('Russia denied it had said its army attacked Ukraine.'), 'disputed');
  assert.equal(status('Russia claimed officials said its army attacked Ukraine.'), 'disputed');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { temporalStatus, stripHistoricalComparison } from '../lib/temporal.mjs';

const status = (text, date = '2025-06-01') => temporalStatus(text, date).status;

test('both English date orders, ordinal dates and month abbreviations share calendar semantics', () => {
  for (const text of ['On January 3, Russia attacked Ukraine.', 'Russia attacked Ukraine on 3 January.', 'On 3rd of Jan., Russia attacked Ukraine.', 'On Jan. 3rd, 2025, Russia attacked Ukraine.', 'On 3 January 2025, Russia attacked Ukraine.', 'On 2025-01-03 Russia attacked Ukraine.']) {
    const result = temporalStatus(text, '2025-06-01');
    assert.equal(result.status, 'historical', text);
    assert.equal(result.references[0].reference_date, '2025-01-03', text);
  }
});

test('adjacent year rollover keeps yesterday current without assigning a verified event date', () => {
  for (const text of ['Russia attacked Ukraine on December 31, 2024.', 'Russia attacked Ukraine on 31 Dec.', 'Russia attacked Ukraine yesterday.']) {
    const result = temporalStatus(text, '2025-01-01');
    assert.equal(result.status, 'current', text);
    assert.equal(result.references[0].reference_date, '2024-12-31', text);
    assert.equal(Object.hasOwn(result, 'event_date'), false);
  }
  assert.equal(status('Russia attacks Ukraine on January 2.', '2024-12-31'), 'future');
  assert.equal(status('Russia attacked Ukraine on December 20, 2024.', '2025-01-01'), 'historical');
});

test('explicit future dates remain future with or without modal verbs', () => {
  for (const text of ['Russia launches airstrikes on June 20.', 'Russia attacks Ukraine on 20 Jun.', 'Russia attacks Ukraine on June 20, 2026.', 'Russia attacks Ukraine tomorrow.', 'Russia attacks Ukraine next week.', 'Russia attacks Ukraine in two days.']) assert.equal(status(text), 'future', text);
  assert.equal(status('Russia attacks Ukraine next December 31.', '2025-01-01'), 'future');
});

test('seven days is current and eight days is historical, including relative offsets', () => {
  assert.equal(status('Russia attacked Ukraine on May 25.'), 'current');
  assert.equal(status('Russia attacked Ukraine on May 24.'), 'historical');
  assert.equal(status('Russia attacked Ukraine seven days ago.'), 'current');
  assert.equal(status('Russia attacked Ukraine a week ago.'), 'current');
  assert.equal(status('Russia attacked Ukraine eight days ago.'), 'historical');
  assert.equal(status('Russia attacked Ukraine two weeks ago.'), 'historical');
  assert.equal(status('Russia attacked Ukraine today.'), 'current');
  for (const text of ['last week', 'last month', 'last year', 'years ago', 'in 2023']) assert.equal(status(`Russia attacked Ukraine ${text}.`), 'historical', text);
});

test('historical comparison clauses do not erase the current event', () => {
  for (const text of ['Russia attacked Ukraine today, the largest attack since 2023.', 'Russia launched its biggest airstrike since 2023 today.']) {
    const result = temporalStatus(text, '2025-06-01');
    assert.equal(result.status, 'current', text);
    assert.equal(result.comparison_ignored, true, text);
  }
  assert.equal(stripHistoricalComparison('Russia first attacked Ukraine in 2023.'), 'Russia first attacked Ukraine in 2023.');
  assert.equal(status('Russia first attacked Ukraine in 2023.'), 'historical');
});

test('mixed temporal statements require review instead of promoting a historical action using today', () => {
  const result = temporalStatus('Today Russia said that it attacked Ukraine in 2023.', '2025-06-01');
  assert.equal(result.status, 'unknown');
  assert.equal(result.mixed, true);
  assert.equal(result.requires_review, true);
  const future = temporalStatus('Today Russia announced an attack on June 20.', '2025-06-01');
  assert.equal(future.status, 'future');
  assert.equal(future.requires_review, true);
});

test('invalid calendar days are never silently normalized and leap days respect the year', () => {
  assert.equal(temporalStatus('Russia attacked Ukraine on February 30, 2025.', '2025-06-01').reason, 'invalid_calendar_reference');
  assert.equal(temporalStatus('Russia attacked Ukraine on February 29, 2025.', '2025-06-01').requires_review, true);
  assert.equal(status('Russia attacked Ukraine on February 29, 2024.', '2024-03-01'), 'current');
  assert.equal(temporalStatus('Russia attacked Ukraine 999999999999 days ago.', '2025-06-01').requires_review, true);
  assert.throws(() => temporalStatus('An attack', '2025-02-30'), /valid/);
});

test('absence of temporal evidence stays unknown and troop counts are not calendar years', () => {
  const result = temporalStatus('Russia sent 2024 troops near Ukraine.', '2025-06-01');
  assert.equal(result.status, 'unknown');
  assert.equal(result.references.length, 0);
  assert.equal(result.requires_review, false);
});

test('month-year references retain month precision and cannot turn a year into a day', () => {
  for (const text of ['In October 2023, Russia launched airstrikes in Ukraine.', 'In Oct. 2023, Russia launched airstrikes in Ukraine.', 'Russia attacked Ukraine during May 2025.']) {
    const result = temporalStatus(text, '2025-06-01');
    assert.equal(result.status, 'historical', text);
    assert.equal(result.references.length, 1, text);
    assert.equal(result.references[0].precision, 'month', text);
    assert.equal(Object.hasOwn(result.references[0], 'reference_date'), false, text);
  }
  assert.equal(temporalStatus('In October 2023, Russia launched airstrikes in Ukraine.', '2025-06-01').references[0].reference_month, '2023-10');
  assert.equal(status('Russia attacks Ukraine in July 2025.'), 'future');
  assert.equal(status('Russia attacks Ukraine in January 2026.'), 'future');
  const currentMonth = temporalStatus('Russia attacks Ukraine in June 2025.', '2025-06-01');
  assert.equal(currentMonth.status, 'unknown');
  assert.equal(currentMonth.requires_review, true);
  // The month-year substring of a complete date must not add a second cue.
  const precise = temporalStatus('Russia attacked Ukraine on 31 May 2025.', '2025-06-01');
  assert.equal(precise.status, 'current');
  assert.equal(precise.references.length, 1);
  assert.equal(precise.references[0].precision, 'day');
});

test('long cumulative casualty totals do not imply a new seven-day event', () => {
  for (const text of [
    'Fifteen weeks have passed; 15 weeks of war between Russia and Ukraine has killed more than 25000 people.',
    'Two weeks of fighting has killed 50 soldiers.',
    'Eight days of war has killed 50 soldiers.',
    'More than 150 have been killed since the war started in October following an attack.',
    'More than 150 soldiers have been killed since October.',
  ]) assert.equal(status(text, '2025-01-26'), 'historical', text);
  const month = temporalStatus('More than 150 soldiers have been killed since October.', '2025-01-26');
  assert.equal(month.references[0].reference_month, '2024-10');
  assert.equal(month.references[0].precision, 'month');
  assert.equal(Object.hasOwn(month.references[0], 'reference_date'), false);
  const unknown = temporalStatus('More than 26000 people have been killed since Russia began its offensive.', '2025-01-26');
  assert.equal(unknown.requires_review, true);
  assert.equal(unknown.reason, 'cumulative_period_not_resolved');
});

test('recent casualty totals and ongoing action are not blanket historical since cases', () => {
  for (const text of [
    'Seven days of fighting has killed 50 soldiers.',
    'One week of war has killed 50 soldiers.',
    'More than 50 have been killed since yesterday.',
    'More than 50 have been killed since seven days ago.',
    'Russia has bombarded Ukraine since yesterday.',
  ]) assert.equal(status(text, '2025-01-26'), 'current', text);
  const ongoing = temporalStatus('Russia continues its bombardment in Ukraine.', '2025-01-26');
  assert.equal(ongoing.requires_review, false);
  const recentMonth = temporalStatus('More than 150 have been killed since December.', '2025-01-03');
  assert.equal(recentMonth.requires_review, true);
  const mixed = temporalStatus('Today officials said two months of war has killed 500 people.', '2025-01-26');
  assert.equal(mixed.requires_review, true);
  assert.equal(mixed.status, 'unknown');
});

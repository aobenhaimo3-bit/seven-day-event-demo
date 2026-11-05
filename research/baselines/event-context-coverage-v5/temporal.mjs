// Temporal cues for conservative reported-event filtering, not event-date truth.
// A reference within the preceding seven days is "current". Inferred years and
// coarse relative references remain explicit in the returned audit metadata.
const DAY = 86400000;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';
const DAY_OF_MONTH = '(\\d{1,2})(?:st|nd|rd|th)?\\b';
const MONTH_FIRST = new RegExp(`\\b(${MONTH})\\s+${DAY_OF_MONTH}(?:,?\\s+(20\\d{2}))?\\b`, 'gi');
const DAY_FIRST = new RegExp(`\\b${DAY_OF_MONTH}\\s+(?:of\\s+)?(${MONTH})(?:,?\\s+(20\\d{2}))?\\b`, 'gi');
const MONTH_YEAR = new RegExp(`\\b(${MONTH})\\s+(20\\d{2})\\b`, 'gi');
const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function dayNumber(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const n = Date.parse(iso + 'T00:00:00Z');
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === iso ? n : null;
}

function statusFor(reference, published) {
  const elapsed = Math.round((published - reference) / DAY);
  return elapsed < 0 ? 'future' : elapsed > 7 ? 'historical' : 'current';
}

/** Remove only explicitly comparative date clauses, retaining the event text. */
export function stripHistoricalComparison(value) {
  return String(value || '')
    .replace(/,\s+(?:the )?(?:largest|biggest|deadliest|first|worst)\b[^.!?;]*\bsince\b[^.!?;]*/gi, '')
    .replace(/(\b(?:largest|biggest|deadliest|first|worst)\s+(?:[\w'-]+\s+){0,3}(?:attacks?|strikes?|airstrikes?|assaults?|offensives?|clashes|incursions?)\b[^.!?;,]{0,60}?)\s+since\s+(?:20\d{2}|last year)\b/gi, '$1');
}

/**
 * status is current | historical | future | unknown.
 * Unknown without references means no temporal evidence; it is not evidence of
 * occurrence. requires_review marks invalid or conflicting references and must
 * not be silently treated as an asserted current event by callers.
 * reference_date is a parsed textual reference, never a verified event_date.
 */
export function temporalStatus(value, publishedDate) {
  const published = dayNumber(publishedDate);
  if (published === null) throw new Error('publishedDate must be a valid YYYY-MM-DD calendar date');
  const original = String(value || '');
  const text = stripHistoricalComparison(original);
  const references = [], occupied = [];
  const publishedYear = Number(publishedDate.slice(0, 4)), publishedMonth = Number(publishedDate.slice(5, 7));
  const overlaps = (start, end) => occupied.some(([a, b]) => start < b && end > a);
  const add = (match, details) => {
    const start = match.index, end = start + match[0].length;
    if (overlaps(start, end)) return;
    occupied.push([start, end]);
    references.push({ text: match[0], ...details });
  };
  const addDate = (match, month, date, explicitYear) => {
    let year = explicitYear ? Number(explicitYear) : publishedYear;
    const prefix = text.slice(Math.max(0, match.index - 16), match.index);
    const futureCue = /\b(?:next|coming|upcoming)\s*$/i.test(prefix);
    const pastCue = /\b(?:last|previous)\s*$/i.test(prefix);
    if (!explicitYear) {
      if (futureCue && (month < publishedMonth || (month === publishedMonth && date < +publishedDate.slice(8)))) year++;
      else if (pastCue && (month > publishedMonth || (month === publishedMonth && date >= +publishedDate.slice(8)))) year--;
      // Restrict implicit rollover to adjacent calendar-year boundary months.
      // June 20 in a June 1 report stays future, rather than becoming last year.
      else if (!futureCue && publishedMonth <= 2 && month >= 11) year--;
      else if (!pastCue && publishedMonth >= 11 && month <= 2) year++;
    }
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
    const n = dayNumber(iso);
    add(match, { kind: 'calendar_date', precision: 'day', reference_date: n === null ? null : iso,
      inferred_year: !explicitYear, status: n === null ? 'unknown' : statusFor(n, published), invalid: n === null });
  };

  for (const m of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) addDate(m, +m[2], +m[3], m[1]);
  for (const m of text.matchAll(MONTH_FIRST)) addDate(m, MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2], m[3]);
  for (const m of text.matchAll(DAY_FIRST)) addDate(m, MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1], m[3]);
  for (const m of text.matchAll(MONTH_YEAR)) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, year = +m[2];
    const monthOrder = year * 12 + month - (publishedYear * 12 + publishedMonth);
    // A month-only reference has no known day. Keep the month precision rather
    // than inventing the first day or partially reading 2023 as day 20.
    add(m, { kind: 'calendar_month', precision: 'month', reference_month: `${year}-${String(month).padStart(2, '0')}`,
      inferred_year: false, status: monthOrder < 0 ? 'historical' : monthOrder > 0 ? 'future' : 'unknown' });
  }

  for (const m of text.matchAll(/\b(today|yesterday|tomorrow|tonight|last night|this morning|this afternoon|this evening)\b/gi)) {
    const cue = m[1].toLowerCase();
    const delta = cue === 'yesterday' || cue === 'last night' ? -1 : cue === 'tomorrow' ? 1 : 0;
    add(m, { kind: 'relative_day', precision: 'day', reference_date: new Date(published + delta * DAY).toISOString().slice(0, 10), inferred_year: false, status: delta > 0 ? 'future' : 'current' });
  }
  for (const m of text.matchAll(/\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(days?|weeks?|months?|years?)\s+ago\b/gi)) {
    const count = NUMBER_WORDS[m[1].toLowerCase()] ?? Number(m[1]);
    const unit = m[2].toLowerCase();
    if (/^(?:month|year)/.test(unit)) {
      add(m, { kind: 'relative_period', precision: 'coarse', status: count > 0 ? 'historical' : 'unknown' });
    } else {
      const days = count * (unit.startsWith('week') ? 7 : 1);
      const reference = new Date(published - days * DAY);
      const valid = Number.isFinite(reference.getTime());
      add(m, { kind: 'relative_day', precision: 'day', reference_date: valid ? reference.toISOString().slice(0, 10) : null, inferred_year: false,
        status: valid ? days > 7 ? 'historical' : 'current' : 'unknown', invalid: !valid });
    }
  }
  for (const m of text.matchAll(/\b(?:last (?:week|month|year)|earlier this (?:month|year)|(?:weeks?|months?|years?) ago|anniversary|remembering|recalled|back in)\b/gi)) {
    // These coarse historical expressions deliberately do not invent an exact
    // day. "A week ago" above has an exact seven-day offset; "last week" does not.
    add(m, { kind: 'historical_expression', precision: 'coarse', status: 'historical' });
  }
  for (const m of text.matchAll(/\b(?:next (?:week|month|year)|in (?:\d+|one|two|three|four|five|six|seven) (?:days?|weeks?|months?|years?))\b/gi)) add(m, { kind: 'future_expression', precision: 'coarse', status: 'future' });
  for (const m of text.matchAll(/\b(?:in|during|since|from|through|year)\s+(20\d{2})\b|\b(20\d{2})(?=:)/gi)) {
    const year = Number(m[1] || m[2]);
    add(m, { kind: 'calendar_year', precision: 'year', year, status: year < publishedYear ? 'historical' : year > publishedYear ? 'future' : 'unknown' });
  }
  const statuses = new Set(references.map(r => r.status).filter(s => s !== 'unknown'));
  const invalid = references.some(r => r.invalid);
  const mixed = statuses.size > 1;
  const status = statuses.has('future') ? 'future' : mixed || invalid ? 'unknown' : [...statuses][0] || 'unknown';
  return { status, reason: invalid ? 'invalid_calendar_reference' : mixed ? 'conflicting_temporal_references' : references.length ? 'explicit_temporal_reference' : 'no_temporal_reference',
    references, comparison_ignored: text !== original, mixed, requires_review: invalid || mixed || (references.length > 0 && status === 'unknown') };
}

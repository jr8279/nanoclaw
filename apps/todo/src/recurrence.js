/**
 * Compute the next due date for a recurring task, anchored on the previous
 * due date. `fromIso` must always be provided — the caller guarantees a
 * recurring task always has a due_date (enforced at the API layer), so
 * there's no "anchor on now" fallback here to silently mask that invariant.
 */
export function nextDueDate(fromIso, freq, interval) {
  const from = new Date(fromIso);
  const n = Math.max(1, interval || 1);
  switch (freq) {
    case 'daily':
      return addDays(from, n);
    case 'weekly':
      return addDays(from, 7 * n);
    case 'monthly':
      return addMonthsClamped(from, n);
    case 'yearly':
      return addMonthsClamped(from, 12 * n);
    default:
      return null;
  }
}

function addDays(from, days) {
  const next = new Date(from);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}

// setUTCMonth overflows past short months (Jan 31 + 1 month -> Mar 3, not
// Feb 28), which silently corrupts due dates for any task anchored on the
// 29th-31st. Clamp to the last real day of the target month instead.
function addMonthsClamped(from, months) {
  const day = from.getUTCDate();
  const next = new Date(from);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
  ).getUTCDate();
  next.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  next.setUTCHours(from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds());
  return next.toISOString();
}

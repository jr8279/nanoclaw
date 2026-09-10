/** Compute the next due date for a recurring task, anchored on the previous due date. */
export function nextDueDate(fromIso, freq, interval) {
  const from = fromIso ? new Date(fromIso) : new Date();
  const next = new Date(from);
  const n = Math.max(1, interval || 1);
  switch (freq) {
    case 'daily':
      next.setUTCDate(next.getUTCDate() + n);
      break;
    case 'weekly':
      next.setUTCDate(next.getUTCDate() + 7 * n);
      break;
    case 'monthly':
      next.setUTCMonth(next.getUTCMonth() + n);
      break;
    case 'yearly':
      next.setUTCFullYear(next.getUTCFullYear() + n);
      break;
    default:
      return null;
  }
  return next.toISOString();
}

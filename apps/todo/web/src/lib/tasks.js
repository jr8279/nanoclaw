// Pure task-list logic: sorting, grouping, due-date formatting, and the
// link-textarea parser. Ported from the vanilla app.js — kept dependency
// free (no React) so it's directly unit-testable.

export const IMPORTANCE_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };
export const IMPORTANCE_LABEL = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };

export function fmtDue(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function isOverdue(task) {
  return task.status === 'pending' && task.due_date && new Date(task.due_date) < new Date();
}

export function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function sortTasks(tasks, sortBy) {
  const arr = [...tasks];
  const byDue = (a, b) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return new Date(a.due_date) - new Date(b.due_date);
  };
  if (sortBy === 'priority') {
    arr.sort((a, b) => IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance] || byDue(a, b));
  } else if (sortBy === 'title') {
    arr.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  } else if (sortBy === 'created') {
    arr.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } else {
    arr.sort(byDue);
  }
  return arr;
}

export function groupTasks(tasks, groupBy, categories) {
  if (groupBy === 'priority') {
    const order = ['urgent', 'high', 'medium', 'low'];
    return order
      .map((key) => ({ key, label: IMPORTANCE_LABEL[key], dot: null, tasks: tasks.filter((t) => t.importance === key) }))
      .filter((g) => g.tasks.length);
  }
  if (groupBy === 'category') {
    const groups = categories.map((c) => ({
      key: String(c.id),
      label: c.name,
      dot: c.color,
      tasks: tasks.filter((t) => t.category_id === c.id),
    }));
    const uncategorized = tasks.filter((t) => t.category_id == null);
    if (uncategorized.length) groups.push({ key: 'none', label: 'No category', dot: null, tasks: uncategorized });
    return groups.filter((g) => g.tasks.length);
  }
  return null;
}

const LINK_URL_RE = /^https?:\/\/\S+$/i;

// Only a token that actually looks like a URL is accepted as one — a line
// with no http(s) URL in it is dropped rather than guessed at (the old
// behavior invented a link from whatever word happened to be last).
export function parseLinks(text) {
  const links = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const url = parts.find((p) => LINK_URL_RE.test(p));
    if (!url) continue;
    const label = line.replace(url, '').trim() || null;
    links.push({ url, label });
  }
  return links;
}

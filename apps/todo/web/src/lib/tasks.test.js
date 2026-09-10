import { describe, expect, test } from 'vitest';
import { groupTasks, parseLinks, sortTasks } from './tasks.js';

describe('parseLinks', () => {
  test('drops a line with no http(s) URL instead of inventing one from the last word', () => {
    expect(parseLinks('Just some notes with no url at all')).toEqual([]);
  });

  test('keeps a line that does have a URL, with the rest as its label', () => {
    expect(parseLinks('School portal https://example.com')).toEqual([
      { url: 'https://example.com', label: 'School portal' },
    ]);
  });

  test('ignores blank lines', () => {
    expect(parseLinks('\n\n  \n')).toEqual([]);
  });

  test('accepts a bare URL with no label', () => {
    expect(parseLinks('https://example.com')).toEqual([{ url: 'https://example.com', label: null }]);
  });

  test('parses multiple lines independently', () => {
    expect(parseLinks('Portal https://a.example\nno url here\nDocs https://b.example')).toEqual([
      { url: 'https://a.example', label: 'Portal' },
      { url: 'https://b.example', label: 'Docs' },
    ]);
  });
});

describe('sortTasks', () => {
  const tasks = [
    { id: 1, title: 'Banana', importance: 'low', due_date: '2026-01-03T00:00:00.000Z', created_at: '2026-01-01T00:00:00.000Z' },
    { id: 2, title: 'apple', importance: 'urgent', due_date: null, created_at: '2026-01-03T00:00:00.000Z' },
    { id: 3, title: 'Cherry', importance: 'medium', due_date: '2026-01-01T00:00:00.000Z', created_at: '2026-01-02T00:00:00.000Z' },
  ];

  test('by due date, tasks without a due date sort last', () => {
    expect(sortTasks(tasks, 'due').map((t) => t.id)).toEqual([3, 1, 2]);
  });

  test('by priority rank, tied priorities break by due date', () => {
    expect(sortTasks(tasks, 'priority').map((t) => t.id)).toEqual([2, 3, 1]);
  });

  test('by title, case-insensitive', () => {
    expect(sortTasks(tasks, 'title').map((t) => t.id)).toEqual([2, 1, 3]);
  });

  test('by created, most recent first', () => {
    expect(sortTasks(tasks, 'created').map((t) => t.id)).toEqual([2, 3, 1]);
  });

  test('does not mutate the input array', () => {
    const copy = [...tasks];
    sortTasks(tasks, 'title');
    expect(tasks).toEqual(copy);
  });
});

describe('groupTasks', () => {
  const categories = [
    { id: 1, name: 'Home', color: '#111' },
    { id: 2, name: 'Work', color: '#222' },
  ];
  const tasks = [
    { id: 1, importance: 'urgent', category_id: 1 },
    { id: 2, importance: 'low', category_id: 2 },
    { id: 3, importance: 'urgent', category_id: null },
  ];

  test('groups by priority, only non-empty buckets, in urgent-first order', () => {
    const groups = groupTasks(tasks, 'priority', categories);
    expect(groups.map((g) => g.key)).toEqual(['urgent', 'low']);
    expect(groups[0].tasks.map((t) => t.id)).toEqual([1, 3]);
  });

  test('groups by category, with an uncategorized bucket appended', () => {
    const groups = groupTasks(tasks, 'category', categories);
    expect(groups.map((g) => g.label)).toEqual(['Home', 'Work', 'No category']);
  });

  test('returns null (no grouping) for "none"', () => {
    expect(groupTasks(tasks, 'none', categories)).toBeNull();
  });
});

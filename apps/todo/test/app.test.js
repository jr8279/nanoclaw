// Zero extra deps: node's built-in test runner + a real HTTP server per
// test, driven with fetch. Run with `node --test test/app.test.js`.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-test-'));
process.env.TODO_DATA_DIR = dataDir;

const { createApp } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { nextDueDate } = await import('../src/recurrence.js');

let server;
let baseUrl;

before(async () => {
  const app = createApp({ apiKey: '' });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec('DELETE FROM links; DELETE FROM tasks; DELETE FROM categories;');
  const insert = db.prepare('INSERT INTO categories (id, name, color, created_at) VALUES (?, ?, ?, ?)');
  insert.run(1, 'Home', '#22c55e', new Date().toISOString());
  insert.run(2, 'Office', '#6366f1', new Date().toISOString());
});

async function api(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

// --- category_id foreign-key bug (QA finding #1) --------------------------

test('creating a task with a nonexistent category_id returns 400, not a 500 stack trace', async () => {
  const { status, body } = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Bad category', category_id: 9999 }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /category_id/);
});

test('patching a task with a nonexistent category_id returns 400', async () => {
  const created = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'T' }) });
  const { status, body } = await api(`/api/tasks/${created.body.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ category_id: 9999 }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /category_id/);
});

test('creating a task with a valid category_id still works', async () => {
  const { status, body } = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Good category', category_id: 1 }),
  });
  assert.equal(status, 201);
  assert.equal(body.category_id, 1);
});

// --- monthly/yearly recurrence rollover (architecture + QA finding) -------

test('nextDueDate clamps Jan 31 + 1 month to Feb 28 (non-leap year), not Mar 3', () => {
  const next = nextDueDate('2026-01-31T12:00:00.000Z', 'monthly', 1);
  assert.equal(next.slice(0, 10), '2026-02-28');
});

test('nextDueDate clamps Jan 31 + 1 month to Feb 29 in a leap year', () => {
  const next = nextDueDate('2028-01-31T12:00:00.000Z', 'monthly', 1);
  assert.equal(next.slice(0, 10), '2028-02-29');
});

test('nextDueDate preserves time-of-day across a monthly rollover', () => {
  const next = nextDueDate('2026-01-31T18:30:00.000Z', 'monthly', 1);
  assert.equal(next, '2026-02-28T18:30:00.000Z');
});

test('completing a monthly-recurring task anchored on the 31st spawns Feb 28, not Mar 3', async () => {
  const created = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Pay rent',
      due_date: '2026-01-31T00:00:00.000Z',
      recurrence: { freq: 'monthly', interval: 1 },
    }),
  });
  const { body } = await api(`/api/tasks/${created.body.id}/complete`, { method: 'POST' });
  assert.equal(body.next.due_date.slice(0, 10), '2026-02-28');
});

// --- recurrence requires a due_date (architecture finding) -----------------

test('creating a recurring task with no due_date is rejected, not silently anchored on "now"', async () => {
  const { status, body } = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'No anchor', recurrence: { freq: 'weekly', interval: 1 } }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /due_date/);
});

test('clearing due_date on a recurring task via PATCH is rejected', async () => {
  const created = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Weekly thing',
      due_date: '2026-09-10T00:00:00.000Z',
      recurrence: { freq: 'weekly', interval: 1 },
    }),
  });
  const { status, body } = await api(`/api/tasks/${created.body.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ due_date: null }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /due_date/);
});

// --- link URL scheme validation (security finding) -------------------------

test('a javascript: URI is rejected when creating a task with links', async () => {
  const { status, body } = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Evil link', links: [{ url: 'javascript:alert(1)', label: 'click me' }] }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /url/);
});

test('a data: URI is rejected on the standalone link-add endpoint', async () => {
  const created = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ title: 'T' }) });
  const { status } = await api(`/api/tasks/${created.body.id}/links`, {
    method: 'POST',
    body: JSON.stringify({ url: 'data:text/html,<script>alert(1)</script>' }),
  });
  assert.equal(status, 400);
});

test('http/https/mailto links are accepted', async () => {
  const { status, body } = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Good links',
      links: [
        { url: 'https://example.com', label: 'site' },
        { url: 'mailto:a@b.com', label: 'email' },
      ],
    }),
  });
  assert.equal(status, 201);
  assert.equal(body.links.length, 2);
});

// --- importance validation --------------------------------------------------

test('an invalid importance value is rejected rather than silently coerced', async () => {
  const { status, body } = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'T', importance: 'critical' }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /importance/);
});

// --- due_date format validation ---------------------------------------------

test('a garbage due_date string is rejected', async () => {
  const { status, body } = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'T', due_date: 'not-a-date' }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /due_date/);
});

// --- malformed JSON no longer leaks a stack trace (QA finding) -------------

test('malformed JSON body returns a clean 400 JSON error, not an HTML stack trace', async () => {
  const res = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not valid json',
  });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('content-type').includes('application/json'), true);
});

// --- /api/health stays reachable without auth -------------------------------

test('/api/health is open even when an API key is configured', async () => {
  const keyedApp = createApp({ apiKey: 'secret' });
  const keyedServer = keyedApp.listen(0);
  await new Promise((resolve) => keyedServer.once('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${keyedServer.address().port}/api/health`);
    assert.equal(res.status, 200);
  } finally {
    await new Promise((resolve) => keyedServer.close(resolve));
  }
});

// --- existing correctness, still green after the refactor ------------------

test('weekly recurrence anchors on the original due date, not "now"', async () => {
  const created = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Weekly',
      due_date: '2026-09-10T12:00:00.000Z',
      recurrence: { freq: 'weekly', interval: 1 },
    }),
  });
  const { body } = await api(`/api/tasks/${created.body.id}/complete`, { method: 'POST' });
  assert.equal(body.next.due_date, '2026-09-17T12:00:00.000Z');
});

test('deleting a task cascades to its links', async () => {
  const created = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'T', links: [{ url: 'https://example.com' }] }),
  });
  await api(`/api/tasks/${created.body.id}`, { method: 'DELETE' });
  const remaining = db.prepare('SELECT COUNT(*) AS n FROM links WHERE task_id = ?').get(created.body.id);
  assert.equal(remaining.n, 0);
});

test('duplicate category name returns 409', async () => {
  const { status } = await api('/api/categories', {
    method: 'POST',
    body: JSON.stringify({ name: 'Home' }),
  });
  assert.equal(status, 409);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/migrations/index.js';

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-migrate-'));
  return { db: new Database(path.join(dir, 'todo.db')), dir };
}

test('running migrations on a fresh DB creates all tables and seeds categories', () => {
  const { db, dir } = tmpDb();
  try {
    runMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => r.name);
    for (const expected of [
      'categories',
      'tasks',
      'links',
      'users',
      'passkey_credentials',
      'sessions',
      'invites',
      'task_assignees',
    ]) {
      assert.ok(tables.includes(expected), `expected table ${expected}`);
    }
    const categoryCount = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
    assert.equal(categoryCount, 3);
    const columns = db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
    assert.ok(columns.includes('owner_user_id'));
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('running migrations twice is a no-op the second time (idempotent)', () => {
  const { db, dir } = tmpDb();
  try {
    runMigrations(db);
    const categoryCountAfterFirst = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
    runMigrations(db);
    const categoryCountAfterSecond = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
    assert.equal(categoryCountAfterFirst, categoryCountAfterSecond, 'categories should not be reseeded');
    const migrationRows = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n;
    assert.equal(migrationRows, 2);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('upgrading a pre-multi-user DB (only the 001 schema, no owner_user_id) preserves existing tasks', () => {
  const { db, dir } = tmpDb();
  try {
    // Simulate a real install that only ever ran migration 001 — the
    // pre-multi-user shape this app has actually been deployed with.
    db.exec(`
      CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, notes TEXT, category_id INTEGER,
        importance TEXT NOT NULL DEFAULT 'medium', due_date TEXT, status TEXT NOT NULL DEFAULT 'pending',
        recurrence_freq TEXT, recurrence_interval INTEGER NOT NULL DEFAULT 1, recurrence_parent_id INTEGER,
        completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE links (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, url TEXT NOT NULL, label TEXT, created_at TEXT NOT NULL);
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations (name, applied_at) VALUES ('001-initial', '2026-01-01T00:00:00.000Z');
      INSERT INTO categories (name, color, created_at) VALUES ('Home', '#22c55e', '2026-01-01T00:00:00.000Z');
    `);
    const ts = new Date().toISOString();
    db.prepare(
      "INSERT INTO tasks (title, status, importance, created_at, updated_at) VALUES ('Pre-existing task', 'pending', 'medium', ?, ?)",
    ).run(ts, ts);

    runMigrations(db);

    const task = db.prepare('SELECT * FROM tasks WHERE title = ?').get('Pre-existing task');
    assert.ok(task, 'pre-existing task should survive the migration');
    assert.equal(task.owner_user_id, null, 'legacy task should have a NULL (unclaimed) owner, not be dropped');

    const columns = db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
    assert.ok(columns.includes('owner_user_id'));
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

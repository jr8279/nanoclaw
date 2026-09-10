import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.TODO_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'todo.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6366f1',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  notes TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  importance TEXT NOT NULL DEFAULT 'medium' CHECK (importance IN ('low','medium','high','urgent')),
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','archived')),
  recurrence_freq TEXT CHECK (recurrence_freq IN ('daily','weekly','monthly','yearly') OR recurrence_freq IS NULL),
  recurrence_interval INTEGER NOT NULL DEFAULT 1,
  recurrence_parent_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category_id);
CREATE INDEX IF NOT EXISTS idx_links_task ON links(task_id);
`);

// Seed default categories on first run.
const categoryCount = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
if (categoryCount === 0) {
  const insert = db.prepare(
    'INSERT INTO categories (name, color, created_at) VALUES (?, ?, ?)',
  );
  const now = new Date().toISOString();
  const seed = db.transaction((rows) => {
    for (const [name, color] of rows) insert.run(name, color, now);
  });
  seed([
    ['Home', '#22c55e'],
    ['Office', '#6366f1'],
    ['Kids School', '#f59e0b'],
  ]);
}

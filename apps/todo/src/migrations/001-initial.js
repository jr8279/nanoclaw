export const name = '001-initial';

export function up(db) {
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

  const categoryCount = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  if (categoryCount === 0) {
    const insert = db.prepare('INSERT INTO categories (name, color, created_at) VALUES (?, ?, ?)');
    const now = new Date().toISOString();
    for (const [catName, color] of [
      ['Home', '#22c55e'],
      ['Office', '#6366f1'],
      ['Kids School', '#f59e0b'],
    ]) {
      insert.run(catName, color, now);
    }
  }
}

import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { db } from './db.js';
import { nextDueDate } from './recurrence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ALLOWED_LINK_SCHEMES = ['http:', 'https:', 'mailto:'];
const VALID_IMPORTANCE = ['low', 'medium', 'high', 'urgent'];
const VALID_FREQ = ['daily', 'weekly', 'monthly', 'yearly'];

function isValidLinkUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  try {
    return ALLOWED_LINK_SCHEMES.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function isValidIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Compare against itself so the failure path still takes constant time
    // relative to a same-length comparison, rather than short-circuiting.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Build the todo Express app. `apiKey` gates every /api route except
 * /api/health (left open for liveness probes/monitoring).
 */
export function createApp({ apiKey = '' } = {}) {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // --- auth -------------------------------------------------------------
  // If apiKey is set, every other /api request (from the PWA or the MCP
  // tool) must carry it via X-API-Key. Leave unset only for a fully
  // trusted LAN.
  app.use('/api', (req, res, next) => {
    if (!apiKey) return next();
    if (timingSafeEqual(req.get('X-API-Key') || '', apiKey)) return next();
    res.status(401).json({ error: 'unauthorized' });
  });

  function now() {
    return new Date().toISOString();
  }

  function serializeTask(row) {
    if (!row) return row;
    const links = db
      .prepare('SELECT id, url, label, created_at FROM links WHERE task_id = ? ORDER BY id')
      .all(row.id);
    return {
      id: row.id,
      title: row.title,
      notes: row.notes,
      category_id: row.category_id,
      importance: row.importance,
      due_date: row.due_date,
      status: row.status,
      recurrence: row.recurrence_freq
        ? { freq: row.recurrence_freq, interval: row.recurrence_interval }
        : null,
      recurrence_parent_id: row.recurrence_parent_id,
      completed_at: row.completed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      links,
    };
  }

  /**
   * Validate the fields shared by create/update. `dueDate`/`recurrenceFreq`
   * are the *effective* values (existing value if not being changed), so the
   * recurrence-needs-a-due-date rule is checked correctly on partial patches.
   * Returns an error string or null.
   */
  function validateTaskFields({ importance, due_date, dueDate, recurrenceFreq, links }) {
    if (importance !== undefined && !VALID_IMPORTANCE.includes(importance)) {
      return `importance must be one of: ${VALID_IMPORTANCE.join(', ')}`;
    }
    if (due_date !== undefined && due_date !== null && !isValidIsoDate(due_date)) {
      return 'due_date must be a valid ISO-8601 timestamp';
    }
    if (recurrenceFreq && !dueDate) {
      return 'recurrence requires a due_date to anchor future occurrences';
    }
    if (Array.isArray(links)) {
      for (const link of links) {
        if (link?.url && !isValidLinkUrl(link.url)) {
          return `link url must start with http://, https:// or mailto: (got "${link.url}")`;
        }
      }
    }
    return null;
  }

  // --- categories ---------------------------------------------------------

  app.get('/api/categories', (req, res) => {
    const rows = db.prepare('SELECT * FROM categories ORDER BY name').all();
    res.json(rows);
  });

  app.post('/api/categories', (req, res) => {
    const { name, color } = req.body || {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    try {
      const info = db
        .prepare('INSERT INTO categories (name, color, created_at) VALUES (?, ?, ?)')
        .run(name.trim(), color || '#6366f1', now());
      res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid));
    } catch {
      res.status(409).json({ error: 'category already exists' });
    }
  });

  app.patch('/api/categories/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not found' });
    const { name, color } = req.body || {};
    db.prepare('UPDATE categories SET name = ?, color = ? WHERE id = ?').run(
      name ?? existing.name,
      color ?? existing.color,
      req.params.id,
    );
    res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
  });

  app.delete('/api/categories/:id', (req, res) => {
    db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
    res.status(204).end();
  });

  // --- tasks ----------------------------------------------------------------

  app.get('/api/tasks', (req, res) => {
    const { status, category_id, importance, due_before, due_after, q } = req.query;
    const clauses = [];
    const params = [];

    if (status && status !== 'all') {
      clauses.push('status = ?');
      params.push(status);
    } else if (!status) {
      clauses.push("status != 'archived'");
    }
    if (category_id) {
      clauses.push('category_id = ?');
      params.push(category_id);
    }
    if (importance) {
      clauses.push('importance = ?');
      params.push(importance);
    }
    if (due_before) {
      clauses.push('due_date IS NOT NULL AND due_date <= ?');
      params.push(due_before);
    }
    if (due_after) {
      clauses.push('due_date IS NOT NULL AND due_date >= ?');
      params.push(due_after);
    }
    if (q) {
      clauses.push('(title LIKE ? OR notes LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT * FROM tasks ${where} ORDER BY
          CASE status WHEN 'pending' THEN 0 ELSE 1 END,
          CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
          due_date ASC,
          CASE importance WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
      )
      .all(...params);
    res.json(rows.map(serializeTask));
  });

  app.get('/api/tasks/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(serializeTask(row));
  });

  app.post('/api/tasks', (req, res) => {
    const {
      title,
      notes,
      category_id,
      importance,
      due_date,
      recurrence, // { freq: 'daily'|'weekly'|'monthly'|'yearly', interval?: number }
      links,
    } = req.body || {};

    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'title is required' });
    }
    if (recurrence && !VALID_FREQ.includes(recurrence.freq)) {
      return res.status(400).json({ error: `recurrence.freq must be one of: ${VALID_FREQ.join(', ')}` });
    }
    const fieldError = validateTaskFields({
      importance,
      due_date,
      dueDate: due_date,
      recurrenceFreq: recurrence?.freq,
      links,
    });
    if (fieldError) return res.status(400).json({ error: fieldError });

    if (category_id) {
      const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(category_id);
      if (!category) return res.status(400).json({ error: 'category_id does not exist' });
    }

    const ts = now();
    const info = db
      .prepare(
        `INSERT INTO tasks
          (title, notes, category_id, importance, due_date, status,
           recurrence_freq, recurrence_interval, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      )
      .run(
        title.trim(),
        notes || null,
        category_id || null,
        importance || 'medium',
        due_date || null,
        recurrence?.freq || null,
        recurrence?.interval || 1,
        ts,
        ts,
      );

    const taskId = info.lastInsertRowid;
    if (Array.isArray(links)) {
      const insertLink = db.prepare(
        'INSERT INTO links (task_id, url, label, created_at) VALUES (?, ?, ?, ?)',
      );
      for (const link of links) {
        if (link?.url) insertLink.run(taskId, link.url, link.label || null, ts);
      }
    }

    res.status(201).json(serializeTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId)));
  });

  app.patch('/api/tasks/:id', (req, res) => {
    const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not found' });

    const { title, notes, category_id, importance, due_date, status, recurrence } = req.body || {};
    if (recurrence && !VALID_FREQ.includes(recurrence.freq)) {
      return res.status(400).json({ error: `recurrence.freq must be one of: ${VALID_FREQ.join(', ')}` });
    }
    const effectiveDueDate = due_date !== undefined ? due_date : existing.due_date;
    const effectiveRecurrenceFreq = recurrence !== undefined ? recurrence?.freq || null : existing.recurrence_freq;
    const fieldError = validateTaskFields({
      importance,
      due_date,
      dueDate: effectiveDueDate,
      recurrenceFreq: effectiveRecurrenceFreq,
    });
    if (fieldError) return res.status(400).json({ error: fieldError });

    if (category_id !== undefined && category_id !== null) {
      const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(category_id);
      if (!category) return res.status(400).json({ error: 'category_id does not exist' });
    }

    db.prepare(
      `UPDATE tasks SET
        title = ?, notes = ?, category_id = ?, importance = ?, due_date = ?, status = ?,
        recurrence_freq = ?, recurrence_interval = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      title ?? existing.title,
      notes !== undefined ? notes : existing.notes,
      category_id !== undefined ? category_id : existing.category_id,
      importance ?? existing.importance,
      effectiveDueDate,
      status ?? existing.status,
      recurrence !== undefined ? recurrence?.freq || null : existing.recurrence_freq,
      recurrence !== undefined ? recurrence?.interval || 1 : existing.recurrence_interval,
      now(),
      req.params.id,
    );
    res.json(serializeTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)));
  });

  app.delete('/api/tasks/:id', (req, res) => {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    res.status(204).end();
  });

  // Complete a task. If it recurs, spawn the next pending instance.
  app.post('/api/tasks/:id/complete', (req, res) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'not found' });

    const ts = now();
    db.prepare("UPDATE tasks SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?").run(
      ts,
      ts,
      task.id,
    );

    let nextTask = null;
    if (task.recurrence_freq) {
      // due_date is guaranteed non-null: recurrence can only be set alongside
      // a due_date (enforced on create/update), so there's always an anchor.
      const nextDue = nextDueDate(task.due_date, task.recurrence_freq, task.recurrence_interval);
      const info = db
        .prepare(
          `INSERT INTO tasks
            (title, notes, category_id, importance, due_date, status,
             recurrence_freq, recurrence_interval, recurrence_parent_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
        )
        .run(
          task.title,
          task.notes,
          task.category_id,
          task.importance,
          nextDue,
          task.recurrence_freq,
          task.recurrence_interval,
          task.recurrence_parent_id || task.id,
          ts,
          ts,
        );
      nextTask = serializeTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid));
    }

    res.json({
      task: serializeTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)),
      next: nextTask,
    });
  });

  app.post('/api/tasks/:id/reopen', (req, res) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'not found' });
    db.prepare("UPDATE tasks SET status = 'pending', completed_at = NULL, updated_at = ? WHERE id = ?").run(
      now(),
      task.id,
    );
    res.json(serializeTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)));
  });

  // --- links ------------------------------------------------------------

  app.post('/api/tasks/:id/links', (req, res) => {
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'not found' });
    const { url, label } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url is required' });
    if (!isValidLinkUrl(url)) {
      return res.status(400).json({ error: 'url must start with http://, https:// or mailto:' });
    }
    const info = db
      .prepare('INSERT INTO links (task_id, url, label, created_at) VALUES (?, ?, ?, ?)')
      .run(task.id, url, label || null, now());
    res.status(201).json(db.prepare('SELECT * FROM links WHERE id = ?').get(info.lastInsertRowid));
  });

  app.delete('/api/links/:id', (req, res) => {
    db.prepare('DELETE FROM links WHERE id = ?').run(req.params.id);
    res.status(204).end();
  });

  // --- static PWA -------------------------------------------------------

  app.use(express.static(path.join(__dirname, '..', 'public')));

  // JSON error handler — catches express.json() parse errors, DB constraint
  // errors we didn't pre-validate, and anything else, so a client never sees
  // a raw HTML stack trace. Must be registered last (4-arg signature).
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[TODO] Unhandled error:', err.message);
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'request body too large' });
    }
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ error: 'malformed JSON body' });
    }
    if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return res.status(400).json({ error: 'referenced record does not exist' });
    }
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}

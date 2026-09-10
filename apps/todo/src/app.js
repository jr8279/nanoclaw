import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { db } from './db.js';
import { nextDueDate } from './recurrence.js';
import {
  attachAuthMiddleware,
  requireAuth,
  requireAdmin,
  createSession,
  deleteSession,
  setSessionCookie,
  clearSessionCookie,
  bootstrapAvailable,
  createInvite,
  peekInvite,
  consumeInvite,
  startRegistration,
  finishRegistration,
  startAuthentication,
  finishAuthentication,
  SESSION_TTL_MS,
} from './auth.js';

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

function publicUser(row) {
  if (!row) return null;
  return { id: row.id, display_name: row.display_name, is_admin: !!row.is_admin };
}

/**
 * Build the todo Express app.
 *
 * Two credential types can reach the task/category/user API:
 *  - a signed-in session (passkey login) — scoped to that person's board
 *    (tasks they own, are assigned to, or that predate multi-user support)
 *  - the service `apiKey` (used by the nanoclaw MCP tool) — unscoped, but
 *    must say which household member a new task belongs to (`owner_id`)
 *    since it isn't acting as any one person.
 *
 * `/api/health` and the passkey/invite ceremony endpoints are open — you
 * can't require login to log in.
 */
export function createApp({ apiKey = '' } = {}) {
  const app = express();
  app.use(express.json());
  app.use(attachAuthMiddleware(db));

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  function now() {
    return new Date().toISOString();
  }

  // Accepts a signed-in session OR the service API key. Sets req.isService
  // when the API key was used, so route handlers can tell the two apart.
  function authOrService(req, res, next) {
    if (req.user) return next();
    if (apiKey && timingSafeEqual(req.get('X-API-Key') || '', apiKey)) {
      req.isService = true;
      return next();
    }
    res.status(401).json({ error: 'unauthorized' });
  }

  // --- auth: passkeys, invites, sessions -----------------------------------

  app.get('/api/auth/me', (req, res) => {
    res.json({ user: publicUser(req.user), bootstrap_available: bootstrapAvailable(db) });
  });

  app.post('/api/auth/logout', (req, res) => {
    if (req.sessionToken) deleteSession(db, req.sessionToken);
    clearSessionCookie(res);
    res.status(204).end();
  });

  // Start registering a passkey — three ways in: the one-time bootstrap
  // (first account ever, becomes admin), redeeming an invite (new account),
  // or adding a second device while already signed in.
  app.post('/api/auth/register/options', async (req, res) => {
    const { inviteToken, displayName } = req.body || {};
    try {
      if (req.user) {
        const { options, challengeId } = await startRegistration(db, { existingUser: req.user });
        return res.json({ options, challengeId });
      }
      if (inviteToken) {
        const invite = peekInvite(db, inviteToken);
        if (!invite) return res.status(400).json({ error: 'invite is invalid, used, or expired' });
        if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
          return res.status(400).json({ error: 'displayName is required' });
        }
        const { options, challengeId } = await startRegistration(db, {
          existingUser: null,
          newDisplayName: displayName.trim(),
        });
        return res.json({ options, challengeId, inviteToken });
      }
      if (bootstrapAvailable(db)) {
        if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
          return res.status(400).json({ error: 'displayName is required' });
        }
        const { options, challengeId } = await startRegistration(db, {
          existingUser: null,
          newDisplayName: displayName.trim(),
        });
        return res.json({ options, challengeId, bootstrap: true });
      }
      res.status(403).json({ error: 'an invite is required to create an account' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/auth/register/verify', async (req, res) => {
    const { challengeId, response, inviteToken, bootstrap } = req.body || {};
    if (!challengeId || !response) return res.status(400).json({ error: 'challengeId and response are required' });
    try {
      // Re-validate the invite/bootstrap precondition at verify time too —
      // options and verify are two separate requests, and the world (e.g.
      // someone else claiming the last bootstrap slot) can change between them.
      if (!req.user) {
        if (inviteToken && !peekInvite(db, inviteToken)) {
          return res.status(400).json({ error: 'invite is invalid, used, or expired' });
        }
        if (bootstrap && !bootstrapAvailable(db)) {
          return res.status(403).json({ error: 'an account already exists — ask an admin for an invite' });
        }
      }
      const user = await finishRegistration(db, { challengeId, response });
      if (inviteToken) consumeInvite(db, inviteToken, user.id);
      // First-ever account becomes admin (bootstrap); everyone else stays a
      // regular member unless promoted later.
      if (bootstrap) {
        db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
      }
      const finalUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      const { token, expiresAt } = createSession(db, user.id);
      setSessionCookie(res, token, Math.floor(SESSION_TTL_MS / 1000));
      res.status(201).json({ user: publicUser(finalUser), expires_at: expiresAt });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/auth/login/options', async (req, res) => {
    const { options, challengeId } = await startAuthentication();
    res.json({ options, challengeId });
  });

  app.post('/api/auth/login/verify', async (req, res) => {
    const { challengeId, response } = req.body || {};
    if (!challengeId || !response) return res.status(400).json({ error: 'challengeId and response are required' });
    try {
      const user = await finishAuthentication(db, { challengeId, response });
      const { token, expiresAt } = createSession(db, user.id);
      setSessionCookie(res, token, Math.floor(SESSION_TTL_MS / 1000));
      res.json({ user: publicUser(user), expires_at: expiresAt });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/invites/:token', (req, res) => {
    const invite = peekInvite(db, req.params.token);
    if (!invite) return res.status(404).json({ error: 'invite is invalid, used, or expired' });
    res.json({ valid: true, expires_at: invite.expires_at });
  });

  app.post('/api/invites', requireAuth, requireAdmin, (req, res) => {
    const { note, ttlHours } = req.body || {};
    const { token, expiresAt } = createInvite(db, req.user.id, note, ttlHours);
    res.status(201).json({ token, expires_at: expiresAt });
  });

  app.get('/api/invites', requireAuth, requireAdmin, (req, res) => {
    const rows = db
      .prepare(
        `SELECT invites.note, invites.created_at, invites.expires_at, invites.used_at,
                creator.display_name AS created_by, redeemer.display_name AS used_by
         FROM invites
         LEFT JOIN users creator ON creator.id = invites.created_by_user_id
         LEFT JOIN users redeemer ON redeemer.id = invites.used_by_user_id
         ORDER BY invites.created_at DESC`,
      )
      .all();
    res.json(rows);
  });

  // --- users (household members, for @mention / assignees) ------------------

  app.get('/api/users', authOrService, (req, res) => {
    const rows = db.prepare('SELECT id, display_name, is_admin FROM users ORDER BY display_name').all();
    res.json(rows.map((r) => ({ id: r.id, display_name: r.display_name, is_admin: !!r.is_admin })));
  });

  function serializeTask(row) {
    if (!row) return row;
    const links = db
      .prepare('SELECT id, url, label, created_at FROM links WHERE task_id = ? ORDER BY id')
      .all(row.id);
    const assignees = db
      .prepare(
        `SELECT users.id, users.display_name FROM task_assignees
         JOIN users ON users.id = task_assignees.user_id
         WHERE task_assignees.task_id = ? ORDER BY users.display_name`,
      )
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
      owner_user_id: row.owner_user_id,
      assignees,
      links,
    };
  }

  /** Can this signed-in user see/edit this task? Service credentials bypass this entirely. */
  function canAccessTask(task, user) {
    if (task.owner_user_id === null) return true; // unclaimed legacy task — shared
    if (task.owner_user_id === user.id) return true;
    const assigned = db
      .prepare('SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ?')
      .get(task.id, user.id);
    return !!assigned;
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

  function setAssignees(taskId, userIds, ts) {
    if (!Array.isArray(userIds)) return;
    db.prepare('DELETE FROM task_assignees WHERE task_id = ?').run(taskId);
    const insert = db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id, created_at) VALUES (?, ?, ?)');
    for (const userId of userIds) {
      if (Number.isInteger(userId)) insert.run(taskId, userId, ts);
    }
  }

  // --- categories (shared/household-wide, not per-user) ---------------------

  app.get('/api/categories', authOrService, (req, res) => {
    const rows = db.prepare('SELECT * FROM categories ORDER BY name').all();
    res.json(rows);
  });

  app.post('/api/categories', authOrService, (req, res) => {
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

  app.patch('/api/categories/:id', authOrService, (req, res) => {
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

  app.delete('/api/categories/:id', authOrService, (req, res) => {
    db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
    res.status(204).end();
  });

  // --- tasks ----------------------------------------------------------------

  app.get('/api/tasks', authOrService, (req, res) => {
    const { status, category_id, importance, due_before, due_after, q, owner_id } = req.query;
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

    if (req.user) {
      // A session sees its own board: owned, assigned to them, or unclaimed
      // legacy tasks — never someone else's private tasks.
      clauses.push(
        `(owner_user_id IS NULL OR owner_user_id = ? OR id IN (SELECT task_id FROM task_assignees WHERE user_id = ?))`,
      );
      params.push(req.user.id, req.user.id);
    } else if (owner_id) {
      // Service credential may narrow to one household member's board.
      clauses.push('owner_user_id = ?');
      params.push(owner_id);
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

  app.get('/api/tasks/:id', authOrService, (req, res) => {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    if (req.user && !canAccessTask(row, req.user)) return res.status(404).json({ error: 'not found' });
    res.json(serializeTask(row));
  });

  app.post('/api/tasks', authOrService, (req, res) => {
    const {
      title,
      notes,
      category_id,
      importance,
      due_date,
      recurrence, // { freq: 'daily'|'weekly'|'monthly'|'yearly', interval?: number }
      links,
      assignee_ids,
      owner_id, // service-credential only: which household member this task belongs to
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

    let ownerUserId;
    if (req.user) {
      ownerUserId = req.user.id; // a session always creates tasks for itself
    } else {
      if (!owner_id) {
        return res.status(400).json({ error: 'owner_id is required (which household member is this task for)' });
      }
      const owner = db.prepare('SELECT id FROM users WHERE id = ?').get(owner_id);
      if (!owner) return res.status(400).json({ error: 'owner_id does not exist' });
      ownerUserId = owner_id;
    }

    const ts = now();
    const info = db
      .prepare(
        `INSERT INTO tasks
          (title, notes, category_id, importance, due_date, status,
           recurrence_freq, recurrence_interval, owner_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      )
      .run(
        title.trim(),
        notes || null,
        category_id || null,
        importance || 'medium',
        due_date || null,
        recurrence?.freq || null,
        recurrence?.interval || 1,
        ownerUserId,
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
    setAssignees(taskId, assignee_ids, ts);

    res.status(201).json(serializeTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId)));
  });

  app.patch('/api/tasks/:id', authOrService, (req, res) => {
    const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not found' });
    if (req.user && !canAccessTask(existing, req.user)) return res.status(404).json({ error: 'not found' });

    const { title, notes, category_id, importance, due_date, status, recurrence, assignee_ids } = req.body || {};
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

    const ts = now();
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
      ts,
      req.params.id,
    );
    if (assignee_ids !== undefined) setAssignees(existing.id, assignee_ids, ts);
    res.json(serializeTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)));
  });

  app.delete('/api/tasks/:id', authOrService, (req, res) => {
    const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (existing && req.user && !canAccessTask(existing, req.user)) return res.status(404).json({ error: 'not found' });
    db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    res.status(204).end();
  });

  // Complete a task. If it recurs, spawn the next pending instance.
  app.post('/api/tasks/:id/complete', authOrService, (req, res) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'not found' });
    if (req.user && !canAccessTask(task, req.user)) return res.status(404).json({ error: 'not found' });

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
             recurrence_freq, recurrence_interval, recurrence_parent_id, owner_user_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
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
          task.owner_user_id,
          ts,
          ts,
        );
      const assignees = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(task.id);
      setAssignees(info.lastInsertRowid, assignees.map((a) => a.user_id), ts);
      nextTask = serializeTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid));
    }

    res.json({
      task: serializeTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)),
      next: nextTask,
    });
  });

  app.post('/api/tasks/:id/reopen', authOrService, (req, res) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'not found' });
    if (req.user && !canAccessTask(task, req.user)) return res.status(404).json({ error: 'not found' });
    db.prepare("UPDATE tasks SET status = 'pending', completed_at = NULL, updated_at = ? WHERE id = ?").run(
      now(),
      task.id,
    );
    res.json(serializeTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)));
  });

  // --- assignees (@mention collaboration) ------------------------------------

  app.post('/api/tasks/:id/assignees', authOrService, (req, res) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'not found' });
    if (req.user && !canAccessTask(task, req.user)) return res.status(404).json({ error: 'not found' });
    const { user_id } = req.body || {};
    const targetUser = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
    if (!targetUser) return res.status(400).json({ error: 'user_id does not exist' });
    db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id, created_at) VALUES (?, ?, ?)').run(
      task.id,
      user_id,
      now(),
    );
    res.status(201).json(serializeTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)));
  });

  app.delete('/api/tasks/:id/assignees/:userId', authOrService, (req, res) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'not found' });
    if (req.user && !canAccessTask(task, req.user)) return res.status(404).json({ error: 'not found' });
    db.prepare('DELETE FROM task_assignees WHERE task_id = ? AND user_id = ?').run(task.id, req.params.userId);
    res.json(serializeTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id)));
  });

  // --- links ------------------------------------------------------------

  app.post('/api/tasks/:id/links', authOrService, (req, res) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'not found' });
    if (req.user && !canAccessTask(task, req.user)) return res.status(404).json({ error: 'not found' });
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

  app.delete('/api/links/:id', authOrService, (req, res) => {
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

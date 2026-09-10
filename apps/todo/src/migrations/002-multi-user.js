export const name = '002-multi-user';

export function up(db) {
  db.exec(`
    -- webauthn_user_id is the opaque handle passed to the browser as the
    -- WebAuthn "userID" — a random handle, not the DB row id or any PII,
    -- per WebAuthn best practice (the spec allows an authenticator to
    -- persist it, so it must not leak identity on its own).
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT NOT NULL,
      webauthn_user_id TEXT NOT NULL UNIQUE,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS passkey_credentials (
      credential_id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      device_name TEXT,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkey_credentials(user_id);

    -- token_hash stores SHA-256(session token) — the raw token lives only in
    -- the client's cookie, so a DB read alone can never yield a usable session.
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    -- Same hashed-token pattern as sessions: the invite link's token is only
    -- ever held by whoever it was shared with.
    CREATE TABLE IF NOT EXISTS invites (
      token_hash TEXT PRIMARY KEY,
      created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      used_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS task_assignees (
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (task_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_assignees_user ON task_assignees(user_id);
  `);

  // SQLite's ALTER TABLE ADD COLUMN can't be expressed as CREATE ... IF NOT
  // EXISTS, so guard it by inspecting the existing schema instead.
  const columns = db.prepare('PRAGMA table_info(tasks)').all();
  if (!columns.some((c) => c.name === 'owner_user_id')) {
    // NULL means "unclaimed" — tasks created before multi-user existed. The
    // app treats a NULL owner as visible to every household member rather
    // than hiding pre-existing data behind a migration nobody asked for.
    db.exec('ALTER TABLE tasks ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
    db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_user_id)');
  }
}

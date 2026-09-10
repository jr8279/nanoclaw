import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/migrations/index.js';
import {
  createSession,
  getSessionUser,
  deleteSession,
  bootstrapAvailable,
  createInvite,
  peekInvite,
  consumeInvite,
  parseCookies,
  startRegistration,
  startAuthentication,
} from '../src/auth.js';

let db;
let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-auth-'));
  db = new Database(path.join(dir, 'todo.db'));
  runMigrations(db);
});

function makeUser(displayName = 'Ryan', isAdmin = 0) {
  const info = db
    .prepare('INSERT INTO users (display_name, webauthn_user_id, is_admin, created_at) VALUES (?, ?, ?, ?)')
    .run(displayName, `whid-${displayName}-${Math.random()}`, isAdmin, new Date().toISOString());
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

// --- sessions ------------------------------------------------------------

test('createSession then getSessionUser round-trips to the right user', () => {
  const user = makeUser();
  const { token } = createSession(db, user.id);
  const found = getSessionUser(db, token);
  assert.equal(found.id, user.id);
});

test('a bogus session token returns no user', () => {
  makeUser();
  const found = getSessionUser(db, 'not-a-real-token');
  assert.equal(found, null);
});

test('an expired session is rejected even though the row still exists', () => {
  const user = makeUser();
  const { token } = createSession(db, user.id);
  // Force it into the past without going through the TTL constant.
  db.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').run('2000-01-01T00:00:00.000Z', user.id);
  assert.equal(getSessionUser(db, token), null);
});

test('deleteSession invalidates the token (logout)', () => {
  const user = makeUser();
  const { token } = createSession(db, user.id);
  deleteSession(db, token);
  assert.equal(getSessionUser(db, token), null);
});

test('the raw session token is never stored — only its hash is in the DB', () => {
  const user = makeUser();
  const { token } = createSession(db, user.id);
  const row = db.prepare('SELECT token_hash FROM sessions WHERE user_id = ?').get(user.id);
  assert.notEqual(row.token_hash, token);
  assert.equal(row.token_hash.length, 64); // sha256 hex
});

// --- bootstrap -------------------------------------------------------------

test('bootstrapAvailable is true only when there are no users yet', () => {
  assert.equal(bootstrapAvailable(db), true);
  makeUser();
  assert.equal(bootstrapAvailable(db), false);
});

// --- invites ------------------------------------------------------------

test('a freshly created invite can be peeked and then consumed once', () => {
  const admin = makeUser('Admin', 1);
  const { token } = createInvite(db, admin.id, 'for grandma');
  const peeked = peekInvite(db, token);
  assert.ok(peeked);
  assert.equal(peeked.note, 'for grandma');

  const newUser = makeUser('Grandma');
  const consumed = consumeInvite(db, token, newUser.id);
  assert.ok(consumed);

  // Second redemption of the same token must fail — invites are single-use.
  assert.equal(peekInvite(db, token), null);
  assert.equal(consumeInvite(db, token, newUser.id), null);
});

test('an expired invite is rejected', () => {
  const admin = makeUser('Admin', 1);
  const { token } = createInvite(db, admin.id, null, 1);
  db.prepare('UPDATE invites SET expires_at = ? WHERE created_by_user_id = ?').run(
    '2000-01-01T00:00:00.000Z',
    admin.id,
  );
  assert.equal(peekInvite(db, token), null);
});

test('a nonexistent invite token is rejected', () => {
  assert.equal(peekInvite(db, 'nonexistent-token'), null);
});

// --- cookies --------------------------------------------------------------

test('parseCookies reads a Cookie header into a key/value map', () => {
  const req = { headers: { cookie: 'todo_session=abc123; other=xyz' } };
  const cookies = parseCookies(req);
  assert.equal(cookies.todo_session, 'abc123');
  assert.equal(cookies.other, 'xyz');
});

test('parseCookies returns an empty object with no Cookie header', () => {
  assert.deepEqual(parseCookies({ headers: {} }), {});
});

// --- WebAuthn ceremony options (crypto-free option generation) ------------
// The full registration/authentication *verification* path needs a real
// (or CDP-virtual) authenticator to produce a valid signed response — that
// is covered by a browser-driven integration test, not here. This confirms
// at least that the option-generation half of the ceremony (deterministic,
// no client involved) succeeds and returns a usable challenge.

test('startRegistration produces registration options for a new account', async () => {
  const { options, challengeId } = await startRegistration(db, { existingUser: null, newDisplayName: 'New Person' });
  assert.ok(options.challenge);
  assert.equal(options.user.name, 'New Person');
  assert.ok(challengeId);
});

test('startRegistration for an existing user excludes their current credentials', async () => {
  const user = makeUser('Has A Key');
  db.prepare(
    'INSERT INTO passkey_credentials (credential_id, user_id, public_key, counter, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run('cred-1', user.id, Buffer.from('fake-key'), 0, new Date().toISOString());
  const { options } = await startRegistration(db, { existingUser: user, newDisplayName: null });
  assert.equal(options.excludeCredentials.length, 1);
  assert.equal(options.excludeCredentials[0].id, 'cred-1');
});

test('startAuthentication produces usernameless login options', async () => {
  const { options, challengeId } = await startAuthentication();
  assert.ok(options.challenge);
  assert.equal(options.allowCredentials?.length ?? 0, 0);
  assert.ok(challengeId);
});

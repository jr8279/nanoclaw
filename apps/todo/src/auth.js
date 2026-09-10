import crypto from 'crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { RP_NAME, RP_ID, ORIGINS } from './webauthn-config.js';

const SESSION_COOKIE = 'todo_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, sliding not implemented (re-login after expiry)
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes to complete a passkey ceremony
const INVITE_DEFAULT_TTL_HOURS = 72;

function now() {
  return new Date().toISOString();
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// --- ephemeral WebAuthn challenge store --------------------------------
// A registration/authentication ceremony is two round trips (options, then
// a signed response) that must agree on the same random challenge. This is
// single-process, in-memory, and short-lived by design — it is not session
// state and does not belong in the DB. Swept lazily on access rather than
// on a timer, since the entries are tiny and self-limiting (5 min TTL).
const pendingChallenges = new Map();

function createChallenge(purpose, data) {
  const id = randomToken(24);
  pendingChallenges.set(id, { purpose, data, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  return id;
}

function consumeChallenge(id, expectedPurpose) {
  const entry = pendingChallenges.get(id);
  pendingChallenges.delete(id);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) return null;
  if (entry.purpose !== expectedPurpose) return null;
  return entry.data;
}

// --- cookies --------------------------------------------------------------

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

// Secure defaults to on (this app is designed to sit behind an HTTPS
// tunnel) — set TODO_COOKIE_INSECURE=true only for plain-http local dev.
const COOKIE_SECURE = process.env.TODO_COOKIE_INSECURE !== 'true';

function setSessionCookie(res, token, maxAgeSeconds) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (COOKIE_SECURE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (COOKIE_SECURE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// --- sessions ---------------------------------------------------------

export function createSession(db, userId) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    now(),
    expiresAt,
  );
  return { token, expiresAt };
}

export function getSessionUser(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT users.* FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    )
    .get(hashToken(token), now());
  return row || null;
}

export function deleteSession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

// --- middleware ---------------------------------------------------------

export function attachAuthMiddleware(db) {
  return (req, res, next) => {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE];
    req.user = token ? getSessionUser(db, token) : null;
    req.sessionToken = token || null;
    next();
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'not signed in' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'not signed in' });
  if (!req.user.is_admin) return res.status(403).json({ error: 'admin only' });
  next();
}

export { setSessionCookie, clearSessionCookie, parseCookies, SESSION_TTL_MS, randomToken, hashToken };

// --- invites ------------------------------------------------------------

export function bootstrapAvailable(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
}

export function createInvite(db, createdByUserId, note, ttlHours = INVITE_DEFAULT_TTL_HOURS) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO invites (token_hash, created_by_user_id, note, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(hashToken(token), createdByUserId, note || null, now(), expiresAt);
  return { token, expiresAt };
}

/** Look up an invite without consuming it — used to render the redemption page. */
export function peekInvite(db, token) {
  if (!token) return null;
  const row = db
    .prepare('SELECT * FROM invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
    .get(hashToken(token), now());
  return row || null;
}

export function consumeInvite(db, token, usedByUserId) {
  const invite = peekInvite(db, token);
  if (!invite) return null;
  db.prepare('UPDATE invites SET used_at = ?, used_by_user_id = ? WHERE token_hash = ?').run(
    now(),
    usedByUserId,
    invite.token_hash,
  );
  return invite;
}

// --- passkey registration ------------------------------------------------

function credentialsForUser(db, userId) {
  return db.prepare('SELECT credential_id, transports FROM passkey_credentials WHERE user_id = ?').all(userId);
}

/**
 * Start registering a new passkey. `existingUser` is null for a brand-new
 * account (invite redemption or bootstrap); otherwise it's an additional
 * device for someone already signed in.
 */
export async function startRegistration(db, { existingUser, newDisplayName }) {
  const webauthnUserId = existingUser ? existingUser.webauthn_user_id : randomToken(32);
  const displayName = existingUser ? existingUser.display_name : newDisplayName;
  const excludeCredentials = existingUser ? credentialsForUser(db, existingUser.id) : [];

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: Buffer.from(webauthnUserId, 'base64url'),
    userName: displayName,
    userDisplayName: displayName,
    attestationType: 'none',
    excludeCredentials: excludeCredentials.map((c) => ({
      id: c.credential_id,
      transports: c.transports ? JSON.parse(c.transports) : undefined,
    })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });

  const challengeId = createChallenge('register', {
    challenge: options.challenge,
    webauthnUserId,
    displayName,
    existingUserId: existingUser ? existingUser.id : null,
  });

  return { options, challengeId };
}

/**
 * Finish registering a passkey. Returns the user row (existing or newly
 * created) and the new credential's id, or throws on verification failure.
 */
export async function finishRegistration(db, { challengeId, response }) {
  const pending = consumeChallenge(challengeId, 'register');
  if (!pending) throw new Error('registration ceremony expired or invalid — try again');

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: pending.challenge,
    expectedOrigin: ORIGINS,
    expectedRPID: RP_ID,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('passkey registration could not be verified');
  }

  const { credential } = verification.registrationInfo;
  let userId = pending.existingUserId;
  if (!userId) {
    const info = db
      .prepare('INSERT INTO users (display_name, webauthn_user_id, created_at) VALUES (?, ?, ?)')
      .run(pending.displayName, pending.webauthnUserId, now());
    userId = info.lastInsertRowid;
  }

  db.prepare(
    `INSERT INTO passkey_credentials
      (credential_id, user_id, public_key, counter, transports, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    credential.id,
    userId,
    Buffer.from(credential.publicKey),
    credential.counter,
    credential.transports ? JSON.stringify(credential.transports) : null,
    now(),
  );

  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

// --- passkey login --------------------------------------------------------

export async function startAuthentication() {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'preferred',
    // Empty allowCredentials + residentKey:'required' at registration time
    // is what makes this usernameless — the browser offers every passkey
    // it holds for this RP ID rather than the app naming one up front.
  });
  const challengeId = createChallenge('login', { challenge: options.challenge });
  return { options, challengeId };
}

export async function finishAuthentication(db, { challengeId, response }) {
  const pending = consumeChallenge(challengeId, 'login');
  if (!pending) throw new Error('login ceremony expired or invalid — try again');

  const stored = db.prepare('SELECT * FROM passkey_credentials WHERE credential_id = ?').get(response.id);
  if (!stored) throw new Error('unrecognized passkey');

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: pending.challenge,
    expectedOrigin: ORIGINS,
    expectedRPID: RP_ID,
    credential: {
      id: stored.credential_id,
      publicKey: stored.public_key,
      counter: stored.counter,
      transports: stored.transports ? JSON.parse(stored.transports) : undefined,
    },
  });
  if (!verification.verified) throw new Error('passkey login could not be verified');

  db.prepare('UPDATE passkey_credentials SET counter = ?, last_used_at = ? WHERE credential_id = ?').run(
    verification.authenticationInfo.newCounter,
    now(),
    stored.credential_id,
  );

  return db.prepare('SELECT * FROM users WHERE id = ?').get(stored.user_id);
}

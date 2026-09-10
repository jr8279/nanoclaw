// Regression coverage for UX findings not reachable from the backend test
// suite: the save-failure/dialog-discard bug and the link-parser bogus-link
// bug. Uses jsdom rather than a real browser — cheap, deterministic, and not
// subject to the route-interception flakiness a full browser harness hit in
// CI sandboxes. Auth/passkey ceremonies are mocked out (jsdom has no real
// WebAuthn) — the app boots as an already-signed-in user so the rest of the
// UI is testable; the actual ceremony is covered by src/auth.js's unit
// tests plus manual verification.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const webauthnJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'webauthn.js'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

let dom;
let window;
let fetchCalls;
let fetchImpl;

function flush() {
  // Let queued microtasks (the async submit handler's awaits) settle.
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** boot() chains several sequential fetches (me -> users -> categories ->
 * tasks) — one flush() tick isn't enough to drain all of them, so loop. */
async function flushAll(times = 10) {
  for (let i = 0; i < times; i++) await flush();
}

function defaultFetchImpl(url) {
  const u = String(url);
  let body = [];
  if (u.includes('/api/auth/me')) {
    body = { user: { id: 1, display_name: 'Test User', is_admin: true }, bootstrap_available: false };
  }
  return Promise.resolve(
    new window.Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
}

before(async () => {
  dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  window = dom.window;
  // jsdom has no real <dialog> support (showModal/close are no-ops without a
  // polyfill) — stub just enough of the API for app.js's usage.
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  // jsdom doesn't implement the fetch API's Response class — borrow Node's
  // built-in global, which is spec-compatible for our purposes here.
  window.Response = Response;
  fetchCalls = [];
  fetchImpl = defaultFetchImpl;
  window.fetch = (...args) => {
    fetchCalls.push(args);
    return fetchImpl(...args);
  };
  window.localStorage.clear();
  window.eval(webauthnJs);
  window.eval(appJs);
  await flushAll();
});

beforeEach(() => {
  fetchCalls = [];
  fetchImpl = defaultFetchImpl;
});

test('a signed-in user sees the app, not the auth screen', () => {
  assert.equal(window.document.getElementById('app').hidden, false);
  assert.equal(window.document.getElementById('authScreen').hidden, true);
});

test('#userMenu is nested inside its position:relative anchor, not a sibling of it', () => {
  // Bug: #userMenu (position: absolute) originally sat outside
  // .topbar-actions (its intended position: relative anchor) as a sibling
  // instead of a child — with no positioned ancestor, its `top`/`right`
  // resolved against the initial containing block instead of the button,
  // so opening the menu rendered it off-screen even though `hidden` was
  // correctly removed. Assert the containment structurally.
  const topbarActions = window.document.querySelector('.topbar-actions');
  const userMenu = window.document.getElementById('userMenu');
  assert.ok(topbarActions.contains(userMenu), '#userMenu must be a descendant of .topbar-actions');
});

test('style.css gives [hidden] on .auth-screen enough specificity to actually hide it', () => {
  // Same class of bug as the key-banner fix: `.auth-screen { display: flex }`
  // (specificity 0,1,0) beats the UA `[hidden] { display: none }` rule
  // unless an author rule scoped to `.auth-screen[hidden]` (0,2,0) is added —
  // without it, the login/register screen stays visible, overlapping the
  // app, even after boot() sets `authScreen.hidden = true`.
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(css, /\.auth-screen\[hidden\]\s*\{[^}]*display:\s*none/);
});

test('save failure keeps the dialog open, preserves the typed title, and shows an error', async () => {
  window.document.getElementById('addBtn').click();
  window.document.getElementById('fTitle').value = 'This should not vanish';

  fetchImpl = async (url) => {
    if (String(url).includes('/api/tasks') && !String(url).includes('?')) {
      throw new TypeError('Failed to fetch');
    }
    return new window.Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  window.document.getElementById('saveBtn').click();
  await flushAll();

  const dialog = window.document.getElementById('taskDialog');
  assert.equal(dialog.open, true, 'dialog should stay open on a failed save');
  assert.equal(window.document.getElementById('fTitle').value, 'This should not vanish');
  const err = window.document.getElementById('formError');
  assert.equal(err.hidden, false, 'an error message should be shown');
  assert.ok(err.textContent.length > 0);
});

test('parseLinks drops a line with no http(s) URL instead of inventing one from the last word', () => {
  // Cross-realm objects (this result comes from the jsdom window) aren't
  // deepStrictEqual to plain node objects even with identical values, so
  // compare via JSON rather than assert.deepEqual.
  const result = JSON.parse(JSON.stringify(window.parseLinks('Just some notes with no url at all')));
  assert.deepEqual(result, []);
});

test('parseLinks keeps a line that does have a URL, with the rest as its label', () => {
  const result = JSON.parse(JSON.stringify(window.parseLinks('School portal https://example.com')));
  assert.deepEqual(result, [{ url: 'https://example.com', label: 'School portal' }]);
});

test('style.css defines a light palette on bare :root and only overrides it for dark via a media query', () => {
  // The original bug: all tokens were defined once, hardcoded to dark
  // values, under bare :root with no `@media (prefers-color-scheme: dark)`
  // guard — so the app rendered dark regardless of the OS light-mode
  // setting. Assert the structural fix rather than computed colors (jsdom's
  // media-query emulation isn't reliable enough to assert on here).
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  const rootBlock = css.match(/:root\s*\{([^}]*)\}/)[1];
  assert.doesNotMatch(rootBlock, /#0f1117/, ':root itself should hold the light palette, not the dark one');
});

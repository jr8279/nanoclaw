// Regression coverage for the UX-review findings that aren't reachable from
// the backend test suite: the save-failure/dialog-discard bug, the
// key-banner visibility bug, and the link-parser bogus-link bug. Uses jsdom
// rather than a real browser — cheap, deterministic, and not subject to the
// route-interception flakiness a full browser harness hit in CI sandboxes.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

let dom;
let window;
let fetchCalls;
let fetchImpl;

function flush() {
  // Let queued microtasks (the async submit handler's awaits) settle.
  return new Promise((resolve) => setTimeout(resolve, 0));
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
  fetchCalls = [];
  window.fetch = (...args) => {
    fetchCalls.push(args);
    return fetchImpl(...args);
  };
  window.localStorage.clear();
  window.eval(appJs);
  await flush();
});

beforeEach(() => {
  fetchCalls = [];
  fetchImpl = async () => new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
});

function Response(body, init) {
  return new window.Response(body, init);
}

test('key banner has hidden=true in markup', () => {
  const banner = window.document.getElementById('keyBanner');
  assert.equal(banner.hidden, true);
});

test('style.css gives [hidden] on .key-banner enough specificity to actually hide it', () => {
  // The original bug: `.key-banner { display: flex }` (specificity 0,1,0)
  // beat the UA `[hidden] { display: none }` rule (also 0,1,0, but earlier
  // in the cascade), so the banner rendered even when the `hidden` attribute
  // was set. A DOM-property check (`banner.hidden === true`) can't catch
  // this — jsdom doesn't apply the cascade the way a real browser does — so
  // assert directly on the stylesheet: an author rule scoped to
  // `.key-banner[hidden]` (specificity 0,2,0) is required to win.
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(css, /\.key-banner\[hidden\]\s*\{[^}]*display:\s*none/);
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
  await flush();
  await flush();

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

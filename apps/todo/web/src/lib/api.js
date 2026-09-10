// Thin fetch wrapper matching the old vanilla app's `api()` helper.
// Callers that need to react to a 401 (drop back to the auth screen) check
// `err.unauthorized` rather than this module reaching into app state
// directly — keeps it framework-agnostic and easy to test.
export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    const err = new Error('signed out');
    err.unauthorized = true;
    throw err;
  }
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

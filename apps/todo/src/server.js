import { createApp } from './app.js';
import { RP_ID, isConfiguredForProduction } from './webauthn-config.js';

const PORT = Number(process.env.TODO_PORT || 8787);
const API_KEY = process.env.TODO_API_KEY || '';
// Passkey sessions gate every /api route now (aside from /api/health and the
// auth ceremony itself), so — unlike the pre-multi-user version of this
// app — there's no "unauthenticated by default" risk tied to TODO_API_KEY
// being unset. Default to every interface (Docker-friendly); override with
// TODO_BIND_ADDR for a localhost-only + reverse-proxy setup instead.
const BIND_ADDR = process.env.TODO_BIND_ADDR || '0.0.0.0';

if (!API_KEY) {
  console.warn('[TODO] TODO_API_KEY is not set — the nanoclaw MCP tool integration is disabled. User logins are unaffected.');
}
if (BIND_ADDR !== '127.0.0.1' && !isConfiguredForProduction()) {
  console.warn(
    `[TODO] WARNING: binding to ${BIND_ADDR} but TODO_RP_ID is still "localhost" — ` +
      `passkeys are bound to a domain and will fail to register/verify once this is reachable ` +
      `at any other hostname. Set TODO_RP_ID and TODO_ORIGIN to match the domain this sits behind ` +
      `(e.g. your Cloudflare tunnel hostname) before inviting anyone.`,
  );
}

const app = createApp({ apiKey: API_KEY });

app.listen(PORT, BIND_ADDR, () => {
  console.log(`nanoclaw-todo listening on http://${BIND_ADDR}:${PORT} (RP_ID=${RP_ID})`);
});

// Passkeys are bound to a domain (the "Relying Party" ID) and an exact
// origin — there is no sane default for either behind a Cloudflare tunnel,
// so both must be configured explicitly once the app leaves localhost.
export const RP_NAME = process.env.TODO_RP_NAME || 'NanoClaw Todo';
export const RP_ID = process.env.TODO_RP_ID || 'localhost';

export const ORIGINS = (process.env.TODO_ORIGIN || `http://localhost:${process.env.TODO_PORT || 8787}`)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function isConfiguredForProduction() {
  return RP_ID !== 'localhost';
}

import { createApp } from './app.js';

const PORT = Number(process.env.TODO_PORT || 8787);
const API_KEY = process.env.TODO_API_KEY || '';
// Fail-safe default: only bind every interface if there's a key gating it,
// or the operator explicitly opts in. Otherwise stay on localhost so an
// unauthenticated instance isn't reachable from the rest of the LAN.
const BIND_ADDR = process.env.TODO_BIND_ADDR || (API_KEY ? '0.0.0.0' : '127.0.0.1');

if (!API_KEY) {
  console.warn(
    `[TODO] WARNING: TODO_API_KEY is not set — /api is unauthenticated. ` +
      `Binding to ${BIND_ADDR} only. Set TODO_API_KEY and TODO_BIND_ADDR=0.0.0.0 ` +
      `to expose this beyond localhost.`,
  );
}

const app = createApp({ apiKey: API_KEY });

app.listen(PORT, BIND_ADDR, () => {
  console.log(`nanoclaw-todo listening on http://${BIND_ADDR}:${PORT}`);
});

# nanoclaw-todo

Self-hosted todo list: categories, due dates, importance, recurring tasks, notes
and reference links. Installable PWA for the phone/desktop, plain REST API
underneath, and an MCP tool (`container/agent-runner/src/todo-mcp-stdio.ts`)
so your nanoclaw agent can list, create, complete and update tasks by chat.

Standalone Node/Express/SQLite app — separate process from the nanoclaw host,
runs anywhere on the KVM (or elsewhere). Nanoclaw talks to it only over HTTP.

## Run it

```bash
cd apps/todo
npm install
TODO_PORT=8787 TODO_API_KEY=$(openssl rand -hex 24) npm start
```

- `TODO_PORT` — defaults to `8787`.
- `TODO_DATA_DIR` — where `todo.db` lives, defaults to `apps/todo/data/`.
- `TODO_API_KEY` — if set, every `/api/*` request except `/api/health`
  (PWA and MCP tool alike) must send it via the `X-API-Key` header.
- `TODO_BIND_ADDR` — which interface to listen on. Defaults to `0.0.0.0`
  *only if* `TODO_API_KEY` is set; otherwise defaults to `127.0.0.1` so an
  unauthenticated instance isn't reachable from the rest of the LAN. Set it
  explicitly to override either default. If you leave `TODO_API_KEY` unset,
  the server logs a startup warning and only listens on localhost —
  reachable from a browser on the same KVM, or via SSH port-forwarding, but
  not directly from your phone. For phone access, set `TODO_API_KEY` (this
  also flips the bind default to `0.0.0.0`).

### Run the test suite

```bash
cd apps/todo
npm test
```

Covers the REST API (validation, recurrence math, cascading deletes, auth)
and the PWA's client-side logic (link parsing, the save-failure UI path,
CSS structural checks) — see `test/app.test.js` and `test/frontend.test.js`.

### Run as a systemd service

```ini
# /etc/systemd/system/nanoclaw-todo.service
[Unit]
Description=nanoclaw-todo
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/nanoclaw/apps/todo
Environment=TODO_PORT=8787
Environment=TODO_API_KEY=<your key>
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
User=nanoclaw

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now nanoclaw-todo
```

## Install as a PWA (phone / desktop)

1. Open `http://<kvm-host>:8787` in Safari (iOS) or Chrome (Android/desktop).
2. If you set `TODO_API_KEY`, enter it in the banner at the bottom the first
   time — it's stored in that browser's `localStorage`.
3. iOS: Share → **Add to Home Screen**. Android/desktop Chrome: the install
   icon in the address bar, or menu → **Install app**.

It then opens full-screen from the home screen icon, works offline for the
shell (task data still needs a connection), and updates automatically when
you redeploy.

## Wire it to your nanoclaw agent

The MCP tool is baked into the agent-runner image behind an env-var gate —
nothing ships to agents that don't opt in.

1. Point the host at your running todo app in `.env` (or your service's
   environment):

   ```bash
   TODO_API_URL=http://host.docker.internal:8787
   TODO_API_KEY=<same key as above, if you set one>
   ```

   `host.docker.internal` reaches the KVM host's todo app from inside the
   agent container regardless of which agent group is asking; the MCP tool
   also falls back to `localhost` if that resolution fails.

2. Rebuild the container image so it picks up `todo-mcp-stdio.ts`:

   ```bash
   ./container/build.sh
   ```

3. Restart nanoclaw (or just the container) so the new env vars reach the
   container:

   ```bash
   launchctl kickstart -k gui/$(id -u)/com.nanoclaw   # macOS
   # systemctl --user restart nanoclaw                # Linux
   ```

Once running, tell your agent things like "add a task to pick up the kids'
permission slip, due Friday, category Kids School" — it has
`todo_list_categories`, `todo_list_tasks`, `todo_create_task`,
`todo_update_task`, `todo_complete_task`, `todo_reopen_task` and
`todo_delete_task` available.

## REST API

All endpoints are under `/api`. JSON in, JSON out.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/categories` | List categories |
| POST | `/api/categories` | Create `{ name, color }` |
| PATCH/DELETE | `/api/categories/:id` | Update/delete |
| GET | `/api/tasks` | List, filters: `status` (`pending`\|`completed`\|`all`, default `pending`), `category_id`, `importance`, `due_before`, `due_after`, `q` |
| POST | `/api/tasks` | Create — `title`, `notes`, `category_id`, `importance`, `due_date` (ISO), `recurrence: {freq, interval}`, `links: [{url, label}]` |
| GET/PATCH/DELETE | `/api/tasks/:id` | Read/update/delete one task |
| POST | `/api/tasks/:id/complete` | Mark complete; spawns the next occurrence if recurring |
| POST | `/api/tasks/:id/reopen` | Un-complete |
| POST | `/api/tasks/:id/links` | Attach a link |
| DELETE | `/api/links/:id` | Remove a link |

`recurrence.freq` is one of `daily`, `weekly`, `monthly`, `yearly`;
`interval` is an optional repeat count (e.g. `{freq: "weekly", interval: 2}`
= every two weeks). Setting a recurrence requires a `due_date` — recurrence
is anchored on it (on completion, the next instance's due date is computed
from the completed task's own due date, not from "now"), so there's nothing
to anchor to without one. Monthly/yearly recurrence clamps to the last real
day of the target month (Jan 31 + 1 month lands on Feb 28, not an overflow
into March).

Validation: `title` is required; `importance` must be
`low`/`medium`/`high`/`urgent`; `due_date` must parse as a valid timestamp;
`category_id` must reference an existing category; link URLs must start
with `http://`, `https://`, or `mailto:` (rejected otherwise — this closes
off `javascript:`/`data:` URIs, which would otherwise execute on click).
Requests that fail validation get a `400` with a JSON `{ error }` body, not
a stack trace — every route funnels through a single JSON error handler.

### Known low-risk items (personal LAN app, not multi-tenant)

- The `X-API-Key` check isn't timing-attack-hardened against a
  sophisticated LAN adversary in the classic sense, but does use
  `crypto.timingSafeEqual` rather than `===`.
- `TODO_API_KEY` is forwarded to the agent container as a plain env var
  (not via OneCLI's credential vault) — a deliberate exception, since it's
  a key you generate yourself purely to gate this app, not a third-party
  credential OneCLI's revocation/sharing model is meant to protect.
- `express`'s transitive `qs` dependency has an open moderate-severity
  advisory (query-string parsing DoS) with no non-breaking fix available at
  time of writing. Low relevance for a single-operator LAN app; revisit if
  `npm audit` clears with a future `express` release.

# nanoclaw-todo

Self-hosted, multi-user todo list: categories, due dates, importance,
recurring tasks, notes, reference links, and per-task @mention-style
tagging so a task can show up on more than one household member's board.
Each person signs in with a passkey — no passwords, no shared account.
Installable PWA for the phone/desktop, plain REST API underneath, and an
MCP tool (`container/agent-runner/src/todo-mcp-stdio.ts`) so your nanoclaw
agent can list, create, complete and update tasks by chat.

Standalone Node/Express/SQLite app — separate process from the nanoclaw
host, meant to run in Docker behind a reverse proxy that terminates HTTPS
(this doc assumes a Cloudflare Tunnel). Nanoclaw talks to it only over
HTTP(S).

## How accounts work

- **The first person to open the app becomes the admin** (`TODO_ADMIN_BOOTSTRAP_TOKEN`
  isn't needed — bootstrap is simply "no accounts exist yet", checked at
  registration time). They register a passkey and that's the whole signup.
- **Everyone else needs an invite.** An admin generates a one-time link
  (user menu → **Invite someone**) that expires in 72 hours; opening it
  lets the recipient register their own passkey. There's no open signup —
  the app is reachable from the internet once it's behind your tunnel, so
  registration is invite-gated by design.
- **Passkeys are per-device.** Add a second one (phone + laptop, say) from
  the user menu → **Add a passkey on this device** while already signed in.
- Tasks belong to whoever created them (`owner_user_id`). Tagging another
  household member on a task (the "Tag someone" field in the task dialog)
  adds them to `task_assignees` — it's the *same task record* on both
  boards, not a copy, so either person completing it is visible to both.

## Run it (Docker)

The image build has a frontend build stage (`npm ci` with devDependencies,
`vite build`) ahead of the slim runtime stage (prod deps only + `src/` +
the built `public/`) — nothing to do differently here, `docker build` runs
the frontend build for you.

```bash
cd apps/todo
docker build -t nanoclaw-todo .
docker run -d --name nanoclaw-todo \
  -p 127.0.0.1:8787:8787 \
  -v nanoclaw-todo-data:/app/data \
  -e TODO_RP_ID=todo.yourdomain.com \
  -e TODO_ORIGIN=https://todo.yourdomain.com \
  -e TODO_API_KEY=$(openssl rand -hex 24) \
  nanoclaw-todo
```

Then point your Cloudflare Tunnel's public hostname at `127.0.0.1:8787`
(or `nanoclaw-todo:8787` if the tunnel container shares a Docker network
with this one — use `-p 8787:8787` without the `127.0.0.1` prefix in that
case, since the tunnel reaches it over the Docker network rather than the
host's loopback).

- `TODO_RP_ID` — **required for real use.** The bare domain passkeys are
  bound to (no scheme, no port) — this must be the hostname people
  actually visit (your tunnel's public hostname). Passkeys registered
  under one RP ID will not work if this changes later. Defaults to
  `localhost`, which only works for local dev.
- `TODO_ORIGIN` — **required for real use.** The exact origin(s) browsers
  will report during a passkey ceremony, e.g. `https://todo.yourdomain.com`.
  Comma-separate if you serve more than one (e.g. a tunnel hostname and a
  LAN IP for local fallback). Must match exactly — scheme, host, and port.
- `TODO_PORT` — defaults to `8787`.
- `TODO_DATA_DIR` — where `todo.db` lives; the Docker image sets this to
  `/app/data`, backed by the volume above.
- `TODO_API_KEY` — the *service* credential for the nanoclaw MCP tool
  (separate from human logins). Required for the agent integration; if
  unset, the todo app still works for humans, just not from chat.
- `TODO_BIND_ADDR` — defaults to `0.0.0.0` (Docker-friendly — passkey
  sessions gate every route, so there's no "wide open" risk the way an
  unset API key implied in earlier single-user versions of this app).
  Override for a bare-metal, non-Docker install if you want localhost-only
  binding behind your own reverse proxy instead.

### Run without Docker

```bash
cd apps/todo
npm install
npm run build   # builds web/ (Vite/React) into public/
TODO_RP_ID=todo.yourdomain.com TODO_ORIGIN=https://todo.yourdomain.com \
  TODO_API_KEY=$(openssl rand -hex 24) npm start
```

## Frontend

The PWA frontend is React + Vite, living under `web/` (`web/index.html`,
`web/src/`, plus PWA-only static assets — `manifest.json`, `icons/`,
`sw.js` — under `web/public/` that Vite copies through verbatim).
`vite.config.js` builds it with `root: 'web'` and
`outDir: '../public'`, so `public/` is a **build artifact** — it's
`.gitignore`'d, not hand-edited, and `express.static` (`src/app.js`) serves
whatever's in it without knowing or caring that it came from a bundler.

```bash
npm run dev:api   # Express API, --watch, on TODO_PORT (default 8787)
npm run dev:web   # Vite dev server with hot reload, proxies /api to dev:api
npm run build     # vite build -> public/ (what Docker/`npm start` serve)
```

Run `dev:api` and `dev:web` in separate terminals for local frontend work;
`vite.config.js`'s dev-server proxy points at `http://localhost:8787` by
default, override with `TODO_DEV_API_URL` if the API runs elsewhere.

Styling: one design-token stylesheet (`web/src/styles/index.css`) covers
the whole app — canvas/surface elevation hierarchy, the signature accent,
light/dark tokens — components stay unstyled-by-class, not per-component
CSS files. Interaction/animation: Radix UI primitives
(`@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`) for accessible
dialog/menu behavior (focus trap, outside-dismiss, escape), Framer Motion
for the spring-based micro-interactions (dialog open/close, list
enter/exit on filter/sort/group changes, the checkbox-complete draw,
category-chip and assignee-pill press feedback).

### Run the test suites

```bash
cd apps/todo
npm test          # backend: node --test against src/ (REST API, auth, migrations)
npm run test:web  # frontend: vitest + React Testing Library against web/src
```

The backend suite covers the REST API (validation, recurrence math,
ownership/visibility scoping across users, cascading deletes, auth), the
auth module (sessions, invites, WebAuthn option generation), and
migrations (including upgrading a pre-multi-user database). The frontend
suite covers the pure task-list logic (sort/group/link-parsing — ported
1:1 from the old vanilla-JS suite) and component-level regression coverage
(the task dialog's save-failure path, title/due-date validation, editing
an existing task prefills every field). The full passkey register/login
*ceremony* (real WebAuthn crypto) isn't exercised by either suite — jsdom
has no WebAuthn implementation — but was verified manually against a real
browser using Chrome DevTools Protocol's virtual authenticator (bootstrap
→ logout → login with the same passkey → invite → redeem → tag a task →
cross-user visibility, all passing).

## Install as a PWA (phone / desktop)

1. Open your tunnel's URL (or `http://<kvm-host>:8787` for local testing)
   in Safari (iOS) or Chrome (Android/desktop).
2. First visit ever: register the admin passkey. Otherwise: sign in with
   the passkey on that device, or open an invite link if you have one.
3. iOS: Share → **Add to Home Screen**. Android/desktop Chrome: the install
   icon in the address bar, or menu → **Install app**.

It then opens full-screen from the home screen icon and updates
automatically when you redeploy.

## Wire it to your nanoclaw agent

The MCP tool is baked into the agent-runner image behind an env-var gate —
nothing ships to agents that don't opt in. Since the agent isn't logged in
as any one household member, every task it creates must say whose board it
belongs on (`owner_id`) — `todo_list_users` resolves a name to an id.

1. Point the host at your running todo app in `.env` (or your service's
   environment):

   ```bash
   TODO_API_URL=https://todo.yourdomain.com
   TODO_API_KEY=<same key as above>
   ```

   If nanoclaw and the todo app run as sibling Docker containers instead,
   use `http://host.docker.internal:8787` (or the todo container's service
   name on a shared Docker network) rather than the public tunnel URL — no
   need to round-trip through the internet for same-host traffic. The MCP
   tool falls back from `host.docker.internal` to `localhost` if that
   resolution fails.

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

Once running, tell your agent things like "add a task for Sarah to pick up
the kids' permission slip, due Friday, category Kids School" — it has
`todo_list_users`, `todo_list_categories`, `todo_list_tasks`,
`todo_create_task`, `todo_update_task`, `todo_complete_task`,
`todo_reopen_task` and `todo_delete_task` available.

## REST API

All endpoints are under `/api`. JSON in, JSON out. Every route except
`/api/health` and the auth/invite endpoints requires either a signed-in
session (browser cookie) or the service `X-API-Key` header.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/me` | Current user (or `null`) + whether bootstrap (first account) is available |
| POST | `/api/auth/register/options` / `/verify` | Passkey registration — bootstrap, invite redemption, or an extra device while signed in |
| POST | `/api/auth/login/options` / `/verify` | Passkey (usernameless) login |
| POST | `/api/auth/logout` | Clear the session |
| POST | `/api/invites` *(admin)* | Create a one-time invite link |
| GET | `/api/invites` *(admin)* | List invites (created/used/expired) |
| GET | `/api/invites/:token` | Check an invite is still valid (used by the redemption screen) |
| GET | `/api/users` | List household members `{id, display_name}` — for @mention/assignee pickers |
| GET | `/api/categories` | List categories (shared/household-wide, not per-user) |
| POST | `/api/categories` | Create `{ name, color }` |
| PATCH/DELETE | `/api/categories/:id` | Update/delete |
| GET | `/api/tasks` | List, filters: `status` (`pending`\|`completed`\|`all`, default `pending`), `category_id`, `importance`, `due_before`, `due_after`, `q`, `owner_id` (service credential only — narrows to one member's board) |
| POST | `/api/tasks` | Create — `title`, `notes`, `category_id`, `importance`, `due_date` (ISO), `recurrence: {freq, interval}`, `links: [{url, label}]`, `assignee_ids: [userId]`; a session creates for itself, the service credential must pass `owner_id` |
| GET/PATCH/DELETE | `/api/tasks/:id` | Read/update/delete one task (404 for a task you can't see, not 403 — doesn't confirm it exists) |
| POST | `/api/tasks/:id/complete` | Mark complete; spawns the next occurrence if recurring |
| POST | `/api/tasks/:id/reopen` | Un-complete |
| POST | `/api/tasks/:id/assignees` | Tag a household member (`{user_id}`) on a task |
| DELETE | `/api/tasks/:id/assignees/:userId` | Untag |
| POST | `/api/tasks/:id/links` | Attach a link |
| DELETE | `/api/links/:id` | Remove a link |

**Visibility**: a signed-in session sees tasks it owns, tasks it's tagged
on, and any task with no owner (data from before multi-user existed —
treated as shared until someone claims it). The service credential is
unscoped by default (sees everyone's tasks) unless `owner_id` narrows it.

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

## Database

SQLite, WAL mode — plenty for a household's worth of users and tasks; see
`docs` in the main repo if you're wondering whether to move to Postgres
(short answer: not for this scale). Schema changes go through a real
migration runner now (`src/migrations/`, tracked in a `schema_migrations`
table) rather than hand-editing `CREATE TABLE IF NOT EXISTS` — add a new
`NNN-description.js` file exporting `{ name, up(db) }` and register it in
`src/migrations/index.js`.

## Known low-risk items (household-scale app, not multi-tenant SaaS)

- The `X-API-Key`/session checks aren't hardened against a sophisticated
  adversary in the classic sense, but the API key comparison does use
  `crypto.timingSafeEqual`, and session tokens are stored server-side only
  as a SHA-256 hash (the raw token lives solely in the client's
  `HttpOnly`/`Secure` cookie).
- `TODO_API_KEY` is forwarded to the agent container as a plain env var
  (not via OneCLI's credential vault) — a deliberate exception, since it's
  a key you generate yourself purely to gate this app, not a third-party
  credential OneCLI's revocation/sharing model is meant to protect.
- `express`'s transitive `qs` dependency has an open moderate-severity
  advisory (query-string parsing DoS) with no non-breaking fix available at
  time of writing. Low relevance here; revisit if `npm audit` clears with a
  future `express` release.
- Invite links and session tokens are 32 random bytes (base64url) — plenty
  of entropy against guessing; the real exposure is someone intercepting
  an invite link in transit, which is why it's single-use and expires in
  72 hours.

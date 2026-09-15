# Backing up and restoring agent state

NanoClaw's code lives in this git repo, already safe. What's at risk if the
host (KVM, server, etc.) is lost is the **install-specific state** — every
agent's memory, config, and conversation history — which is gitignored on
purpose (it's per-install, not code). This is a separate, private backup
repo + a script that snapshots that state into it on a schedule.

Scales to any number of agent groups automatically: `groups/*` and the
central DB already hold every agent group, so nothing here needs updating
as you add agents.

## What's backed up

- `data/v2.db` — central DB (agent groups, wirings, users, roles, tasks) —
  copied via `better-sqlite3`'s native `.backup()`, which is WAL-safe (a
  plain `cp` can catch the file mid-write since NanoClaw uses WAL journal
  mode elsewhere and checkpoints happen async)
- `groups/*/` — each agent's memory, notes, conversations, tasks, skills —
  minus scratch/regenerable content

## What's excluded — never leaves the machine

- `.env`, `*.keys.json`, `data/photon-auth.json` — live credentials
- `node_modules/`, `.pnpm-store/`, `tmp*/`, `.claude-fragments/` —
  regenerated on container spawn
- `CLAUDE.local.md`, `.claude-shared.md` — composer-regenerated, not
  source state
- `data/v2-sessions/` — ephemeral per-session inbound/outbound DBs

Secrets (API keys, OAuth tokens) live in the OneCLI Agent Vault, not in
this repo's data files — this backup does not cover the vault. Back up
the vault separately per OneCLI's own docs if you rely on it.

## One-time setup

1. Create a **private** repo on GitHub (empty, no README) — e.g.
   `nanoclaw-backup`.
2. Clone it next to your NanoClaw checkout:
   ```bash
   git clone git@github.com:<you>/nanoclaw-backup.git ~/nanoclaw-backup
   ```
3. Install the timer (systemd, Linux):
   ```bash
   sudo cp scripts/systemd/nanoclaw-backup.service /etc/systemd/system/
   sudo cp scripts/systemd/nanoclaw-backup.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now nanoclaw-backup.timer
   ```
   Edit the `.service` file's `NANOCLAW_DIR` / `NANOCLAW_BACKUP_DIR` /
   `User` first if your paths or user differ from the defaults.
4. Run it once by hand to confirm it works end to end:
   ```bash
   NANOCLAW_DIR=/home/docker/nanoclaw NANOCLAW_BACKUP_DIR=~/nanoclaw-backup \
     ./scripts/backup-agents.sh
   ```

Check timer status any time: `systemctl status nanoclaw-backup.timer` /
`journalctl -u nanoclaw-backup.service`.

## Restoring on a new server

1. Set up NanoClaw fresh: `git clone` this repo, run `/setup` up through
   dependency install (don't create agents yet).
2. Clone your backup repo: `git clone git@github.com:<you>/nanoclaw-backup.git`.
3. Stop the service, then copy state into place:
   ```bash
   systemctl --user stop nanoclaw   # or launchctl unload on macOS
   cp nanoclaw-backup/data/v2.db /home/docker/nanoclaw/data/v2.db
   rsync -a nanoclaw-backup/groups/ /home/docker/nanoclaw/groups/
   ```
4. Re-authenticate OneCLI / re-link channel sessions (WhatsApp QR, Signal
   device link, Photon/iMessage device auth, etc.) — none of that carries
   over since it was deliberately excluded.
5. Start the service and confirm each agent group responds.

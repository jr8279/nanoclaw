import type { Migration } from './index.js';

/**
 * Extra Docker networks to attach an agent group's container to, beyond the
 * default bridge (or the egress-lockdown network when that's active).
 *
 * JSON array of network names, e.g. `["cloud_default"]`. Applied via
 * `docker network connect` right after `docker run` in container-runner.ts —
 * `docker run` only accepts one `--network` at creation time, so additional
 * ones are attached post-spawn. Empty array (the default) changes nothing.
 */
export const migration022: Migration = {
  version: 22,
  name: 'container-config-extra-networks',
  up(db) {
    db.exec(`ALTER TABLE container_configs ADD COLUMN extra_networks TEXT NOT NULL DEFAULT '[]';`);
  },
};

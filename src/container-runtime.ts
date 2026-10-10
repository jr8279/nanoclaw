import { execFile } from 'child_process';
import { promisify } from 'util';

import { log } from './log.js';

const execFileAsync = promisify(execFile);

/**
 * Container runtime constants.
 *
 * This file used to claim that "all runtime-specific logic lives here so
 * swapping runtimes means changing one file" while the actual runtime logic —
 * spawn argv, mounts, hardening, kill/stop, orphan reaping — lived in
 * `container-runner.ts` and the egress module. That logic now lives behind the
 * driver seam (`src/drivers/`), which is what makes the claim true.
 *
 * What is left is the binary name, still needed by the few paths that shell
 * Docker for something that is not a session: per-group image builds and the
 * egress lockdown network.
 */

/** The container runtime binary name. */
export const CONTAINER_RUNTIME_BIN = 'docker';

/** Valid docker identifier (container or network name) — same charset docker enforces. */
function isValidDockerName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name);
}

/**
 * Connect an already-started container to additional Docker networks, beyond
 * the one it was created with — `docker run` only accepts a single
 * `--network` at creation time, so any extras are attached after the fact via
 * `docker network connect`.
 *
 * The container may not be registered with the daemon the instant the start
 * returns, so connects are retried for a few seconds to close that race.
 * Best-effort: a network that doesn't exist or a container that never comes up
 * logs a warning rather than throwing — the agent's core session must not fail
 * over an optional side network.
 */
export async function connectExtraNetworks(containerName: string, networks: string[]): Promise<void> {
  if (networks.length === 0) return;
  if (!isValidDockerName(containerName)) {
    log.warn('Skipping extra network connect: invalid container name', { containerName });
    return;
  }

  for (const network of networks) {
    if (!isValidDockerName(network)) {
      log.warn('Skipping extra network connect: invalid network name', { containerName, network });
      continue;
    }

    let connected = false;
    let lastError: unknown;
    for (let attempt = 0; attempt < 15 && !connected; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 200));
      try {
        await execFileAsync(CONTAINER_RUNTIME_BIN, ['network', 'connect', network, containerName]);
        connected = true;
      } catch (err) {
        lastError = err;
      }
    }

    if (connected) {
      log.info('Connected container to extra network', { containerName, network });
    } else {
      log.warn('Failed to connect container to extra network', { containerName, network, err: String(lastError) });
    }
  }
}

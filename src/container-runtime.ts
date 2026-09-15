/**
 * Container runtime abstraction for NanoClaw.
 * All runtime-specific logic lives here so swapping runtimes means changing one file.
 */
import { execSync } from 'child_process';
import os from 'os';

import { CONTAINER_INSTALL_LABEL } from './config.js';
import { log } from './log.js';

/** The container runtime binary name. */
export const CONTAINER_RUNTIME_BIN = 'docker';

/** CLI args needed for the container to resolve the host gateway. */
export function hostGatewayArgs(): string[] {
  // On Linux, host.docker.internal isn't built-in — add it explicitly
  if (os.platform() === 'linux') {
    return ['--add-host=host.docker.internal:host-gateway'];
  }
  return [];
}

/** Returns CLI args for a readonly bind mount. */
export function readonlyMountArgs(hostPath: string, containerPath: string): string[] {
  return ['-v', `${hostPath}:${containerPath}:ro`];
}

/** Stop a container by name. Uses execFileSync to avoid shell injection. */
export function stopContainer(name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
    throw new Error(`Invalid container name: ${name}`);
  }
  execSync(`${CONTAINER_RUNTIME_BIN} stop -t 1 ${name}`, { stdio: 'pipe' });
}

/** Valid docker identifier (container or network name) — same charset docker enforces. */
function isValidDockerName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name);
}

/**
 * Connect an already-spawned container to additional Docker networks, beyond
 * the one it was created with — `docker run` only accepts a single
 * `--network` at creation time, so any extras are attached after the fact via
 * `docker network connect`.
 *
 * `docker run` returns to the caller as soon as the process is forked, before
 * the container is registered with the daemon, so connects are retried for a
 * few seconds to close that race. Best-effort: a network that doesn't exist
 * or a container that never comes up logs a warning rather than throwing —
 * the agent's core session must not fail over an optional side network.
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
        execSync(`${CONTAINER_RUNTIME_BIN} network connect ${network} ${containerName}`, { stdio: 'pipe' });
        connected = true;
      } catch (err) {
        lastError = err;
      }
    }

    if (connected) {
      log.info('Connected container to extra network', { containerName, network });
    } else {
      log.warn('Failed to connect container to extra network', {
        containerName,
        network,
        err: String(lastError),
      });
    }
  }
}

/** Ensure the container runtime is running, starting it if needed. */
export function ensureContainerRuntimeRunning(): void {
  try {
    execSync(`${CONTAINER_RUNTIME_BIN} info`, {
      stdio: 'pipe',
      timeout: 10000,
    });
    log.debug('Container runtime already running');
  } catch (err) {
    log.error('Failed to reach container runtime', { err });
    console.error('\n╔════════════════════════════════════════════════════════════════╗');
    console.error('║  FATAL: Container runtime failed to start                      ║');
    console.error('║                                                                ║');
    console.error('║  Agents cannot run without a container runtime. To fix:        ║');
    console.error('║  1. Ensure Docker is installed and running                     ║');
    console.error('║  2. Run: docker info                                           ║');
    console.error('║  3. Restart NanoClaw                                           ║');
    console.error('╚════════════════════════════════════════════════════════════════╝\n');
    throw new Error('Container runtime is required but failed to start', {
      cause: err,
    });
  }
}

/**
 * Kill orphaned NanoClaw containers from THIS install's previous runs.
 *
 * Scoped by label `nanoclaw-install=<slug>` so a crash-looping peer install
 * cannot reap our containers, and we cannot reap theirs. The label is
 * stamped onto every container at spawn time — see container-runner.ts.
 */
export function cleanupOrphans(): void {
  try {
    const output = execSync(
      `${CONTAINER_RUNTIME_BIN} ps --filter label=${CONTAINER_INSTALL_LABEL} --format '{{.Names}}'`,
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
      },
    );
    const orphans = output.trim().split('\n').filter(Boolean);
    for (const name of orphans) {
      try {
        stopContainer(name);
      } catch {
        /* already stopped */
      }
    }
    if (orphans.length > 0) {
      log.info('Stopped orphaned containers', { count: orphans.length, names: orphans });
    }
  } catch (err) {
    log.warn('Failed to clean up orphaned containers', { err });
  }
}

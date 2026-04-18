/**
 * Verify bundled runtime assets needed by packaged Electron builds.
 *
 * Fails fast if subprocess servers are missing from dist/resources/, preventing
 * shipping a package that cannot spawn session/Pi helper processes.
 */

import { existsSync } from 'fs';
import { join } from 'path';

const ELECTRON_DIR = join(import.meta.dir, '..');
const DIST_RESOURCES_DIR = join(ELECTRON_DIR, 'dist', 'resources');

function assertExists(path: string, label: string): void {
  if (!existsSync(path)) {
    throw new Error(`${label} missing at ${path}`);
  }
}

function expectedKoffiTargets(): string[] {
  if (process.platform === 'darwin') {
    return ['darwin_arm64', 'darwin_x64'];
  }
  if (process.platform === 'win32') {
    return ['win32_x64'];
  }
  return process.arch === 'arm64'
    ? ['linux_arm64', 'musl_arm64']
    : ['linux_x64', 'musl_x64'];
}

assertExists(join(DIST_RESOURCES_DIR, 'session-mcp-server', 'index.js'), 'session-mcp-server');
assertExists(join(DIST_RESOURCES_DIR, 'pi-agent-server', 'index.js'), 'pi-agent-server');
assertExists(join(DIST_RESOURCES_DIR, 'pi-agent-server', 'node_modules', 'koffi', 'index.js'), 'koffi runtime');

for (const target of expectedKoffiTargets()) {
  assertExists(
    join(DIST_RESOURCES_DIR, 'pi-agent-server', 'node_modules', 'koffi', 'build', 'koffi', target),
    `koffi native runtime (${target})`,
  );
}

console.log('✓ Validated packaged subprocess assets');

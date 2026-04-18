/**
 * Cross-platform asset copy script.
 *
 * Copies static resources/ to dist/resources/ and stages built subprocess
 * servers required by packaged backends (session MCP + Pi agent server).
 *
 * Pi agent server uses `koffi` as an external native dependency, so we copy a
 * trimmed runtime package next to the staged server bundle. The runtime
 * resolver already falls back to `dist/resources/<server>/index.js` in
 * packaged builds, so staging generated artifacts here avoids polluting the
 * source `resources/` tree.
 */

import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';

const ELECTRON_DIR = join(import.meta.dir, '..');
const ROOT_DIR = join(ELECTRON_DIR, '..', '..');

const RESOURCES_DIR = join(ELECTRON_DIR, 'resources');
const DIST_RESOURCES_DIR = join(ELECTRON_DIR, 'dist', 'resources');

function resetDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

function requirePath(path: string, description: string): void {
  if (!existsSync(path)) {
    throw new Error(`${description} not found at ${path}`);
  }
}

function resolveKoffiSourceDir(): string {
  const directPath = join(ROOT_DIR, 'node_modules', 'koffi');
  if (existsSync(directPath)) {
    return directPath;
  }

  const bunStoreDir = join(ROOT_DIR, 'node_modules', '.bun');
  if (existsSync(bunStoreDir)) {
    for (const entry of readdirSync(bunStoreDir)) {
      if (!entry.startsWith('koffi@')) continue;
      const candidate = join(bunStoreDir, entry, 'node_modules', 'koffi');
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error(
    `koffi runtime dependency not found at ${directPath} or inside ${bunStoreDir}`,
  );
}

function stageSessionServer(): void {
  const sourcePath = join(ROOT_DIR, 'packages', 'session-mcp-server', 'dist', 'index.js');
  const destDir = join(DIST_RESOURCES_DIR, 'session-mcp-server');

  requirePath(sourcePath, 'Session MCP server build output');
  resetDir(destDir);
  copyFileSync(sourcePath, join(destDir, 'index.js'));
  console.log('✓ Staged session-mcp-server → dist/resources/session-mcp-server/');
}

function resolveKoffiBuildTargets(): string[] {
  if (process.platform === 'darwin') {
    return ['darwin_arm64', 'darwin_x64'];
  }
  if (process.platform === 'win32') {
    return ['win32_x64', 'win32_arm64'];
  }
  return ['linux_x64', 'linux_arm64', 'musl_x64', 'musl_arm64'];
}

function stagePiAgentServer(): void {
  const piSourceDir = join(ROOT_DIR, 'packages', 'pi-agent-server', 'dist');
  const piEntryPath = join(piSourceDir, 'index.js');
  const koffiSourceDir = resolveKoffiSourceDir();
  const piDestDir = join(DIST_RESOURCES_DIR, 'pi-agent-server');
  const koffiDestDir = join(piDestDir, 'node_modules', 'koffi');

  requirePath(piEntryPath, 'Pi agent server build output');

  resetDir(piDestDir);
  cpSync(piSourceDir, piDestDir, { recursive: true });

  mkdirSync(koffiDestDir, { recursive: true });
  for (const entry of ['package.json', 'index.js', 'indirect.js', 'index.d.ts', 'lib']) {
    const src = join(koffiSourceDir, entry);
    if (existsSync(src)) {
      cpSync(src, join(koffiDestDir, entry), { recursive: true });
    }
  }

  const buildRoot = join(koffiSourceDir, 'build', 'koffi');
  for (const target of resolveKoffiBuildTargets()) {
    const src = join(buildRoot, target);
    if (!existsSync(src)) continue;
    cpSync(src, join(koffiDestDir, 'build', 'koffi', target), { recursive: true });
  }

  console.log('✓ Staged pi-agent-server + koffi → dist/resources/pi-agent-server/');
}

function copyPowerShellParser(): void {
  const psParserSrc = join(ROOT_DIR, 'packages', 'shared', 'src', 'agent', 'powershell-parser.ps1');
  const psParserDest = join(DIST_RESOURCES_DIR, 'powershell-parser.ps1');
  if (!existsSync(psParserSrc)) {
    console.log('⚠ powershell-parser.ps1 copy skipped (not critical on non-Windows)');
    return;
  }
  copyFileSync(psParserSrc, psParserDest);
  console.log('✓ Copied powershell-parser.ps1 → dist/resources/');
}

cpSync(RESOURCES_DIR, DIST_RESOURCES_DIR, { recursive: true, force: true });
console.log('✓ Copied resources/ → dist/resources/');

stageSessionServer();
stagePiAgentServer();
copyPowerShellParser();

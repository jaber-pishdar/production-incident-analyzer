#!/usr/bin/env node
/**
 * Simulates the production Docker stage on the host.
 *
 * The Dockerfile production stage only ships built artifacts (dist folders)
 * plus package.json files, then runs `pnpm install --frozen-lockfile --prod`
 * with every workspace `main` patched from src/index.ts to dist/index.js.
 *
 * This script reproduces exactly that layout in a temp dir and boots the
 * API to verify the container CMD (`node apps/api/dist/index.js`) works.
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ws = ['shared', 'error-analyzer', 'performance-analyzer', 'correlation-engine', 'incident-engine'];

console.log('Building all packages first...');
execSync('pnpm -r build', { cwd: root, stdio: 'inherit' });

const dir = mkdtempSync(join(tmpdir(), 'pia-docker-sim-'));
console.log(`Simulating production layer in ${dir}`);

try {
  // 1. Root manifest + workspace config
  for (const f of ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', '.npmrc']) {
    const src = join(root, f);
    try { cpSync(src, join(dir, f)); } catch { /* optional file */ }
  }

  // 2. Copy package.json + dist for each workspace; patch main to dist/index.js
  for (const pkg of ws) {
    const dest = join(dir, 'packages', pkg);
    mkdirSync(dest, { recursive: true });
    const pj = JSON.parse(readFileSync(join(root, 'packages', pkg, 'package.json'), 'utf-8'));
    pj.main = 'dist/index.js';
    writeFileSync(join(dest, 'package.json'), JSON.stringify(pj, null, 2) + '\n');
    cpSync(join(root, 'packages', pkg, 'dist'), join(dest, 'dist'), { recursive: true });
  }
  for (const pkg of ['api']) {
    const dest = join(dir, 'apps', pkg);
    mkdirSync(dest, { recursive: true });
    cpSync(join(root, 'apps', pkg, 'package.json'), join(dest, 'package.json'));
    cpSync(join(root, 'apps', pkg, 'dist'), join(dest, 'dist'), { recursive: true });
  }
  // web dist (static, served by api)
  const webDest = join(dir, 'apps', 'web', 'dist');
  mkdirSync(webDest, { recursive: true });
  cpSync(join(root, 'apps', 'web', 'dist'), webDest, { recursive: true });

  // 3. prod install
  console.log('Running pnpm install --prod ...');
  execSync('pnpm install --frozen-lockfile --prod', { cwd: dir, stdio: 'inherit' });

  // 4. Boot API and smoke-test
  console.log('Booting API...');
  const { spawn } = await import('node:child_process');
  const api = spawn(process.execPath, ['apps/api/dist/index.js'], {
    cwd: dir, env: { ...process.env, PORT: '4312' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  api.stdout.on('data', d => out += d);
  api.stderr.on('data', d => out += d);
  await new Promise(r => setTimeout(r, 2500));

  // Smoke: GET / (frontend) and POST /api/parse with a known line
  const front = await fetch('http://localhost:4312/');
  const frontOk = front.ok && (await front.text()).includes('<!DOCTYPE html>');
  const parse = await fetch('http://localhost:4312/api/parse', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: '2026-08-22T10:15:31Z ERROR Database connection failed',
  });
  const data = await parse.json();

  api.kill();
  console.log('\n--- API output ---');
  console.log(out.trim());

  if (!frontOk) throw new Error('Frontend not served');
  if (data.entriesCount !== 1 || data.errorsCount !== 1) throw new Error('Parse failed: ' + JSON.stringify(data));

  console.log('\n=== SMOKE TEST PASSED ===');
  console.log(`  frontend: ${front.status} (index.html)`);
  console.log(`  /api/parse: ${data.entriesCount} entry, ${data.errorsCount} error`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
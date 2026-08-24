#!/usr/bin/env node
// Stop hook: typecheck the server project when server/*.ts changed this turn.
// Runs once per turn (not per edit) because a full server tsc costs ~8s.
// Blocks once per distinct error signature so a persistent error can't loop.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const stateFile = join(root, '.claude', '.typecheck-state');

const sh = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

let changed = [];
try {
  changed = sh('git status --porcelain')
    .split('\n')
    .map((l) => l.slice(3).trim())
    .filter((f) => /^server\/.*\.ts$/.test(f));
} catch {
  process.exit(0); // not a git repo / git unavailable — stay out of the way
}
if (changed.length === 0) process.exit(0);

let out = '';
let failed = false;
try {
  // execSync (shell) not execFileSync: spawning npx.cmd directly returns EINVAL on Windows/Node 20+.
  execSync('npx tsc --noEmit -p tsconfig.server.json',
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  failed = true;
  out = `${e.stdout || ''}${e.stderr || ''}`.trim();
}
if (!failed) process.exit(0);

const sig = createHash('sha1').update(out).digest('hex');
let last = '';
try { last = readFileSync(stateFile, 'utf8').trim(); } catch {}
try { mkdirSync(dirname(stateFile), { recursive: true }); writeFileSync(stateFile, sig); } catch {}

if (sig === last) process.exit(0); // already reported this exact failure — don't nag

const lines = out.split('\n').filter((l) => l.includes('error TS'));
console.error(`Server typecheck failed (${lines.length} error${lines.length === 1 ? '' : 's'}) after editing ${changed.length} server file(s):\n`);
console.error(lines.slice(0, 25).join('\n'));
if (lines.length > 25) console.error(`\n…and ${lines.length - 25} more. Full output: npx tsc --noEmit -p tsconfig.server.json`);
process.exit(2); // surface to Claude so it fixes them before finishing

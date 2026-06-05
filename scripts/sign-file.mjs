import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'node_modules', '@tauri-apps/cli', 'tauri.js');
const key = process.argv[2];
const file = process.argv[3];
const password = process.argv[4] ?? '';

if (!key || !file) {
  console.error('Usage: node scripts/sign-file.mjs <private-key.pem> <file> [password]');
  process.exit(2);
}

const env = { ...process.env };
delete env.TAURI_SIGNING_PRIVATE_KEY;
delete env.TAURI_SIGNING_PRIVATE_KEY_PATH;

const args = ['signer', 'sign', '-f', key, '-p', password, file];
const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, env, stdio: 'inherit' });
process.exit(r.status ?? 1);

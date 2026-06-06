import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'src', 'index.html'), 'utf8');
const m = html.match(/<script type="module">([\s\S]*)<\/script>\s*<\/body>/);
if (!m) {
  console.error('module block not found');
  process.exit(1);
}
const out = join(root, 'scripts', '_extracted-module.mjs');
writeFileSync(out, m[1]);
console.log('extracted', m[1].length, 'chars ->', out);

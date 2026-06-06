import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'src', 'index.html'), 'utf8');

/* ES module: import 이름과 동일한 로컬 function 선언은 SyntaxError */
const mod = html.match(/<script type="module">([\s\S]*)<\/script>\s*<\/body>/);
if (mod) {
  const body = mod[1];
  const importNames = new Set();
  for (const block of body.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*['"][^'"]+['"]/g)) {
    for (const part of block[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) importNames.add(name);
    }
  }
  const collisions = [];
  for (const name of importNames) {
    if (new RegExp(`(?:^|\\n)\\s*function\\s+${name}\\s*\\(`, 'm').test(body)) {
      collisions.push(name);
    }
  }
  if (collisions.length) {
    console.error('IMPORT/FUNCTION COLLISION (module will not load):', collisions.join(', '));
    process.exit(1);
  }
  console.log('import collisions: none');
}

const m = html.match(/Object\.assign\(window,\s*\{([\s\S]*?)\}\);/);
if (!m) {
  console.error('Object.assign block not found');
  process.exit(1);
}
const names = [...m[1].replace(/\/\/[^\n]*/g, '').matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g)]
  .map((x) => x[1])
  .filter((n) => !['window', 'Object', 'assign'].includes(n));
const missing = [];
for (const n of names) {
  const re = new RegExp(`(?:function|async function)\\s+${n}\\s*\\(|const\\s+${n}\\s*=`);
  if (!re.test(html)) missing.push(n);
}
console.log('exports:', names.length);
if (missing.length) {
  console.error('MISSING:', missing.join(', '));
  process.exit(1);
}
console.log('all exports defined');

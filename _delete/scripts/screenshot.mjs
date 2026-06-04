import { _electron as electron } from 'playwright-core';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const shotPath = path.join(APP_DIR, 'scripts', 'shot.png');

const app = await electron.launch({
  executablePath: electronBin,
  args: [APP_DIR],
  timeout: 15000,
});

// 창 로딩 대기
await new Promise(r => setTimeout(r, 4000));

const page = app.windows().find(w => !w.url().startsWith('devtools://'))
  ?? await app.firstWindow();

console.log('windows:', app.windows().map(w => w.url()));
await page.screenshot({ path: shotPath, fullPage: false });
console.log('screenshot saved:', shotPath);

await app.close();

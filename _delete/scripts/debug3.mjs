import { _electron as electron } from 'playwright-core';
import path from 'path';
import { fileURLToPath } from 'url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const out = path.join(APP_DIR, 'scripts');

const app = await electron.launch({ executablePath: bin, args: [APP_DIR], timeout: 15000 });
await new Promise(r => setTimeout(r, 4000));
const page = app.windows().find(w => !w.url().startsWith('devtools://')) ?? await app.firstWindow();

const errors = [];
page.on('console', msg => {
  if (msg.type() === 'error') errors.push(msg.text());
  else if (msg.type() === 'log') console.log('PAGE LOG:', msg.text());
});

// Skip setup
const isSetup = await page.evaluate(() => !document.getElementById('setupOverlay').classList.contains('hidden'));
if (isSetup) {
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => document.getElementById('btnNext')?.click());
    await new Promise(r => setTimeout(r, 800));
  }
  await new Promise(r => setTimeout(r, 1000));
}

console.log('dashboard visible:', await page.evaluate(() => document.getElementById('dashboard')?.classList.contains('show')));

// ── TEST A: Call openCatEditPopup DIRECTLY ──
console.log('\n=== TEST A: direct JS call ===');
await page.evaluate(() => {
  if (typeof openCatEditPopup === 'function') {
    openCatEditPopup({ clientX: 300, clientY: 300 }, 0);
    console.log('openCatEditPopup called');
  } else {
    console.log('openCatEditPopup not found!');
  }
});
await new Promise(r => setTimeout(r, 500));
const directResult = await page.evaluate(() => ({
  open: document.getElementById('catEditPopup').classList.contains('cep-open'),
  opacity: window.getComputedStyle(document.getElementById('catEditPopup')).opacity,
}));
console.log('After direct call:', directResult);
await page.screenshot({ path: `${out}/d3a_direct_open.png` });

// Close it
await page.evaluate(() => closeCatEditPopup());
await new Promise(r => setTimeout(r, 300));

// ── TEST B: Check gear element details ──
console.log('\n=== TEST B: gear element inspection ===');
const gearDetails = await page.evaluate(() => {
  const gear = document.querySelector('.cp-gear');
  if (!gear) return { found: false };
  const r = gear.getBoundingClientRect();
  const style = window.getComputedStyle(gear);
  return {
    found: true,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    pointerEvents: style.pointerEvents,
    opacity: style.opacity,
    hasOnclick: !!gear.onclick,
    tagName: gear.tagName,
  };
});
console.log('Gear details:', JSON.stringify(gearDetails, null, 2));

// ── TEST C: Click via JS (gear.click()) ──
console.log('\n=== TEST C: gear.click() via JS ===');
await page.evaluate(() => {
  const gear = document.querySelector('.cp-gear');
  if (gear) {
    console.log('Clicking gear via JS...');
    gear.click();
  }
});
await new Promise(r => setTimeout(r, 500));
const afterJsClick = await page.evaluate(() => ({
  open: document.getElementById('catEditPopup').classList.contains('cep-open'),
}));
console.log('After gear.click():', afterJsClick);
await page.screenshot({ path: `${out}/d3b_js_click.png` });

// Close if open
await page.evaluate(() => closeCatEditPopup());
await new Promise(r => setTimeout(r, 300));

// ── TEST D: Playwright locator click ──
console.log('\n=== TEST D: Playwright locator click ===');
// Mouse hover on first category header
const cpHead = page.locator('.cp-head').first();
const headBox = await cpHead.boundingBox();
console.log('cp-head bounding box:', headBox);

await cpHead.hover();
await new Promise(r => setTimeout(r, 200));
await page.screenshot({ path: `${out}/d3c_head_hover.png` });

// Click gear using mouse coordinates
const gearBox = await page.evaluate(() => {
  const g = document.querySelector('.cp-gear');
  if (!g) return null;
  const r = g.getBoundingClientRect();
  return { x: r.x + r.width/2, y: r.y + r.height/2 };
});
console.log('gear center:', gearBox);

if (gearBox) {
  await page.mouse.click(gearBox.x, gearBox.y);
  await new Promise(r => setTimeout(r, 500));
  const afterMouseClick = await page.evaluate(() => ({
    open: document.getElementById('catEditPopup').classList.contains('cep-open'),
  }));
  console.log('After mouse.click():', afterMouseClick);
  await page.screenshot({ path: `${out}/d3d_mouse_click.png` });
}

if (errors.length) console.log('\nConsole errors:', errors);
else console.log('\nNo console errors ✅');

await app.close();
console.log('done');

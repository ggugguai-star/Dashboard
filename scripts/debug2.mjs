import { _electron as electron } from 'playwright-core';
import path from 'path';
import { fileURLToPath } from 'url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const out = path.join(APP_DIR, 'scripts');

const app = await electron.launch({ executablePath: bin, args: [APP_DIR], timeout: 15000 });
await new Promise(r => setTimeout(r, 4000));
const page = app.windows().find(w => !w.url().startsWith('devtools://')) ?? await app.firstWindow();

// 콘솔 에러 수집
const errors = [];
page.on('console', msg => {
  if (msg.type() === 'error') errors.push(msg.text());
});

// 초기 화면
await page.screenshot({ path: `${out}/d2a_initial.png` });
console.log('d2a: initial screen');

// 설정 마법사인지 대시보드인지 확인 (setupOverlay가 active인지로 판단)
const isSetup = await page.evaluate(() => {
  const setup = document.getElementById('setupOverlay');
  if (!setup) return false;
  return !setup.classList.contains('hidden');
});
console.log('is setup wizard:', isSetup);

if (isSetup) {
  // 마법사 3단계 스킵
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const btn = document.getElementById('btnNext');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 800));
  }
  await new Promise(r => setTimeout(r, 1000));
}

await page.screenshot({ path: `${out}/d2b_dashboard.png` });
console.log('d2b: dashboard');

// 대시보드가 보이는지 확인
const dashVisible = await page.evaluate(() => {
  const dash = document.getElementById('dashboard');
  return dash && dash.classList.contains('show');
});
console.log('dashboard visible:', dashVisible);

const catPanels = await page.evaluate(() => {
  return document.querySelectorAll('.cat-panel').length;
});
console.log('cat panels:', catPanels);

// ── 테스트 1: 카테고리 gear 버튼 ──
const gearCount = await page.evaluate(() => document.querySelectorAll('.cp-gear').length);
console.log('gear buttons:', gearCount);

if (gearCount > 0) {
  // 첫번째 gear hover + click
  const gear = page.locator('.cp-gear').first();
  await gear.hover();
  await new Promise(r => setTimeout(r, 200));
  await gear.click();
  await new Promise(r => setTimeout(r, 400));
} else {
  // JS로 직접 첫번째 카테고리 gear 오픈 시도
  console.log('No gear found via selector, trying via JS...');
  await page.evaluate(() => {
    if (typeof openCatEditPopup === 'function') openCatEditPopup({ clientX: 200, clientY: 200 }, 0);
  });
  await new Promise(r => setTimeout(r, 400));
}

const popupInfo = await page.evaluate(() => {
  const p = document.getElementById('catEditPopup');
  if (!p) return { found: false };
  const style = window.getComputedStyle(p);
  return {
    found: true,
    open: p.classList.contains('cep-open'),
    opacity: style.opacity,
    visibility: style.visibility,
  };
});
console.log('catEditPopup state:', JSON.stringify(popupInfo));
await page.screenshot({ path: `${out}/d2c_after_gear.png` });
console.log('d2c: after gear interaction');

if (popupInfo.open) {
  console.log('✅ catEditPopup opened!');
  // 저장 버튼 클릭
  await page.evaluate(() => { document.querySelector('.cep-save')?.click(); });
  await new Promise(r => setTimeout(r, 300));
  const afterSave = await page.evaluate(() => ({
    open: document.getElementById('catEditPopup').classList.contains('cep-open')
  }));
  console.log('after save (should be false):', JSON.stringify(afterSave));
} else {
  console.log('❌ catEditPopup did NOT open');
}

// ── 테스트 2: 설정 창 Apply/Cancel ──
await page.evaluate(() => openSettings());
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: `${out}/d2d_settings.png` });
console.log('d2d: settings open');

// Cancel 클릭
await page.locator('.sp-cancel-btn').click();
await new Promise(r => setTimeout(r, 300));
const afterCancel = await page.evaluate(() => ({
  open: document.getElementById('settingsOverlay').classList.contains('sp-open')
}));
console.log('after cancel (should be false):', afterCancel);

// Apply 클릭
await page.evaluate(() => openSettings());
await new Promise(r => setTimeout(r, 300));
await page.locator('.sp-apply-btn').click();
await new Promise(r => setTimeout(r, 300));
const afterApply = await page.evaluate(() => ({
  open: document.getElementById('settingsOverlay').classList.contains('sp-open')
}));
console.log('after apply (should be false):', afterApply);
await page.screenshot({ path: `${out}/d2e_after_apply.png` });
console.log('d2e: after apply');

if (errors.length) console.log('\nConsole errors:', errors);
else console.log('\nNo console errors ✅');

await app.close();
console.log('done');

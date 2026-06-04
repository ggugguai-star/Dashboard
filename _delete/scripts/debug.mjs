import { _electron as electron } from 'playwright-core';
import path from 'path';
import { fileURLToPath } from 'url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const out = path.join(APP_DIR, 'scripts');

const app = await electron.launch({ executablePath: bin, args: [APP_DIR], timeout: 15000 });
await new Promise(r => setTimeout(r, 4000));
const page = app.windows().find(w => !w.url().startsWith('devtools://')) ?? await app.firstWindow();

// 초기 화면 스크린샷
await page.screenshot({ path: `${out}/d1_initial.png` });
console.log('d1: initial');

// 설정창 건너뛰기 (대시보드 직접 표시)
const hasDashboard = await page.evaluate(() => !!document.getElementById('catZone'));
if (!hasDashboard) {
  // 초기 설정화면이면 다음 클릭으로 넘어가기
  await page.evaluate(() => {
    const btn = document.getElementById('btnNext');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  await page.evaluate(() => {
    const btn = document.getElementById('btnNext');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 1000));
}

await page.screenshot({ path: `${out}/d2_dashboard.png` });
console.log('d2: dashboard');

// 기어 버튼 찾아서 클릭 시도
const gearInfo = await page.evaluate(() => {
  const gear = document.querySelector('.cp-gear');
  if (!gear) return { found: false };
  const rect = gear.getBoundingClientRect();
  const style = window.getComputedStyle(gear);
  return {
    found: true,
    rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    opacity: style.opacity,
    display: style.display,
    pointerEvents: style.pointerEvents,
    zIndex: style.zIndex,
  };
});
console.log('gear info:', JSON.stringify(gearInfo, null, 2));

// catEditPopup 상태
const popupInfo = await page.evaluate(() => {
  const p = document.getElementById('catEditPopup');
  if (!p) return { found: false };
  const style = window.getComputedStyle(p);
  return {
    found: true,
    display: style.display,
    zIndex: style.zIndex,
    classList: p.className,
    inlineStyle: p.style.cssText,
  };
});
console.log('popup info:', JSON.stringify(popupInfo, null, 2));

// 기어 버튼 강제 클릭 (JS로)
await page.evaluate(() => {
  const gear = document.querySelector('.cp-gear');
  if (gear) gear.click();
});
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: `${out}/d3_after_gear_click.png` });
console.log('d3: after gear click');

// 팝업 상태 재확인
const popupAfter = await page.evaluate(() => {
  const p = document.getElementById('catEditPopup');
  if (!p) return { found: false };
  const style = window.getComputedStyle(p);
  return {
    display: style.display,
    zIndex: style.zIndex,
    classList: p.className,
    inlineStyle: p.style.cssText,
    left: style.left,
    top: style.top,
  };
});
console.log('popup after click:', JSON.stringify(popupAfter, null, 2));

// 콘솔 에러 수집
const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

// 설정창 열기 및 닫기 테스트
await page.evaluate(() => {
  if (typeof openSettings === 'function') openSettings();
});
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: `${out}/d4_settings_open.png` });
console.log('d4: settings open');

const settingsInfo = await page.evaluate(() => {
  const s = document.getElementById('settingsOverlay');
  if (!s) return { found: false };
  const style = window.getComputedStyle(s);
  return { found: true, opacity: style.opacity, visibility: style.visibility, display: style.display, classList: s.className };
});
console.log('settings overlay:', JSON.stringify(settingsInfo, null, 2));

// 닫기 버튼 클릭
await page.evaluate(() => {
  if (typeof closeSettings === 'function') closeSettings();
});
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: `${out}/d5_settings_closed.png` });
console.log('d5: settings after close');

const settingsAfter = await page.evaluate(() => {
  const s = document.getElementById('settingsOverlay');
  const style = window.getComputedStyle(s);
  return { opacity: style.opacity, visibility: style.visibility, classList: s.className };
});
console.log('settings after close:', JSON.stringify(settingsAfter, null, 2));

await app.close();
console.log('done');

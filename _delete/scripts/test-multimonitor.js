/**
 * test-multimonitor.js — 멀티모니터 드래그 핸들 UI 확인
 */
const { _electron: electron } = require('playwright-core');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

(async () => {
  const tmpDir = path.join(os.tmpdir(), 'dash-mm-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..'), `--user-data-dir=${tmpDir}`],
    cwd:  path.join(__dirname, '..'),
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  await win.evaluate(() => {
    localStorage.setItem('setupDone', '1');
    localStorage.setItem('appCats', JSON.stringify([
      { name:'업무', color:'#f87171', tc:'#dc2626', lightColor:'#fee2e2', icon:'📁', sub:'', items:[], type:'normal', driveRootId:'' },
    ]));
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2000);

  // topbar drag 속성 확인
  const tbDrag   = await win.evaluate(() =>
    getComputedStyle(document.querySelector('.topbar')).webkitAppRegion
  );
  const btnDrag  = await win.evaluate(() =>
    getComputedStyle(document.querySelector('.tb-btn')).webkitAppRegion
  );
  const chipDrag = await win.evaluate(() =>
    getComputedStyle(document.querySelector('.g-chip')).webkitAppRegion
  );

  console.log('topbar app-region :', tbDrag);    // "drag"
  console.log('.tb-btn app-region:', btnDrag);   // "no-drag"
  console.log('.g-chip app-region :', chipDrag); // "no-drag"

  // 스크린샷
  await win.screenshot({ path: 'scripts/multimonitor-topbar.png' });
  console.log('Screenshot saved: scripts/multimonitor-topbar.png');

  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('\nDone.');
})();

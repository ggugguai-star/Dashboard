/**
 * test-update-overlay.js — 업데이트 오버레이 UI 테스트
 */
const { _electron: electron } = require('playwright-core');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

(async () => {
  const tmpDir = path.join(os.tmpdir(), 'dash-overlay-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..'), `--user-data-dir=${tmpDir}`],
    cwd:  path.join(__dirname, '..'),
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  // 설정 완료 주입 → 리로드
  await win.evaluate(() => {
    localStorage.setItem('setupDone', '1');
    localStorage.setItem('appCats', JSON.stringify([
      { name:'업무', color:'#f87171', tc:'#dc2626', lightColor:'#fee2e2', icon:'📁', sub:'', items:[], type:'normal', driveRootId:'' },
    ]));
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2000);

  // 스크린샷 1: 기본 화면
  await win.screenshot({ path: 'scripts/overlay-before.png' });
  console.log('Screenshot 1: 기본 화면 저장');

  // JS로 직접 오버레이 표시 (업데이트 다운로드 완료 시뮬레이션)
  await win.evaluate(() => {
    // _ubState와 _ubVersion 설정
    _ubState = 'downloaded';
    _ubVersion = '1.3.0';
  });

  // onUbBtnClick 호출 (installUpdate는 mock으로 대체)
  await win.evaluate(() => {
    // installUpdate를 mock으로 교체 (앱이 꺼지지 않도록)
    if (window.api) {
      window.api._origInstallUpdate = window.api.installUpdate;
      window.api.installUpdate = () => console.log('[mock] installUpdate called');
    }
    onUbBtnClick();
  });

  await win.waitForTimeout(800);

  // 스크린샷 2: 오버레이 표시 후
  await win.screenshot({ path: 'scripts/overlay-active.png' });
  console.log('Screenshot 2: 오버레이 활성 상태 저장');

  // 오버레이 상태 확인
  const overlayVisible = await win.evaluate(() => {
    const el = document.getElementById('updateOverlay');
    return el ? el.classList.contains('uo-show') : false;
  });
  const badgeText = await win.evaluate(() => {
    return document.getElementById('uoVersionBadge')?.textContent || '';
  });

  console.log('오버레이 표시됨:', overlayVisible);
  console.log('버전 배지 텍스트:', badgeText);

  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('\nDone.');
})();

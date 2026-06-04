/**
 * test-rename.js — 항목 이름 수정 팝업 UI 테스트
 */
const { _electron: electron } = require('playwright-core');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

(async () => {
  const tmpDir = path.join(os.tmpdir(), 'dash-rename-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..'), `--user-data-dir=${tmpDir}`],
    cwd:  path.join(__dirname, '..'),
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  // 설정 완료 + 카테고리 + 아이템 주입
  await win.evaluate(() => {
    localStorage.setItem('setupDone', '1');
    localStorage.setItem('appCats', JSON.stringify([
      {
        name:'업무', color:'#f87171', tc:'#dc2626', lightColor:'#fee2e2',
        icon:'📁', sub:'', type:'normal', driveRootId:'',
        items:[
          { lbl:'2026 정기시험 문제', path:'C:\\test\\exam.hwp', icon:'📝', tag:'HWP' },
          { lbl:'성적 분석표', path:'C:\\test\\grade.xlsx', icon:'📊', tag:'XLSX' },
        ]
      },
    ]));
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2000);

  // 스크린샷 1: 기본 상태
  await win.screenshot({ path: 'scripts/rename-before.png' });
  console.log('Screenshot 1: 기본 상태');

  // 첫 번째 아이템에서 우클릭 → 컨텍스트 메뉴 열기
  const firstRow = await win.$('.item');
  if (!firstRow) { console.error('.item 없음'); await app.close(); return; }

  await firstRow.dispatchEvent('contextmenu', { clientX: 200, clientY: 200 });
  await win.waitForTimeout(300);

  await win.screenshot({ path: 'scripts/rename-ctx.png' });
  console.log('Screenshot 2: 컨텍스트 메뉴');

  // "이름 수정" 클릭
  const ctxItems = await win.$$('.ctx-i');
  // 인덱스 2가 "이름 수정" (열기, 복사, 이름수정, 삭제)
  if (ctxItems[2]) {
    await ctxItems[2].click();
    await win.waitForTimeout(300);
  }

  await win.screenshot({ path: 'scripts/rename-popup.png' });
  console.log('Screenshot 3: 이름 수정 팝업');

  // 팝업 상태 확인
  const popupVisible = await win.evaluate(() =>
    document.getElementById('renamePopup')?.style.display !== 'none'
  );
  const inputValue = await win.evaluate(() =>
    document.getElementById('renameInput')?.value
  );
  console.log('팝업 표시됨:', popupVisible);
  console.log('입력값 (현재 이름):', inputValue);

  // 새 이름 입력 후 확인
  const input = await win.$('#renameInput');
  if (input) {
    await input.fill('2026 정기시험 문제 (수정됨)');
    await input.press('Enter');
    await win.waitForTimeout(400);
  }

  await win.screenshot({ path: 'scripts/rename-after.png' });
  console.log('Screenshot 4: 이름 변경 후');

  // 변경된 이름 확인
  const updatedLabel = await win.evaluate(() => {
    const rows = document.querySelectorAll('.item .item-lbl');
    return rows[0]?.textContent || '';
  });
  console.log('변경된 표시 이름:', updatedLabel);

  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('\nDone.');
})();

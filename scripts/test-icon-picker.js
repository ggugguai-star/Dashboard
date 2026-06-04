const { _electron: electron } = require('playwright-core');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

(async () => {
  const tmpDir = path.join(os.tmpdir(), 'dash-icp-' + Date.now());
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
    localStorage.setItem('appCats', JSON.stringify([{
      name:'업무', color:'#f87171', tc:'#dc2626', lightColor:'#fee2e2',
      icon:'📁', sub:'', type:'normal', driveRootId:'',
      items:[{ lbl:'정기시험 문제', path:'C:\\test\\exam.hwp', ic:'📝', tag:'HWP' }]
    }]));
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2000);

  // 우클릭 → 컨텍스트 메뉴
  const firstRow = await win.$('.item');
  await firstRow.dispatchEvent('contextmenu', { clientX: 300, clientY: 200 });
  await win.waitForTimeout(300);
  await win.screenshot({ path: 'scripts/icp-ctx.png' });

  // 아이콘 수정 클릭 (인덱스 3)
  const ctxItems = await win.$$('.ctx-i');
  await ctxItems[3].click();
  await win.waitForTimeout(350);
  await win.screenshot({ path: 'scripts/icp-open.png' });

  // 팝업 상태 확인
  const popupVisible = await win.evaluate(() =>
    document.getElementById('icpPopup')?.style.display !== 'none'
  );
  const tabCount = await win.evaluate(() =>
    document.getElementById('icpTabs')?.children.length
  );
  const iconCount = await win.evaluate(() =>
    document.getElementById('icpGrid')?.children.length
  );
  console.log('팝업 표시:', popupVisible);
  console.log('탭 수:', tabCount);
  console.log('아이콘 수 (첫 페이지):', iconCount);

  // 두 번째 탭 클릭
  const tabs = await win.$$('.icp-tab');
  if (tabs[1]) { await tabs[1].click(); await win.waitForTimeout(200); }
  await win.screenshot({ path: 'scripts/icp-tab2.png' });

  // 아이콘 하나 선택
  const icons = await win.$$('.icp-icon-btn');
  if (icons[3]) { await icons[3].click(); await win.waitForTimeout(150); }
  const selected = await win.evaluate(() => {
    const sel = document.querySelector('.icp-icon-btn.icp-sel');
    return sel?.textContent || '';
  });
  console.log('선택된 아이콘:', selected);

  await win.screenshot({ path: 'scripts/icp-selected.png' });

  // 확인 클릭
  await win.click('.icp-confirm-btn');
  await win.waitForTimeout(400);
  await win.screenshot({ path: 'scripts/icp-applied.png' });

  const newIcon = await win.evaluate(() =>
    document.querySelector('.item .item-ico')?.textContent?.trim() || ''
  );
  console.log('변경된 아이콘:', newIcon);

  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('\nDone.');
})();

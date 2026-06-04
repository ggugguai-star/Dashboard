const { _electron: electron } = require('playwright-core');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

(async () => {
  const tmpDir = path.join(os.tmpdir(), 'dash-icp2-' + Date.now());
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

  // JS로 직접 팝업 열기 (위치를 화면 중앙으로)
  await win.evaluate(() => {
    _ctxItem = CATS[0]?.items[0];
    _ctxCat  = CATS[0];
    showIconPicker(window.innerWidth/2 - 154, 60);
  });
  await win.waitForTimeout(400);
  await win.screenshot({ path: 'scripts/icp2-open.png' });
  console.log('Screenshot: 팝업 오픈');

  // 탭 2 (교육/학습) 클릭
  await win.evaluate(() => {
    document.querySelectorAll('.icp-tab')[1]?.click();
  });
  await win.waitForTimeout(200);
  await win.screenshot({ path: 'scripts/icp2-tab2.png' });
  console.log('Screenshot: 탭2 (교육/학습)');

  // 아이콘 선택 (🏆)
  await win.evaluate(() => {
    const icons = document.querySelectorAll('.icp-icon-btn');
    icons[12]?.click(); // 🏆
  });
  await win.waitForTimeout(150);
  await win.screenshot({ path: 'scripts/icp2-selected.png' });

  const selected = await win.evaluate(() => {
    const s = document.querySelector('.icp-icon-btn.icp-sel');
    return s?.textContent;
  });
  const preview = await win.evaluate(() =>
    document.getElementById('icpPreviewBox')?.textContent
  );
  console.log('선택된 아이콘:', selected, '| 프리뷰:', preview);

  // 탭 목록 확인
  const tabs = await win.evaluate(() =>
    [...document.querySelectorAll('.icp-tab')].map(t=>t.textContent)
  );
  console.log('탭 목록:', tabs);

  // JS로 confirmIconPicker 호출
  await win.evaluate(() => confirmIconPicker());
  await win.waitForTimeout(400);
  await win.screenshot({ path: 'scripts/icp2-applied.png' });
  console.log('Screenshot: 아이콘 적용 후');

  const newIcon = await win.evaluate(() =>
    CATS[0]?.items[0]?.ic
  );
  console.log('저장된 아이콘:', newIcon);

  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('\nDone.');
})();

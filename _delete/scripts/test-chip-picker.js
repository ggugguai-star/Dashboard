/**
 * test-chip-picker.js — 날짜/시간 칩 피커 UI 테스트
 */
const { _electron: electron } = require('playwright-core');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

(async () => {
  const tmpDir = path.join(os.tmpdir(), 'dash-chip-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..'), `--user-data-dir=${tmpDir}`],
    cwd:  path.join(__dirname, '..'),
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  // 설정 완료 + 기본 카테고리 주입 → 리로드
  await win.evaluate(() => {
    localStorage.setItem('setupDone','1');
    localStorage.setItem('appCats', JSON.stringify([
      {name:'업무',color:'#f87171',tc:'#dc2626',lightColor:'#fee2e2',icon:'📁',sub:'',items:[],type:'normal',driveRootId:''},
    ]));
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2000);

  // 캘린더 날짜 클릭 → 일정 추가 다이얼로그 열기
  const calDay = await win.$('.cal-day:not(.other-month)');
  if(calDay){
    await calDay.click();
    await win.waitForTimeout(400);
  } else {
    await win.evaluate(() => { if(typeof openEvDialog==='function') openEvDialog(2026,4,29); });
    await win.waitForTimeout(400);
  }

  const dialogOpen = await win.evaluate(() => !!document.getElementById('evDialog')?.classList.contains('evd-open'));
  console.log('Dialog open:', dialogOpen);
  await win.screenshot({ path:'scripts/chip-dialog.png' });

  // 날짜 칩 확인
  const dateChipText = await win.evaluate(() => document.getElementById('evdDateChip')?.textContent);
  console.log('Date chip text:', dateChipText);

  // 날짜 칩 클릭 → 달력 팝업 열림 확인
  const dateChip = await win.$('#evdDateChip');
  if(dateChip){ await dateChip.click(); await win.waitForTimeout(300); }

  const datePickerOpen = await win.evaluate(() => document.getElementById('evdDatePicker')?.classList.contains('dp-open'));
  console.log('Date picker open:', datePickerOpen);
  await win.screenshot({ path:'scripts/chip-datepicker.png' });

  // 날짜 선택 (첫 번째 클릭 가능한 날)
  await win.evaluate(() => {
    const days = [...document.querySelectorAll('.evd-dp-day:not(.dp-empty)')];
    if(days[2]) days[2].dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
  });
  await win.waitForTimeout(200);

  // 달력 닫히고 날짜 업데이트 확인
  const afterDateText = await win.evaluate(() => document.getElementById('evdDateChip')?.textContent);
  console.log('After date select:', afterDateText);
  const pickerClosed = await win.evaluate(() => !document.getElementById('evdDatePicker')?.classList.contains('dp-open'));
  console.log('Picker closed after select:', pickerClosed);

  // 시간 칩 클릭 → 드롭다운 확인
  const startChip = await win.$('#evdStartChip');
  if(startChip){ await startChip.click(); await win.waitForTimeout(300); }

  const timePickerOpen = await win.evaluate(() => document.getElementById('evdTimePicker')?.classList.contains('tp-open'));
  const timeItemCount  = await win.evaluate(() => document.querySelectorAll('.evd-tp-item').length);
  console.log('Time picker open:', timePickerOpen, '| items:', timeItemCount);
  await win.screenshot({ path:'scripts/chip-timepicker.png' });

  await app.close();
  fs.rmSync(tmpDir, { recursive:true, force:true });
  console.log('\nDone.');
})();

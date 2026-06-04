/**
 * 알림 기능 테스트 스크립트 (Playwright Electron)
 * 실행: node scripts/test-alarm.js
 */
const { _electron: electron } = require('playwright-core');
const path = require('path');

async function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function toLocalDT(date){
  const pad = n => String(n).padStart(2,'0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

let passed = 0, failed = 0;
function ok(label, value){
  if(value){ console.log(`  ✅ ${label}`); passed++; }
  else      { console.log(`  ❌ ${label} — FAIL`); failed++; }
}

(async () => {
  console.log('🚀 앱 실행 중...');
  // 격리된 임시 userData 디렉토리 사용 (기존 앱 데이터와 충돌 방지)
  const tmpData = require('os').tmpdir() + '\\alarm-test-' + Date.now();
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'main.js'), `--user-data-dir=${tmpData}`],
    env: { ...process.env, ELECTRON_IS_DEV: '0' }
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await sleep(1500);

  // 셋업 완료 + 테스트 데이터 주입
  console.log('[Setup] 테스트 데이터 주입');
  await win.evaluate(() => {
    localStorage.setItem('setupDone', '1');
    localStorage.setItem('appTodos', JSON.stringify([
      { id: 9001, text: '알림 테스트 할 일', done: false, alarmDT: '' }
    ]));
    localStorage.setItem('calAlarms', '{}');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await sleep(2000);

  // DOM 상태 진단
  const domDiag = await win.evaluate(() => ({
    setupVisible:  !document.getElementById('setupOverlay').classList.contains('hidden'),
    dashVisible:   document.getElementById('dashboard').classList.contains('show'),
    todoListHTML:  document.getElementById('todoList')?.innerHTML?.slice(0, 200) || '(없음)',
    todoItemsLen:  window.todoItems?.length,
    todoItemsData: JSON.stringify(window.todoItems?.slice(0,2)),
    setupDoneLS:   localStorage.getItem('setupDone'),
    appTodosLS:    localStorage.getItem('appTodos')?.slice(0,100),
  }));
  console.log('DOM 진단:', JSON.stringify(domDiag, null, 2));

  // 대시보드가 안 보이면 initDashboard 수동 호출
  if(!domDiag.dashVisible || !domDiag.todoItemsLen){
    console.log('[Fix] initDashboard 수동 호출');
    await win.evaluate(() => {
      document.getElementById('setupOverlay').classList.add('hidden');
      document.getElementById('dashboard').classList.add('show');
      if(typeof loadAppData === 'function') loadAppData?.();
      if(typeof initDashboard === 'function') initDashboard();
    });
    await sleep(1000);
  }

  // ══════════════════════════════════════
  console.log('\n── 테스트 1: 대시보드 로드 ──');
  ok('대시보드 표시', await win.isVisible('#dashboard'));
  ok('투두 리스트 표시', await win.isVisible('#todoList'));

  // ══════════════════════════════════════
  console.log('\n── 테스트 2: 투두 벨 버튼 ──');
  // 벨 버튼이 있는지 — todo-item이 없으면 먼저 추가
  let hasTodoItem = !!await win.$('.todo-item');
  if(!hasTodoItem){
    console.log('  [Fix] todoItems 직접 주입 후 render');
    await win.evaluate(() => {
      window.todoItems = [{ id: 9001, text: '알림 테스트 할 일', done: false, alarmDT: '' }];
      renderTodoList();
    });
    await sleep(500);
    hasTodoItem = !!await win.$('.todo-item');
  }
  ok('투두 아이템 표시', hasTodoItem);
  ok('벨 버튼 존재', !!await win.$('.todo-bell'));
  ok('벨 비활성 상태', !(await win.$('.todo-bell.bell-on')));

  // ══════════════════════════════════════
  console.log('\n── 테스트 3: 알림 설정 미니 팝업 ──');
  await win.hover('.todo-item');
  await sleep(200);
  await win.click('.todo-bell');
  await sleep(400);

  ok('미니 팝업 열림', !!await win.$('#alarmMiniPopup.amp-open'));
  const itemTxt = await win.$eval('#ampItemText', el => el.textContent.trim());
  ok(`할 일 텍스트 표시: "${itemTxt}"`, itemTxt === '알림 테스트 할 일');

  const dtDefault = await win.$eval('#ampDtInput', el => el.value);
  ok('기본 시간 자동 입력됨', !!dtDefault);
  console.log(`    → 기본값: ${dtDefault}`);

  // 현재 시간 + 2분으로 저장 (분 단위 미래)
  const futureTime = toLocalDT(new Date(Date.now() + 2 * 60 * 1000));
  await win.fill('#ampDtInput', futureTime);
  await sleep(100);
  await win.click('.amp-btn-save');
  await sleep(400);

  ok('팝업 닫힘', !(await win.$('#alarmMiniPopup.amp-open')));

  const savedAlarm = await win.evaluate(() =>
    window.todoItems?.find(t => t.id === 9001)?.alarmDT || ''
  );
  ok('alarmDT 저장됨', !!savedAlarm);
  console.log(`    → 저장된 alarmDT: ${savedAlarm}`);

  ok('벨 활성 상태(보라색)', !!await win.$('.todo-bell.bell-on'));

  // ══════════════════════════════════════
  console.log('\n── 테스트 4: 알림 오버레이 발화 ──');
  await win.evaluate(() => {
    const pad = n => String(n).padStart(2,'0');
    const past = new Date(Date.now() - 60 * 1000); // STALE 범위 안 (1분 전)
    const dt = `${past.getFullYear()}-${pad(past.getMonth()+1)}-${pad(past.getDate())}T${pad(past.getHours())}:${pad(past.getMinutes())}`;
    const item = window.todoItems?.find(t => t.id === 9001);
    if(item) item.alarmDT = dt;
    if(typeof checkAlarms === 'function') checkAlarms();
  });
  await sleep(600);

  ok('알림 오버레이 표시', await win.isVisible('#alarmOverlay.alarm-show'));
  const title = await win.$eval('#alarmCardTitle', el => el.textContent.trim());
  ok(`알림 제목: "${title}"`, title === '알림 테스트 할 일');
  const cardType = await win.$eval('#alarmCardType', el => el.textContent.trim());
  ok('알림 타입 (할 일)', cardType.includes('할 일'));
  const cardTime = await win.$eval('#alarmCardTime', el => el.textContent.trim());
  ok('알림 시간 표시', !!cardTime);
  console.log(`    → 알림 시간: ${cardTime}`);

  // ══════════════════════════════════════
  console.log('\n── 테스트 5: 확인 버튼으로 닫기 ──');
  await win.click('.alarm-dismiss-btn');
  await sleep(500);
  ok('오버레이 닫힘', !(await win.isVisible('#alarmOverlay.alarm-show')));
  const alarmAfter = await win.evaluate(() =>
    window.todoItems?.find(t => t.id === 9001)?.alarmDT || ''
  );
  ok('발화 후 alarmDT 자동 제거', alarmAfter === '');

  // ══════════════════════════════════════
  console.log('\n── 테스트 6: 알림 해제 ──');
  await win.evaluate(() => {
    const item = window.todoItems?.find(t => t.id === 9001);
    if(item) item.alarmDT = '2099-12-31T23:59';
    if(typeof renderTodoList === 'function') renderTodoList();
  });
  await sleep(300);
  await win.hover('.todo-item');
  await sleep(200);
  const bellOn = await win.$('.todo-bell.bell-on');
  ok('벨 활성 확인', !!bellOn);
  if(bellOn) await win.click('.todo-bell.bell-on');
  await sleep(300);
  ok('팝업 열림', !!await win.$('#alarmMiniPopup.amp-open'));
  ok('해제 버튼 활성화', !(await win.$eval('#ampClearBtn', el => el.disabled)));
  await win.click('#ampClearBtn');
  await sleep(300);
  const cleared = await win.evaluate(() =>
    window.todoItems?.find(t => t.id === 9001)?.alarmDT || ''
  );
  ok('해제 후 alarmDT 비어있음', cleared === '');

  // ══════════════════════════════════════
  console.log('\n── 테스트 7: 캘린더 이벤트 다이얼로그 알림 ──');
  await win.evaluate(() => {
    if(typeof openEvDialog === 'function') openEvDialog(2026, 4, 28);
  });
  await sleep(500);
  ok('이벤트 다이얼로그 열림', await win.isVisible('#evDialog.evd-open'));
  ok('알림 행 존재', !!await win.$('#evdAlarmRow'));
  ok('알림 체크박스 존재', !!await win.$('#evdAlarmChk'));

  const chkInit = await win.$eval('#evdAlarmChk', el => el.checked);
  ok('체크박스 초기값 false', !chkInit);
  ok('알림 시간 입력창 초기 숨김', !(await win.isVisible('#evdAlarmDT')));

  await win.click('#evdAlarmChk');
  await sleep(200);
  ok('체크 후 입력창 표시', await win.isVisible('#evdAlarmDT'));
  const alarmDtFilled = await win.$eval('#evdAlarmDT', el => el.value);
  ok('이벤트 시작 시간으로 자동 세팅', !!alarmDtFilled);
  console.log(`    → 알림 기본값: ${alarmDtFilled}`);

  await win.click('#evdAlarmChk');
  await sleep(200);
  ok('언체크 후 입력창 다시 숨김', !(await win.isVisible('#evdAlarmDT')));

  await win.click('#evDialog .evd-close-btn');

  // ══════════════════════════════════════
  console.log('\n══════════════════════════════════');
  console.log(`결과: ✅ ${passed}개 통과 / ❌ ${failed}개 실패`);
  console.log('══════════════════════════════════\n');

  await app.close();
  // 임시 데이터 삭제
  try{ require('fs').rmSync(tmpData, { recursive: true, force: true }); } catch(e){}
  if(failed > 0) process.exit(1);
})().catch(err => {
  console.error('\n❌ 오류 발생:', err.message);
  process.exit(1);
});

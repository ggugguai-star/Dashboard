/**
 * test-panel-drag.js
 * 카테고리 패널 상단 바를 드래그해서 순서 변경 확인
 */
const { _electron: electron } = require('playwright-core');
const path = require('path');
const os = require('os');
const fs = require('fs');

(async () => {
  const tmpDir = path.join(os.tmpdir(), 'dash-panel-drag-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const app = await electron.launch({
    args: [ path.join(__dirname, '..'), `--user-data-dir=${tmpDir}` ],
    cwd: path.join(__dirname, '..'),
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1500);

  // 초기 설정 마법사 스킵 — localStorage에 더미 데이터 주입
  await win.evaluate(() => {
    // 최소 설정값 주입해서 초기 마법사 건너뜀
    const defaultCats = [
      { name:'카테고리 1', color:'#f87171', tc:'#dc2626', lightColor:'#fee2e2', icon:'📁', sub:'', items:[], type:'normal', driveRootId:'' },
      { name:'카테고리 2', color:'#60a5fa', tc:'#2563eb', lightColor:'#dbeafe', icon:'📁', sub:'', items:[], type:'normal', driveRootId:'' },
      { name:'카테고리 3', color:'#34d399', tc:'#059669', lightColor:'#d1fae5', icon:'📁', sub:'', items:[], type:'normal', driveRootId:'' },
    ];
    localStorage.setItem('appCats', JSON.stringify(defaultCats));
    localStorage.setItem('setupDone', '1');
    localStorage.setItem('monitorW', '1920');
    localStorage.setItem('monitorH', '1080');
    localStorage.setItem('appScale', '100');
  });

  // 페이지 리로드해서 메인 대시보드 진입
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2500);

  // 메인 대시보드인지 확인
  const hasCatPanels = await win.evaluate(() => document.querySelectorAll('.cat-panel').length);
  console.log('Cat panels found:', hasCatPanels);

  if (hasCatPanels === 0) {
    // 여전히 마법사 화면이면 JS로 직접 initDashboard 호출 시도
    await win.evaluate(() => {
      if (typeof initDashboard === 'function') initDashboard();
    });
    await win.waitForTimeout(1500);
  }

  // 초기 카테고리 순서
  const beforeOrder = await win.evaluate(() =>
    [...document.querySelectorAll('.cp-name')].map(el => el.textContent.trim())
  );
  console.log('Before order:', beforeOrder);

  // drag bar 존재 확인
  const barCount = await win.evaluate(() => document.querySelectorAll('.cp-drag-bar').length);
  console.log('Drag bars found:', barCount);

  await win.screenshot({ path: 'scripts/panel-drag-before.png' });

  if (barCount === 0) {
    console.error('No drag bars found!');
    await app.close();
    return;
  }

  // 패널 0번 drag bar 위치
  const bar0 = await win.evaluate(() => {
    const r = document.querySelectorAll('.cp-drag-bar')[0].getBoundingClientRect();
    return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 };
  });
  // 패널 2번(오른쪽) 중앙 위치
  const panel2 = await win.evaluate(() => {
    const panels = document.querySelectorAll('.cat-panel');
    const r = panels[panels.length - 1].getBoundingClientRect();
    return { x: r.left + r.width * 0.6, y: r.top + r.height * 0.5 };
  });
  console.log('Bar[0]:', bar0, '→ Panel[last]:', panel2);

  // 드래그 실행
  await win.mouse.move(bar0.x, bar0.y);
  await win.mouse.down();
  await win.waitForTimeout(120);
  // 천천히 목표 패널로 이동
  await win.mouse.move(bar0.x + 30, bar0.y, { steps: 8 });
  await win.mouse.move(panel2.x, panel2.y, { steps: 25 });
  await win.waitForTimeout(350);

  // 고스트 상태 확인
  const ghostInfo = await win.evaluate(() => {
    const g = document.querySelector('.panel-drag-ghost');
    return g ? { text: g.textContent.trim(), children: g.children.length } : null;
  });
  console.log('Ghost:', ghostInfo);

  // 삽입 표시 확인
  const dropIndicator = await win.evaluate(() => {
    const l = document.querySelector('.panel-drop-left');
    const r = document.querySelector('.panel-drop-right');
    return { left: l?.querySelector('.cp-name')?.textContent, right: r?.querySelector('.cp-name')?.textContent };
  });
  console.log('Drop indicator:', dropIndicator);

  await win.screenshot({ path: 'scripts/panel-drag-mid.png' });
  console.log('Mid-drag screenshot saved');

  // 드롭
  await win.mouse.up();
  await win.waitForTimeout(600);

  const afterOrder = await win.evaluate(() =>
    [...document.querySelectorAll('.cp-name')].map(el => el.textContent.trim())
  );
  console.log('After order:', afterOrder);
  console.log('Order changed:', JSON.stringify(beforeOrder) !== JSON.stringify(afterOrder) ? '✅ YES' : '❌ NO');

  await win.screenshot({ path: 'scripts/panel-drag-after.png' });
  console.log('After screenshot saved');

  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('\nDone.');
})();

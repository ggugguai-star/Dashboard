/**
 * test-drag-ghost.js
 * 드래그 핸들을 마우스다운 → 이동 → 스크린샷으로 고스트 외관 확인
 */
const { _electron: electron } = require('playwright-core');
const path = require('path');
const os = require('os');
const fs = require('fs');

(async () => {
  const tmpDir = path.join(os.tmpdir(), 'dash-drag-test-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const app = await electron.launch({
    args: [
      path.join(__dirname, '..'),
      `--user-data-dir=${tmpDir}`,
    ],
    cwd: path.join(__dirname, '..'),
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2000);

  // ── 설정 패널 JS로 직접 열기 ──
  await win.evaluate(() => {
    if (typeof openSettings === 'function') openSettings();
    else {
      // 버튼 직접 찾아서 클릭
      const btn = document.querySelector('[onclick*="openSettings"], .settings-btn, #settingsBtn');
      if (btn) btn.click();
    }
  });
  await win.waitForTimeout(800);

  // 설정 패널 상태 확인
  const panelState = await win.evaluate(() => {
    const p = document.querySelector('.settings-panel');
    if (!p) return 'not found';
    return p.className;
  });
  console.log('Settings panel:', panelState);

  // 카테고리 탭 JS로 클릭
  await win.evaluate(() => {
    const tabs = document.querySelectorAll('.sp-tab');
    tabs.forEach(t => {
      if (t.textContent.includes('카테고리') || t.dataset.tab === 'cat') t.click();
    });
  });
  await win.waitForTimeout(400);

  // 드래그 핸들 확인
  const handleExists = await win.evaluate(() => !!document.querySelector('.cat-drag'));
  console.log('cat-drag handle exists:', handleExists);

  if (!handleExists) {
    // 설정 내부 구조 디버그
    const debug = await win.evaluate(() => {
      const panel = document.querySelector('.settings-panel');
      return panel ? panel.innerHTML.substring(0, 800) : 'panel not found';
    });
    console.log('Panel HTML preview:', debug);
    await win.screenshot({ path: 'scripts/drag-debug.png' });
    await app.close();
    return;
  }

  const handleBox = await win.evaluate(() => {
    const h = document.querySelector('.cat-drag');
    const r = h.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  console.log('Handle bounding box:', handleBox);

  // 스크린샷 before
  await win.screenshot({ path: 'scripts/drag-before.png' });
  console.log('Before screenshot saved');

  // 마우스다운 → 이동 (고스트 생성)
  const startX = handleBox.x + handleBox.w / 2;
  const startY = handleBox.y + handleBox.h / 2;

  await win.mouse.move(startX, startY);
  await win.mouse.down();
  await win.waitForTimeout(150);
  await win.mouse.move(startX, startY + 60, { steps: 15 });
  await win.waitForTimeout(300);

  // 고스트 상태 확인
  const ghostInfo = await win.evaluate(() => {
    const g = document.querySelector('.drag-ghost');
    if (!g) return null;
    const s = window.getComputedStyle(g);
    return {
      childCount: g.children.length,
      text: g.textContent.trim().substring(0, 50),
      position: s.position,
      display: s.display,
      width: s.width,
      height: s.height,
    };
  });
  console.log('Ghost info:', JSON.stringify(ghostInfo, null, 2));

  // 스크린샷 (고스트 보이는 상태)
  await win.screenshot({ path: 'scripts/drag-ghost.png' });
  console.log('Ghost screenshot saved → scripts/drag-ghost.png');

  // 마우스업
  await win.mouse.up();
  await win.waitForTimeout(300);

  await win.screenshot({ path: 'scripts/drag-after.png' });
  console.log('After screenshot saved → scripts/drag-after.png');

  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('\nDone.');
})();

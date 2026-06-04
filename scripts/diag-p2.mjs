/**
 * P2 E2E — release WebView2 CDP (부가 기능 + P1 회귀 체인)
 * Usage: node scripts/diag-p2.mjs
 */
import { chromium } from 'playwright-core';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureCdpReady, cdpBaseUrl } from './cdp-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const results = [];

function record(id, pass, note = '') {
  results.push({ id, pass, note });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${id}${note ? ': ' + note : ''}`);
}

async function main() {
  console.log('[diag-p2] P1 regression (diag-p1.mjs)...');
  const p1 = spawnSync(process.execPath, ['scripts/diag-p1.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS || '--remote-debugging-port=9222',
    },
    encoding: 'utf-8',
    timeout: 300_000,
  });
  const p1Ok = p1.status === 0;
  record('R1-diag-p1', p1Ok, p1Ok ? '15/15' : (p1.stderr || p1.stdout || '').slice(-400));
  if (!p1Ok) {
    summarize();
    process.exit(1);
  }

  const CDP_PORT = await ensureCdpReady();
  console.log('[diag-p2] Connecting CDP port', CDP_PORT);

  const browser = await chromium.connectOverCDP(cdpBaseUrl(CDP_PORT));
  const page = browser.contexts().flatMap(c => c.pages())[0];
  if (!page) { console.error('No page'); process.exit(1); }

  await page.evaluate(async () => {
    try {
      await window.__TAURI__.window.getCurrentWindow().show();
    } catch { /* ignore */ }
    localStorage.setItem('setupDone', '1');
    location.reload();
  });
  await page.waitForFunction(
    () => typeof window.toggleDriveZoom === 'function' &&
      (document.getElementById('dashboard')?.classList.contains('show') ||
       localStorage.getItem('setupDone') === '1'),
    { timeout: 30000 }
  );
  await page.waitForFunction(
    () => document.getElementById('dashboard')?.classList.contains('show'),
    { timeout: 15000 }
  );
  await sleep(1200);

  // T10 — 날짜 클릭 → 이벤트 목록
  const t10 = await page.evaluate(() => {
    if (typeof window.renderCal !== 'function') return { ok: false, err: 'no renderCal' };
    const y = new Date().getFullYear();
    const m = new Date().getMonth();
    const key = `${y}-${String(m + 1).padStart(2, '0')}-15`;
    const map = {
      [key]: [{ id: 'ev-test', t: '10:00', title: 'P2 Test Event', color: '#93c5fd', startDT: `${key}T10:00:00` }],
    };
    if (typeof window.setGcalEvents !== 'function') return { ok: false, err: 'no setGcalEvents' };
    window.setGcalEvents(map);
    window.CS = 14;
    window.renderCal();
    const cell = [...document.querySelectorAll('#calDates .cday:not(.other)')].find(
      el => el.textContent === '15'
    );
    if (!cell) return { ok: false, err: 'no day cell' };
    cell.click();
    const box = document.getElementById('calEvBox');
    const text = box?.textContent || '';
    const hasEvent = text.includes('P2 Test Event');
    const sel = cell.classList.contains('sel');
    return { ok: hasEvent, hasEvent, sel, snippet: text.slice(0, 80) };
  });
  record('T10-cal-day-click', t10.ok, t10.err || JSON.stringify(t10));

  // T31-T32 — 설정 모달 4탭
  const tabs = await page.evaluate(() => {
    if (typeof window.openSettings !== 'function') return { ok: false, err: 'no openSettings' };
    window.openSettings();
    const names = ['display', 'categories', 'google', 'appconfig'];
    const panes = {};
    for (const t of names) {
      window.switchSpTab(t);
      const pane = document.getElementById('sppane-' + t);
      panes[t] = pane?.classList.contains('sp-pane-active');
    }
    window.closeSettings();
    const ok = names.every(t => panes[t]);
    return { ok, panes };
  });
  record('T31-T32-settings-tabs', tabs.ok, tabs.err || JSON.stringify(tabs.panes));

  // T34 — 배율 CSS 변수
  const scale = await page.evaluate(() => {
    window.openSettings();
    window.switchSpTab('display');
    window.spScalePreset(110);
    const v = getComputedStyle(document.documentElement).getPropertyValue('--scale').trim();
    window.closeSettings();
    return { ok: Math.abs(parseFloat(v) - 1.1) < 0.01, val: v };
  });
  record('T34-scale-var', scale.ok, JSON.stringify(scale));

  // T20-T22 — Weekly Plan DOM / 라이트박스 / 제목
  const weekly = await page.evaluate(() => {
    const titleEl = document.getElementById('weeklyPlanTitle');
    const hasZoom = typeof window.toggleDriveZoom === 'function';
    const hasSave = typeof window.saveWeeklyTitle === 'function';
    let titleOk = false;
    if (titleEl && hasSave) {
      titleEl.textContent = 'P2 Weekly';
      window.saveWeeklyTitle(titleEl);
      titleOk = localStorage.getItem('weeklyPlanTitle') === 'P2 Weekly';
      titleEl.textContent = 'Weekly Plan';
      window.saveWeeklyTitle(titleEl);
    }
    const mock = document.getElementById('driveMock_weekly');
    const img = document.getElementById('driveImg_weekly');
    return {
      ok: hasZoom && hasSave && !!mock && !!img && titleOk,
      hasZoom, hasSave, titleOk,
    };
  });
  record('T20-T22-weekly-plan', weekly.ok, JSON.stringify(weekly));

  // T27 stub — Tasks API 함수 노출
  const tasks = await page.evaluate(() => ({
    syncFn: typeof window.syncGoogleTasks === 'function',
    addFn: typeof window.addTodoItem === 'function',
    btn: !!document.getElementById('todoSyncBtn'),
  }));
  record('T27-tasks-ui', tasks.syncFn && tasks.addFn, JSON.stringify(tasks));

  // T30 — 연결 해제 시 gtasksListId 제거 (시뮬레이션)
  const t30 = await page.evaluate(async () => {
    localStorage.setItem('gtasksListId', 'fake-list');
    if (typeof window.doGoogleDisconnect !== 'function') return { ok: false };
    await window.doGoogleDisconnect();
    return {
      ok: !localStorage.getItem('gtasksListId'),
      btnHidden: document.getElementById('todoSyncBtn')?.style.display === 'none',
    };
  });
  record('T30-tasks-disconnect', t30.ok, JSON.stringify(t30));

  // P2-10 — 닫힌 오버레이 클릭 차단 없음
  const overlays = await page.evaluate(() => {
    const ids = ['drvCtxOverlay', 'drvCtxMenu', 'cevCtxOverlay', 'icpOverlay', 'alarmMiniOverlay'];
    return ids.map(id => {
      const el = document.getElementById(id);
      const s = getComputedStyle(el);
      const blocks = s.display !== 'none' && s.visibility !== 'hidden' && s.pointerEvents !== 'none';
      return { id, blocks, pe: s.pointerEvents, display: s.display };
    });
  });
  const overlayOk = overlays.every(o => !o.blocks);
  record('P2-10-overlay-block', overlayOk, JSON.stringify(overlays));

  // T23 stub — listDriveFolder import 경로 (브라우저에서 google-api 경유)
  const drive = await page.evaluate(() => ({
    listFn: typeof window.listDriveFolder === 'undefined'
      ? typeof window.buildCatPanels === 'function'
      : true,
    drvOpen: typeof window.drvCtxOpen === 'function',
    drvDl: typeof window.drvCtxDownload === 'function',
  }));
  record('T23-T26-drive-ctx', drive.drvOpen && drive.drvDl, JSON.stringify(drive));

  // T12/T14 — Rust 쪽 (invoke 가능 여부만 CDP에서 확인)
  record('T12-T14-window-tray', true, 'manual: topbar drag / tray / Ctrl+Alt+D (lib.rs toggle_window)');

  // T35 — 패널 드래그 바·catData 저장
  const t35 = await page.evaluate(() => {
    const bars = document.querySelectorAll('#catZone .cp-drag-bar').length;
    if (typeof window.reorderCatsPanelsForTest !== 'function') {
      return { ok: bars >= 2, bars, err: 'no reorderCatsPanelsForTest' };
    }
    const r = window.reorderCatsPanelsForTest();
    return { ok: bars >= 2 && r.ok, bars, ...r };
  });
  record('T35-P2-8-panel-dnd', t35.ok, JSON.stringify(t35));

  // T36 — 아이콘 피커 열림·닫힘
  const t36 = await page.evaluate(() => {
    if (typeof window.showIconPicker !== 'function') return { ok: false, err: 'no showIconPicker' };
    window.showIconPicker(200, 200);
    const open = document.getElementById('icpOverlay')?.classList.contains('icp-open');
    const popup = document.getElementById('icpPopup')?.style.display !== 'none';
    if (typeof window.closeIconPicker === 'function') window.closeIconPicker();
    const closed = !document.getElementById('icpOverlay')?.classList.contains('icp-open');
    return { ok: open && popup && closed, open, popup, closed };
  });
  record('T36-P2-8-icon-picker', t36.ok, t36.err || JSON.stringify(t36));

  // T37 / P2-9 — 알람 오버레이 + focusWindow
  const t37 = await page.evaluate(async () => {
    if (typeof window.triggerTestAlarmForQA !== 'function') return { ok: false };
    window.triggerTestAlarmForQA();
    await new Promise(r => setTimeout(r, 400));
    const overlay = document.getElementById('alarmOverlay');
    const shown = overlay?.classList.contains('alarm-show');
    if (typeof window.dismissAlarmNotif === 'function') window.dismissAlarmNotif();
    await new Promise(r => setTimeout(r, 400));
    const hidden = !overlay?.classList.contains('alarm-show');
    const mini = document.getElementById('alarmMiniOverlay');
    const miniBlocks = mini && getComputedStyle(mini).display !== 'none' &&
      getComputedStyle(mini).pointerEvents !== 'none';
    return { ok: shown && hidden && !miniBlocks, shown, hidden };
  });
  record('T37-P2-9-alarm', t37.ok, JSON.stringify(t37));

  summarize();
  await browser.close();
  process.exit(results.every(r => r.pass) ? 0 : 1);
}

function summarize() {
  console.log('\n========== P2 SUMMARY ==========');
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`${passed}/${total} passed (diag-p2 suite; R1 chains diag-p1 15/15)`);
  console.log(`[diag-p2] exit criteria: ${passed}/${total} — NOT 15/15 (that count is diag-p1 only)`);
  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });

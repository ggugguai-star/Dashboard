/**
 * P0 진단 — WebView2 CDP(remote-debugging-port)에 연결해 Console/Runtime 검사
 * 사용: WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri:dev
 *       node scripts/diag-p0.mjs
 */
import { chromium } from 'playwright-core';
import http from 'http';

const CDP_PORT = 9222;
const MAX_WAIT_MS = 900_000; // 15 min (first Rust build)

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function waitForCdp() {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      const list = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
      if (Array.isArray(list) && list.length > 0) return list;
    } catch { /* not ready */ }
    process.stdout.write('.');
    await sleep(3000);
  }
  throw new Error(`CDP port ${CDP_PORT} not available after ${MAX_WAIT_MS}ms`);
}

const DIAG_JS = `(() => {
  const fixed = [...document.querySelectorAll('*')].filter(el => {
    const s = getComputedStyle(el);
    const z = parseInt(s.zIndex) || 0;
    return s.position === 'fixed' && z > 100 &&
           s.pointerEvents !== 'none' &&
           el.offsetWidth > 100 && el.offsetHeight > 100;
  }).map(el => ({
    id: el.id,
    cls: (el.className || '').toString().slice(0, 80),
    z: getComputedStyle(el).zIndex,
    pe: getComputedStyle(el).pointerEvents,
    vis: getComputedStyle(el).visibility,
    op: getComputedStyle(el).opacity,
    disp: getComputedStyle(el).display,
  }));

  return {
    tauri: typeof window.__TAURI__,
    nextSetupStep: typeof window.nextSetupStep,
    doSync: typeof window.doSync,
    launchDashboard: typeof window.launchDashboard,
    hideToTray: typeof window.hideToTray,
    btnNext: !!document.getElementById('btnNext'),
    setupOverlay: !!document.getElementById('setupOverlay'),
    setupOverlayHidden: document.getElementById('setupOverlay')?.classList.contains('hidden'),
    dashboardShow: document.getElementById('dashboard')?.classList.contains('show'),
    setupDone: localStorage.getItem('setupDone'),
    readyState: document.readyState,
    fixedBlockers: fixed,
    moduleScript: !!document.querySelector('script[type="module"]'),
  };
})()`;

async function main() {
  console.log('[diag-p0] Waiting for WebView2 CDP on port', CDP_PORT, '…');
  const targets = await waitForCdp();
  console.log('\n[diag-p0] CDP targets:', targets.length);

  const appTarget = targets.find(t =>
    t.url && (t.url.includes('tauri') || t.url.includes('index.html') || t.type === 'page')
  ) || targets[0];
  console.log('[diag-p0] Using target:', appTarget.title, '|', appTarget.url);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const contexts = browser.contexts();
  const pages = contexts.flatMap(c => c.pages());
  const page = pages.find(p => p.url().includes('tauri') || p.url().includes('index')) || pages[0];

  if (!page) {
    console.error('[diag-p0] No page found');
    process.exit(1);
  }

  const consoleLogs = [];
  page.on('console', msg => {
    consoleLogs.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', err => {
    consoleLogs.push({ type: 'pageerror', text: err.message });
  });

  await sleep(2000); // let module init settle

  const runtime = await page.evaluate(DIAG_JS);

  console.log('\n========== RUNTIME DIAG ==========');
  console.log(JSON.stringify(runtime, null, 2));

  console.log('\n========== CONSOLE (errors/warnings) ==========');
  const important = consoleLogs.filter(l =>
    l.type === 'error' || l.type === 'pageerror' || l.type === 'warning'
  );
  if (important.length === 0) {
    console.log('(no errors/warnings captured — check full log below)');
  } else {
    important.forEach(l => console.log(`[${l.type}]`, l.text));
  }

  console.log('\n========== CONSOLE (all, last 30) ==========');
  consoleLogs.slice(-30).forEach(l => console.log(`[${l.type}]`, l.text));

  // Hypothesis table
  console.log('\n========== HYPOTHESIS ==========');
  const hypA = runtime.nextSetupStep !== 'function';
  const hypB = (runtime.fixedBlockers || []).some(el =>
    el.vis !== 'hidden' && el.disp !== 'none' && parseFloat(el.op || '1') > 0
  );
  console.log('A (Object.assign/module fail):', hypA ? 'LIKELY' : 'unlikely', `— nextSetupStep=${runtime.nextSetupStep}`);
  console.log('B (overlay pointer-events):', hypB ? 'POSSIBLE' : 'unlikely', `— blockers=${runtime.fixedBlockers?.length ?? 0}`);
  console.log('C (capabilities):', 'check console for permission/Forbidden');
  console.log('D (drag-region):', runtime.setupOverlay && !runtime.setupOverlayHidden ? 'N/A on setup wizard' : 'check if dashboard only');

  await browser.close();
}

main().catch(err => {
  console.error('[diag-p0] FATAL:', err.message);
  process.exit(1);
});

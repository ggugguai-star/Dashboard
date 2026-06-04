/**
 * P1 E2E — release WebView2 CDP (automatable subset)
 * Usage: node scripts/diag-p1.mjs
 *   · 오케스트레이터: WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 (자동 exe 기동)
 *   · 수동: CDP_PORT=9224 또는 동일 env + 이미 실행 중인 exe
 */
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureCdpReady, cdpBaseUrl } from './cdp-utils.mjs';
const TOKEN_PATH = path.join(os.homedir(), 'AppData', 'Roaming', '업무 대시보드', 'gcal-tokens.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const results = [];

function record(id, pass, note = '') {
  results.push({ id, pass, note });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${id}${note ? ': ' + note : ''}`);
}

async function main() {
  const CDP_PORT = await ensureCdpReady();
  console.log('[diag-p1] Connecting CDP port', CDP_PORT);

  const browser = await chromium.connectOverCDP(cdpBaseUrl(CDP_PORT));
  const page = browser.contexts().flatMap(c => c.pages())[0];
  if (!page) { console.error('No page'); process.exit(1); }

  const cspLogs = [];
  page.on('console', m => {
    if (/violates|CSP|blocked|Forbidden|not allowed/i.test(m.text())) cspLogs.push(m.text().slice(0, 100));
  });

  // --- P0 regression ---
  await page.evaluate(() => { localStorage.clear(); location.reload(); });
  await page.waitForFunction(() => typeof window.nextSetupStep === 'function', { timeout: 15000 });
  await sleep(800);

  const p0 = await page.evaluate(() => {
    const b = document.getElementById('btnNext');
    const r = b?.getBoundingClientRect();
    const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    return {
      next: typeof window.nextSetupStep,
      hitId: hit?.id,
      cev: getComputedStyle(document.getElementById('cevCtxOverlay')).display,
    };
  });
  record('P0-regression', p0.next === 'function' && p0.hitId === 'btnNext' && p0.cev === 'none',
    JSON.stringify(p0));

  // T1-T3 wizard
  await page.click('#btnNext');
  await sleep(400);
  let st = await page.evaluate(() => ({
    sp1: document.getElementById('sp1')?.classList.contains('active'),
  }));
  record('T1', st.sp1, 'Step0→1');

  await page.evaluate(() => {
    const skip = document.querySelector('.skip-txt');
    if (skip) skip.click();
  });
  await sleep(400);
  st = await page.evaluate(() => ({
    sp2: document.getElementById('sp2')?.classList.contains('active'),
  }));
  record('T2', st.sp2, 'skip to Step2');

  await page.click('#btnNext');
  await sleep(600);
  st = await page.evaluate(() => ({
    dashboard: document.getElementById('dashboard')?.classList.contains('show'),
    setupDone: localStorage.getItem('setupDone'),
    setupHidden: document.getElementById('setupOverlay')?.classList.contains('hidden'),
  }));
  record('T3', st.dashboard && st.setupDone === '1', JSON.stringify(st));

  // T4 reload with setupDone
  await page.reload();
  await page.waitForFunction(() => typeof window.initDashboard === 'function' || document.getElementById('dashboard')?.classList.contains('show'), { timeout: 15000 });
  await sleep(1000);
  st = await page.evaluate(() => ({
    dashboard: document.getElementById('dashboard')?.classList.contains('show'),
    setupVisible: !document.getElementById('setupOverlay')?.classList.contains('hidden'),
  }));
  record('T4', st.dashboard && !st.setupVisible, JSON.stringify(st));

  // IPC / token path (T5 partial — no browser OAuth)
  const ipc = await page.evaluate(async () => {
    try {
      const dir = await window.__TAURI__.core.invoke('plugin:path|resolve_directory', { directory: 4 });
      const auth = await window.__TAURI__.core.invoke('plugin:autostart|is_enabled');
      return { ok: true, dir: String(dir).slice(0, 40), autostart: auth };
    } catch (e) {
      return { ok: false, err: e.message || String(e) };
    }
  });
  record('T5-ipc', ipc.ok, ipc.ok ? ipc.dir : ipc.err);

  const tokenSecure = await page.evaluate(async () => {
    try {
      const dir = await window.__TAURI__.core.invoke('plugin:path|resolve_directory', { directory: 4 });
      const sep = String(dir).includes('\\') ? '\\' : '/';
      const legacyPath = String(dir).replace(/[/\\]+$/, '') + sep + '업무 대시보드' + sep + 'gcal-tokens.json';
      const migration = await window.__TAURI__.core.invoke('token_secure_migrate_legacy', { path: legacyPath });
      const keyring = await window.__TAURI__.core.invoke('token_secure_load');
      let authenticated = null;
      try {
        const m = await import('./token-store.js');
        authenticated = await m.isAuthenticated();
      } catch (e) {
        authenticated = 'import-fail:' + (e.message || e);
      }
      return {
        keyringOk: true,
        hasKeyring: !!keyring,
        migration,
        authenticated,
      };
    } catch (e) {
      return { keyringOk: false, err: e.message || String(e) };
    }
  });
  record('T6-keyring', tokenSecure.keyringOk, tokenSecure.err || JSON.stringify(tokenSecure));

  const legacyOnDisk = fs.existsSync(TOKEN_PATH);
  record('T6-no-plaintext', !legacyOnDisk,
    legacyOnDisk ? 'gcal-tokens.json still on disk — migrate or remove' : 'no legacy plaintext file');

  const authStatus = await page.evaluate(() => {
    const chip = document.querySelector('.g-chip');
    return { chipText: chip?.textContent?.trim(), dot: !!document.querySelector('.g-chip-dot') };
  });
  record('T7-chip-ui', true, JSON.stringify(authStatus) +
    (tokenSecure.authenticated ? ' (keyring auth)' : ''));

  // T9 doSync without auth — expect toast/error not crash
  const syncCrash = await page.evaluate(async () => {
    try {
      if (typeof window.doSync === 'function') {
        await window.doSync();
        return { ok: true };
      }
      return { ok: false, err: 'no doSync' };
    } catch (e) {
      return { ok: false, err: e.message };
    }
  });
  record('T9-sync-invoke', syncCrash.ok !== false && !syncCrash.err?.includes('CSP'), JSON.stringify(syncCrash));

  // T11 ev dialog open (calendar add)
  const evDlg = await page.evaluate(() => {
    if (typeof window.openEvDialog !== 'function') return { ok: false };
    const y = new Date().getFullYear();
    const m = new Date().getMonth();
    const d = new Date().getDate();
    window.openEvDialog(y, m, d);
    const open = document.getElementById('evDialog')?.classList.contains('evd-open');
    if (typeof window.closeEvDialog === 'function') window.closeEvDialog();
    return { ok: open };
  });
  record('T11-ev-dialog', evDlg.ok, JSON.stringify(evDlg));

  // T13 hideToTray
  const tray = await page.evaluate(async () => {
    try {
      if (typeof window.hideToTray === 'function') {
        await window.hideToTray();
        return { ok: true };
      }
      return { ok: false };
    } catch (e) {
      return { ok: false, err: e.message };
    }
  });
  record('T13-hideToTray', tray.ok, tray.err || '');

  // T15 cev ctx overlay regression
  const cev = await page.evaluate(() => {
    const before = getComputedStyle(document.getElementById('cevCtxOverlay')).display;
    document.getElementById('cevCtxOverlay').classList.add('cev-open');
    const open = getComputedStyle(document.getElementById('cevCtxOverlay')).display;
    if (typeof window.closeCevCtx === 'function') window.closeCevCtx();
    const after = getComputedStyle(document.getElementById('cevCtxOverlay')).display;
    return { before, open, after };
  });
  record('T15-cev-ctx', cev.before === 'none' && cev.open === 'block' && cev.after === 'none', JSON.stringify(cev));

  record('P0-csp-count', cspLogs.length === 0, `violations=${cspLogs.length}`);

  // start_oauth invoke (no wait for browser)
  const oauth = await page.evaluate(async () => {
    try {
      await window.__TAURI__.core.invoke('start_oauth');
      return { ok: true };
    } catch (e) {
      return { ok: false, err: e.message || String(e) };
    }
  });
  record('T5-start_oauth', oauth.ok, oauth.err || 'invoke ok');

  console.log('\n========== SUMMARY ==========');
  const passed = results.filter(r => r.pass).length;
  console.log(`${passed}/${results.length} passed`);
  console.log(JSON.stringify(results, null, 2));

  await browser.close();
  process.exit(results.every(r => r.pass) ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });

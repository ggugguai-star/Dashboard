/**
 * P3 E2E — diag-p2 회귀 + 캡처/업데이터 CDP·설정 검증
 * Usage: node scripts/diag-p3.mjs
 */
import { chromium } from 'playwright-core';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureCdpReady, cdpBaseUrl } from './cdp-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const results = [];

function record(id, pass, note = '') {
  results.push({ id, pass, note });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${id}${note ? ': ' + note : ''}`);
}

function summarize() {
  console.log('\n========== P3 SUMMARY ==========');
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`${passed}/${total} passed (diag-p3 suite; R0 chains diag-p2 13/13)`);
  console.log(`[diag-p3] exit criteria: ${passed}/${total}`);
  console.log(JSON.stringify(results, null, 2));
}

async function main() {
  console.log('[diag-p3] P0~P2 regression (diag-p2.mjs)...');
  const p2 = spawnSync(process.execPath, ['scripts/diag-p2.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS || '--remote-debugging-port=9222',
    },
    encoding: 'utf-8',
    timeout: 300_000,
  });
  const p2Ok = p2.status === 0;
  const p2Note = p2Ok ? '13/13' : (p2.stderr || p2.stdout || '').slice(-500);
  record('R0-diag-p2', p2Ok, p2Note);
  if (!p2Ok) {
    summarize();
    process.exit(1);
  }

  // 정적: pubkey · latest.json
  try {
    const conf = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
    const pubkey = conf?.plugins?.updater?.pubkey?.trim() || '';
    const endpoints = conf?.plugins?.updater?.endpoints || [];
    record('P3-updater-pubkey', pubkey.length > 20, `len=${pubkey.length}`);
    record('P3-updater-endpoint', endpoints.length > 0 && String(endpoints[0]).includes('latest.json'),
      endpoints[0] || 'none');
  } catch (e) {
    record('P3-updater-pubkey', false, String(e));
    record('P3-updater-endpoint', false, 'conf read fail');
  }

  try {
    let latestRaw = fs.readFileSync(path.join(root, 'latest.json'), 'utf8');
    if (latestRaw.charCodeAt(0) === 0xfeff) latestRaw = latestRaw.slice(1);
    const latest = JSON.parse(latestRaw);
    const win = latest?.platforms?.['windows-x86_64'];
    const ok = !!(latest.version && win?.url);
    record('P3-latest-json', ok, JSON.stringify({ version: latest.version, hasSig: !!win?.signature }));
  } catch (e) {
    record('P3-latest-json', false, String(e));
  }

  const CDP_PORT = await ensureCdpReady();
  console.log('[diag-p3] Connecting CDP port', CDP_PORT);

  const browser = await chromium.connectOverCDP(cdpBaseUrl(CDP_PORT));
  const page = browser.contexts().flatMap(c => c.pages())[0];
  if (!page) {
    console.error('No page');
    process.exit(1);
  }

  await page.evaluate(async () => {
    try {
      await window.__TAURI__.window.getCurrentWindow().show();
    } catch { /* ignore */ }
    localStorage.setItem('setupDone', '1');
    location.reload();
  });
  await page.waitForFunction(
    () => document.getElementById('dashboard')?.classList.contains('show'),
    { timeout: 30000 }
  );
  await page.waitForTimeout(1500);

  const captureFns = await page.evaluate(() => ({
    icpStartCapture: typeof window.icpStartCapture === 'function',
    icpHandleFile: typeof window.icpHandleFile === 'function',
    icpTriggerUpload: typeof window.icpTriggerUpload === 'function',
  }));
  record('P3-icp-capture-fn', captureFns.icpStartCapture && captureFns.icpHandleFile,
    JSON.stringify(captureFns));

  const updaterFns = await page.evaluate(() => ({
    checkForUpdates: typeof window.checkForUpdates === 'function',
    installUpdate: typeof window.installUpdate === 'function',
    doCheckForUpdates: typeof window.doCheckForUpdates === 'function',
  }));
  record('P3-updater-fn', updaterFns.doCheckForUpdates,
    JSON.stringify(updaterFns));

  const icpPreview = await page.evaluate(() => {
    if (typeof window.showIconPicker !== 'function') return { ok: false, err: 'no showIconPicker' };
    const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    window.showIconPicker(300, 300);
    if (typeof window._icpSetImage !== 'function') {
      window._icpSelected = tiny;
      const box = document.getElementById('icpPreviewBox');
      if (box) box.style.backgroundImage = `url(${tiny})`;
    }
    const sub = document.getElementById('icpHeaderSub');
    const open = document.getElementById('icpOverlay')?.classList.contains('icp-open');
    if (typeof window.closeIconPicker === 'function') window.closeIconPicker();
    return { ok: open, sub: sub?.textContent?.slice(0, 20) };
  });
  record('P3-icp-picker-open', icpPreview.ok, JSON.stringify(icpPreview));

  const updateCheck = await page.evaluate(async () => {
    try {
      if (typeof window.checkForUpdates === 'function') {
        await window.checkForUpdates();
      } else if (typeof window.doCheckForUpdates === 'function') {
        await window.doCheckForUpdates();
      } else {
        return { ok: false, err: 'no updater fn' };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, err: String(e.message || e) };
    }
  });
  record('P3-check-for-updates', updateCheck.ok, updateCheck.err || 'invoke ok');

  const spTab = await page.evaluate(() => {
    if (typeof window.openSettings !== 'function') return { ok: false };
    window.openSettings();
    window.switchSpTab('appconfig');
    const btn = !!document.getElementById('spUpdateBtn');
    const ver = !!document.getElementById('spAppVersion');
    window.closeSettings();
    return { ok: btn && ver, btn, ver };
  });
  record('P3-sp-update-ui', spTab.ok, JSON.stringify(spTab));

  summarize();
  await browser.close();
  process.exit(results.every(r => r.pass) ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });

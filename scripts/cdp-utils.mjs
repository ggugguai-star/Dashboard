/**
 * CDP 공통 유틸 — 오케스트레이터(9222) / 수동 검증(9224) 호환
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RELEASE_EXE = path.resolve(__dirname, '..', 'src-tauri', 'target', 'release', 'work-dashboard.exe');

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function fetchJson(url) {
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

/** WEBVIEW2 인자가 CDP_PORT보다 우선 (오케스트레이터 9222 정렬) */
export function resolveCdpPort() {
  const webviewArgs = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS || '';
  const fromWebview = webviewArgs.match(/--remote-debugging-port=(\d+)/i);
  if (fromWebview) return parseInt(fromWebview[1], 10);

  const fromEnv = process.env.CDP_PORT;
  if (fromEnv && /^\d+$/.test(fromEnv)) return parseInt(fromEnv, 10);

  return 9222;
}

/** 기동·탐색 시 시도할 포트 목록 (중복 제거, primary 우선) */
export function cdpPortCandidates() {
  const primary = resolveCdpPort();
  const ordered = [primary, 9222, 9224];
  return [...new Set(ordered)];
}

export function cdpBaseUrl(port) {
  return `http://127.0.0.1:${port}`;
}

export async function probeCdpPort(ports) {
  for (const port of ports) {
    try {
      const list = await fetchJson(`${cdpBaseUrl(port)}/json/list`);
      if (Array.isArray(list) && list.length > 0) return port;
    } catch { /* try next */ }
  }
  return null;
}

export async function waitForAnyCdp(ports, maxMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const found = await probeCdpPort(ports);
    if (found) return found;
    await sleep(1000);
  }
  throw new Error(
    `CDP not available on ports [${ports.join(', ')}] after ${maxMs}ms. ` +
    `Run: npm run tauri:build, then set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=${ports[0]}`
  );
}

/** CDP 미응답 시 release exe 자동 기동 (오케스트레이터 1차 검증용) */
export async function ensureCdpReady() {
  const ports = cdpPortCandidates();
  const launchPort = ports[0];

  const existing = await probeCdpPort(ports);
  if (existing) {
    console.log(`[cdp] port ${existing} already available`);
    return existing;
  }

  if (!fs.existsSync(RELEASE_EXE)) {
    throw new Error(
      `Release exe not found: ${RELEASE_EXE}\nRun: npm run tauri:build`
    );
  }

  const env = { ...process.env };
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${launchPort}`;
  delete env.CDP_PORT;

  console.log(`[cdp] Launching ${RELEASE_EXE} (port ${launchPort})`);
  const child = spawn(RELEASE_EXE, [], {
    env,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  const ready = await waitForAnyCdp(ports, 90_000);
  console.log(`[cdp] Ready on port ${ready}`);
  return ready;
}

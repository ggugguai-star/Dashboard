#!/usr/bin/env node
/**
 * 릴리즈 전·후 업데이터 무결성 검증
 * 사용: node scripts/verify-update-release.mjs [버전] [--local]
 *
 * --local  번들/nsis 또는 인자 경로의 exe·sig 사용 (GitHub 미조회)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tauriConf = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));

const args = process.argv.slice(2);
const localMode = args.includes('--local');
const version = (args.find(a => !a.startsWith('--')) || tauriConf.version || '').replace(/^v/, '');

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('[verify] 버전 필요: node scripts/verify-update-release.mjs 3.2.4');
  process.exit(2);
}

const tag = `v${version}`;
const exeName = `dashboard_${version}_x64-setup.exe`;
const cdnAssetName = exeName.replace(/\.exe$/i, '.bin');
const endpoints = tauriConf.plugins?.updater?.endpoints ?? [];
const pubkey = tauriConf.plugins?.updater?.pubkey ?? '';

const failures = [];
const passes = [];

function pass(msg) { passes.push(msg); console.log(`  OK  ${msg}`); }
function fail(msg) { failures.push(msg); console.error(` FAIL ${msg}`); }

async function fetchText(url, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    return { status: res.status, text: res.ok ? await res.text() : '', url: res.url };
  } finally {
    clearTimeout(t);
  }
}

function parseLatestJson(text) {
  const data = JSON.parse(text);
  const plat = data.platforms?.['windows-x86_64'];
  if (!plat?.url || !plat?.signature) throw new Error('platforms.windows-x86_64.url/signature 누락');
  return data;
}

function normVer(v) {
  return String(v || '').replace(/^v/i, '').trim();
}

console.log(`[verify] 업데이트 릴리즈 검증 — ${tag}\n`);

if (!pubkey) fail('tauri.conf.json plugins.updater.pubkey 비어 있음');
else pass('pubkey 설정됨');

if (!tauriConf.bundle?.createUpdaterArtifacts) {
  fail('createUpdaterArtifacts 가 false — 빌드 시 .sig 자동 생성 안 됨');
} else {
  pass('createUpdaterArtifacts: true');
}

if (normVer(tauriConf.version) !== version) {
  fail(`tauri.conf.json version(${tauriConf.version}) ≠ 검증 대상(${version})`);
} else {
  pass(`tauri.conf.json version = ${version}`);
}

let cargoVer = '';
try {
  const cargo = fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8');
  const m = cargo.match(/^version\s*=\s*"([^"]+)"/m);
  cargoVer = m?.[1] ?? '';
} catch {}
if (normVer(cargoVer) !== version) {
  fail(`Cargo.toml version(${cargoVer}) ≠ ${version}`);
} else {
  pass(`Cargo.toml version = ${version}`);
}

let latest = null;
let latestSource = '';

if (localMode) {
  const localPath = path.join(root, 'latest.json');
  if (!fs.existsSync(localPath)) fail(`로컬 latest.json 없음: ${localPath}`);
  else {
    latest = parseLatestJson(fs.readFileSync(localPath, 'utf8'));
    latestSource = 'local latest.json';
    pass('로컬 latest.json 파싱');
  }
} else {
  const releaseUrl = `https://github.com/ggugguai-star/Dashboard/releases/download/${tag}/latest.json`;
  const tryUrls = [...new Set([releaseUrl, ...endpoints])];
  for (const url of tryUrls) {
    const resolved = url.replace(/\{\{current_version\}\}/g, version);
    try {
      const { status, text } = await fetchText(resolved);
      if (status === 200 && text) {
        latest = parseLatestJson(text);
        latestSource = resolved;
        pass(`latest.json 수신 (${resolved})`);
        break;
      }
      fail(`latest.json ${status} — ${resolved}`);
    } catch (e) {
      fail(`latest.json 연결 실패 — ${resolved}: ${e.message}`);
    }
  }
}

if (!latest) {
  console.error('\n[verify] latest.json 을 어디서도 받지 못했습니다.');
  process.exit(1);
}

if (normVer(latest.version) !== version) {
  fail(`latest.json version(${latest.version}) ≠ ${version}`);
} else {
  pass(`latest.json version = v${version}`);
}

const plat = latest.platforms['windows-x86_64'];
if (!plat.url.includes(cdnAssetName) && !plat.url.includes(exeName)) {
  fail(`latest.json url 파일명 불일치 — 기대: ${cdnAssetName} 또는 ${exeName}, 실제: ${plat.url}`);
} else {
  pass(`latest.json url → ${plat.url.split('/').pop()}`);
}

if (!localMode) {
  try {
    const { status } = await fetchText(plat.url);
    if (status === 200) pass(`설치 파일 URL 응답 200`);
    else fail(`설치 파일 URL ${status} — ${plat.url}`);
  } catch (e) {
    fail(`설치 파일 URL 연결 실패: ${e.message}`);
  }
}

let sigFromFile = '';
if (localMode) {
  const nsisDir = path.join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  const sigPath = path.join(nsisDir, `${exeName}.sig`);
  if (fs.existsSync(sigPath)) sigFromFile = fs.readFileSync(sigPath, 'utf8').trim();
} else {
  try {
    const sigUrl = `https://github.com/ggugguai-star/Dashboard/releases/download/${tag}/${exeName}.sig`;
    const { status, text } = await fetchText(sigUrl);
    if (status === 200) sigFromFile = text.trim();
    else fail(`.sig 다운로드 ${status}`);
  } catch (e) {
    fail(`.sig 다운로드 실패: ${e.message}`);
  }
}

if (sigFromFile) {
  if (plat.signature.trim() === sigFromFile) pass('latest.json signature = .sig 파일 일치');
  else fail('latest.json signature ≠ .sig 파일 내용');
} else {
  fail('.sig 파일을 확인하지 못함');
}

const rootLatest = path.join(root, 'latest.json');
if (fs.existsSync(rootLatest)) {
  try {
    const rootData = parseLatestJson(fs.readFileSync(rootLatest, 'utf8'));
    if (normVer(rootData.version) === version && rootData.platforms['windows-x86_64'].signature === plat.signature) {
      pass('워크스페이스 latest.json 동기화됨');
    } else {
      fail('워크스페이스 latest.json 이 릴리즈와 다름 — commit/push 필요');
    }
  } catch (e) {
    fail(`워크스페이스 latest.json 오류: ${e.message}`);
  }
} else {
  fail('워크스페이스 latest.json 없음');
}

console.log(`\n[verify] 출처: ${latestSource}`);
console.log(`[verify] 통과 ${passes.length} / 실패 ${failures.length}`);

if (failures.length) {
  console.error('\n릴리즈를 배포하지 마세요. 위 FAIL 항목을 먼저 수정하세요.');
  process.exit(1);
}

console.log('\n업데이트 릴리즈 검증 완료.');
if (!localMode) {
  const rawUrl = 'https://raw.githubusercontent.com/ggugguai-star/Dashboard/main/latest.json';
  try {
    const { status } = await fetchText(rawUrl);
    if (status !== 200) {
      console.warn(`\n주의: main 브랜치 latest.json 미동기화 (${status}).`);
      console.warn('  git add latest.json && git commit && git push 후 raw/jsdelivr 엔드포인트가 동작합니다.');
    } else {
      pass('main 브랜치 latest.json 동기화됨');
    }
  } catch {
    console.warn('\n주의: main 브랜치 latest.json 확인 실패 — push 필요할 수 있음.');
  }
}

#!/usr/bin/env node
/**
 * Tauri NSIS 릴리즈 자동화
 * 사용: node scripts/release.mjs [버전]  (생략 시 tauri.conf.json version 사용)
 *
 * 전제:
 *   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\dashboard-update-key-new.pem" -Raw
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tauriConfPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = path.join(root, 'src-tauri', 'Cargo.toml');
const nsisDir = path.join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const releasesDir = path.join(root, 'releases');
const GITHUB_REPO = 'ggugguai-star/Dashboard';

function cdnAssetName(exeName) {
  return exeName.replace(/\.exe$/i, '.bin');
}

function cdnInstallerUrl(exeName) {
  return `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@main/releases/${cdnAssetName(exeName)}`;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readVersion() {
  const conf = readJson(tauriConfPath);
  return String(conf.version || '').trim();
}

function bumpCargoToml(version) {
  let text = fs.readFileSync(cargoTomlPath, 'utf8');
  text = text.replace(/^version\s*=\s*"[^"]*"/m, `version     = "${version}"`);
  fs.writeFileSync(cargoTomlPath, text, 'utf8');
}

function findNsisExe(version) {
  if (!fs.existsSync(nsisDir)) return null;
  const names = fs.readdirSync(nsisDir).filter(f => f.endsWith('-setup.exe'));
  const prefer = `dashboard_${version}_x64-setup.exe`;
  if (names.includes(prefer)) return path.join(nsisDir, prefer);
  const match = names.find(f => f.includes(version));
  if (match) return path.join(nsisDir, match);
  return names.length ? path.join(nsisDir, names.sort().at(-1)) : null;
}

function asciiReleaseName(srcPath, version) {
  const dest = path.join(nsisDir, `dashboard_${version}_x64-setup.exe`);
  if (path.resolve(srcPath) !== path.resolve(dest)) {
    fs.copyFileSync(srcPath, dest);
    const srcSig = `${srcPath}.sig`;
    const destSig = `${dest}.sig`;
    if (fs.existsSync(srcSig) && !fs.existsSync(destSig)) {
      fs.copyFileSync(srcSig, destSig);
    }
  }
  return dest;
}

function readSig(exePath) {
  const sigPath = `${exePath}.sig`;
  if (!fs.existsSync(sigPath)) {
    console.error(`[release] .sig 없음: ${sigPath}`);
    console.error('  TAURI_SIGNING_PRIVATE_KEY 설정 후 npm run tauri:build (createUpdaterArtifacts: true)');
    process.exit(1);
  }
  return fs.readFileSync(sigPath, 'utf8').trim();
}

function publishInstallerToRepo(exePath, exeName) {
  fs.mkdirSync(releasesDir, { recursive: true });
  const destExe = path.join(releasesDir, exeName);
  const destBin = path.join(releasesDir, cdnAssetName(exeName));
  fs.copyFileSync(exePath, destExe);
  fs.copyFileSync(exePath, destBin);
  return destBin;
}

function writeLatestJson(version, signature, exeName) {
  const payload = {
    version: `v${version}`,
    notes: `v${version} release`,
    pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    platforms: {
      'windows-x86_64': {
        url: cdnInstallerUrl(exeName),
        signature,
      },
    },
  };
  const out = path.join(root, 'latest.json');
  fs.writeFileSync(out, `${JSON.stringify(payload)}\n`, 'utf8');
  return out;
}

function gh(args) {
  const r = spawnSync('gh', args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status === 0;
}

const argVersion = process.argv[2]?.replace(/^v/, '');
let version = argVersion || readVersion();
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`[release] 잘못된 버전: ${version}`);
  process.exit(2);
}

console.log(`[release] v${version}`);

const conf = readJson(tauriConfPath);
if (conf.version !== version) {
  conf.version = version;
  fs.writeFileSync(tauriConfPath, `${JSON.stringify(conf, null, 2)}\n`, 'utf8');
}
bumpCargoToml(version);

console.log('[release] npm run tauri:build ...');
run('npx', ['@tauri-apps/cli', 'build', '--ci']);

const srcExe = findNsisExe(version);
if (!srcExe) {
  console.error('[release] NSIS 설치 파일을 찾지 못했습니다.');
  process.exit(1);
}

const exePath = asciiReleaseName(srcExe, version);
const exeName = path.basename(exePath);
const signature = readSig(exePath);
publishInstallerToRepo(exePath, exeName);
const latestPath = writeLatestJson(version, signature, exeName);

const tag = `v${version}`;
console.log('[release] 릴리즈 전 검증 (로컬) ...');
run('node', ['scripts/verify-update-release.mjs', version, '--local']);

console.log(`[release] GitHub 릴리즈: ${tag}`);
if (gh(['release', 'view', tag, '--repo', 'ggugguai-star/Dashboard'])) {
  console.log('[release] 기존 릴리즈에 에셋 업로드');
  if (!gh(['release', 'upload', tag, exePath, `${exePath}.sig`, latestPath, '--repo', 'ggugguai-star/Dashboard', '--clobber'])) process.exit(1);
} else {
  if (!gh(['release', 'create', tag, '--repo', 'ggugguai-star/Dashboard', '--title', tag, '--notes', `v${version} release`])) process.exit(1);
  if (!gh(['release', 'upload', tag, exePath, `${exePath}.sig`, latestPath, '--repo', 'ggugguai-star/Dashboard'])) process.exit(1);
}

console.log('[release] GitHub 릴리즈 후 검증 ...');
run('node', ['scripts/verify-update-release.mjs', version]);

console.log('[release] 완료');
console.log(`  exe: ${exePath}`);
console.log(`  latest.json: ${latestPath}`);
console.log('  필수: latest.json + releases/*.exe 를 main에 commit/push (jsdelivr CDN)');

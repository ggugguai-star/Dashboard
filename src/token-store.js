/**
 * token-store.js — Tauri v2 Google OAuth 토큰 관리
 *
 * 1차: OS Credential Manager (keyring)
 * 2차: %APPDATA%/업무 대시보드/.gcal-tokens.sec (Rust, 소유자 전용)
 * 레거시 gcal-tokens.json: checkMigration() 1회만 이관
 */

const BD_DATA = 4;

const TOKEN_DIR_NAME = '업무 대시보드';
const TOKEN_FILE     = 'gcal-tokens.json';

function invoke(cmd, args, options) {
  return window.__TAURI__.core.invoke(cmd, args, options);
}

function joinPath(base, ...parts) {
  const sep = base.includes('\\') ? '\\' : '/';
  const trimR = s => s.replace(/[/\\]+$/, '');
  const trimL = s => s.replace(/^[/\\]+/, '');
  return [trimR(base), ...parts.map(trimL)].join(sep);
}

async function getTokenPath() {
  const dataDir = await invoke('plugin:path|resolve_directory', { directory: BD_DATA });
  return joinPath(dataDir, TOKEN_DIR_NAME, TOKEN_FILE);
}

async function loadFromSecureStore() {
  const json = await invoke('token_secure_load');
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch (err) {
    console.warn('[TokenStore] JSON 파싱 실패:', err);
    return null;
  }
}

/** @returns {Promise<object>} 저장·검증된 토큰 객체 */
async function saveToSecureStore(tokens) {
  const json = await invoke('token_secure_save', { payload: JSON.stringify(tokens) });
  return JSON.parse(json);
}

async function clearSecureStore() {
  await invoke('token_secure_clear');
}

/**
 * 레거시 파일 1회 이관 (앱 기동 시만 — loadTokens 에서 호출 금지)
 */
async function migrateLegacyFileIfNeeded() {
  try {
    const tokenPath = await getTokenPath();
    const status = await invoke('token_secure_migrate_legacy', { path: tokenPath });
    if (status === 'migrated') {
      console.info('[TokenStore] 레거시 gcal-tokens.json → 보안 저장소 이관 완료');
    }
    return status;
  } catch (err) {
    console.warn('[TokenStore] 마이그레이션 실패:', err);
    return 'error';
  }
}

export async function checkMigration() {
  return migrateLegacyFileIfNeeded();
}

/** keyring + 폴백 파일에서 로드 (마이그레이션 없음) */
export async function loadTokens() {
  try {
    return await loadFromSecureStore();
  } catch (err) {
    console.warn('[TokenStore] 토큰 로드 실패:', err);
    return null;
  }
}

export async function saveTokens(tokens) {
  return saveToSecureStore(tokens);
}

export async function clearTokens() {
  try {
    await clearSecureStore();
  } catch (err) {
    console.warn('[TokenStore] 토큰 삭제 실패:', err);
  }
}

export async function isAuthenticated() {
  const tokens = await loadTokens();
  return !!(tokens?.refresh_token);
}

/**
 * google-api.js — Tauri v2 Google API 레이어 (JS fetch 전용)
 *
 * 5대 원칙 §1 준수: 모든 Google API 통신은 Rust 없이 순수 JS fetch 로 처리한다.
 *
 * ── 모듈 구성 ──────────────────────────────────────────────────────────
 *  [Auth]    getAuthUrl · exchangeCodeForTokens · getValidAccessToken
 *  [Cal]     getCalendarList · getCalendarEvents · createCalendarEvent · updateCalendarEvent · deleteCalendarEvent
 *  [Drive]   listDriveFolder · listDriveImages · listDriveFilesByMime · getDriveImageData
 *            driveTrashFile · driveMoveFile · driveDownloadFile · driveDownloadFolder
 *  [Tasks]   getTaskLists · tasksGetDefaultList · tasksListTasks · tasksCreateTask
 *            tasksPatchTask · tasksDeleteTask
 *
 * ── import 방법 (index.html 에서) ──────────────────────────────────────
 *  <script type="module">
 *    import { getAuthUrl, getCalendarEvents, ... } from './google-api.js';
 *  </script>
 */

import { loadTokens, saveTokens, clearTokens } from './token-store.js';

// ══════════════════════════════════════════════════════════════════════
//  OAuth 설정
// ══════════════════════════════════════════════════════════════════════

const OAUTH = {
  clientId:    '578633255930-cmbmh0ns1a4q7meukntfr6n3o1nmceep.apps.googleusercontent.com',
  clientSecret:'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',
  redirectUri: 'http://127.0.0.1:59123',
  scope: [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/tasks',
  ].join(' '),
};

// ══════════════════════════════════════════════════════════════════════
//  Auth — 인증 URL, 코드 교환, 토큰 갱신
// ══════════════════════════════════════════════════════════════════════

/**
 * Google OAuth2 인증 URL을 반환한다.
 * JS: `plugin-shell open(url)` 로 브라우저 열기 전에 호출한다.
 */
export function getAuthUrl() {
  const params = new URLSearchParams({
    client_id:     OAUTH.clientId,
    redirect_uri:  OAUTH.redirectUri,
    response_type: 'code',
    scope:         OAUTH.scope,
    access_type:   'offline',
    prompt:        'consent',   // 매번 refresh_token 발급 강제
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/**
 * Tauri `auth-code` 이벤트로 수신한 code를 토큰으로 교환하고 저장한다.
 *
 * @param {string} code — OAuth 인증 코드 (oauth.rs 서버가 emit 한 값)
 * @returns {Promise<{success:true}|{error:string}>}
 */
export async function exchangeCodeForTokens(code) {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     OAUTH.clientId,
        client_secret: OAUTH.clientSecret,
        redirect_uri:  OAUTH.redirectUri,
        grant_type:    'authorization_code',
      }),
    });
    const data = await res.json();

    if (data.error) {
      return { error: data.error_description || data.error };
    }
    if (!data.refresh_token) {
      return {
        error: 'refresh_token 없음 — Google 계정 > 앱 접근 권한에서 이 앱을 제거 후 재시도',
      };
    }

    const saved = await saveTokens({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expiry_date:   Date.now() + (data.expires_in ?? 3600) * 1000,
      client_id:     OAUTH.clientId,
      client_secret: OAUTH.clientSecret,
    });

    if (!saved?.refresh_token) {
      return { error: '토큰 저장 확인 실패 — 다시 연결해 주세요' };
    }

    return { success: true };
  } catch (err) {
    const msg = err?.message || String(err);
    if (/저장 후 읽기 실패|token_secure/i.test(msg)) {
      return { error: `토큰 저장 실패: ${msg}` };
    }
    return { error: `토큰 교환 실패: ${msg}` };
  }
}

/**
 * 저장된 refresh_token 으로 새 access_token 을 발급받는다.
 * 내부 헬퍼 — 외부에서는 getValidAccessToken() 을 사용한다.
 */
async function _refreshAccessToken(tokens) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     tokens.client_id     ?? OAUTH.clientId,
      client_secret: tokens.client_secret ?? OAUTH.clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error_description || data.error);
  return data;
}

/**
 * 유효한 access_token 을 반환한다.
 * 만료 60 초 전부터 자동 갱신 후 저장한다.
 * 인증 정보 없거나 갱신 실패 시 null 반환.
 *
 * @returns {Promise<string|null>}
 */
export async function getValidAccessToken() {
  const tokens = await loadTokens();
  if (!tokens?.refresh_token) return null;

  // 만료 60초 이전에 미리 갱신
  if (tokens.expiry_date && Date.now() > tokens.expiry_date - 60_000) {
    try {
      const refreshed = await _refreshAccessToken(tokens);
      tokens.access_token = refreshed.access_token;
      tokens.expiry_date  = Date.now() + (refreshed.expires_in ?? 3600) * 1000;
      if (refreshed.refresh_token) tokens.refresh_token = refreshed.refresh_token;
      await saveTokens(tokens);
    } catch (err) {
      console.error('[GoogleAPI] 토큰 갱신 실패:', err);
      const msg = String(err?.message ?? err);
      if (/invalid_grant|invalid_client|unauthorized|revoked|expired/i.test(msg)) {
        await clearTokens();
      }
      return null;
    }
  }
  return tokens.access_token;
}

// ══════════════════════════════════════════════════════════════════════
//  공통 fetch 헬퍼
// ══════════════════════════════════════════════════════════════════════

/**
 * Google API 공통 fetch.
 * Authorization 헤더 자동 부착 + 에러 정규화.
 * 204 No Content → { success: true }
 * JSON 에러 → { error: string }
 *
 * @param {string}  url
 * @param {object}  [options]  fetch options (method, headers, body …)
 * @returns {Promise<object>}
 */
async function _apiFetch(url, options = {}) {
  const token = await getValidAccessToken();
  if (!token) return { error: 'not_authenticated' };

  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (res.status === 204) return { success: true };

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { error: json.error?.message || `HTTP ${res.status}` };
    }
    if (json.error) {
      return { error: json.error.message || String(json.error) };
    }
    return json;
  } catch (err) {
    return { error: err.message };
  }
}

// ══════════════════════════════════════════════════════════════════════
//  Calendar
// ══════════════════════════════════════════════════════════════════════

function _calendarIdPath(calendarId) {
  return encodeURIComponent(calendarId ?? 'primary');
}

/**
 * 사용자 캘린더 목록을 조회한다.
 *
 * @returns {Promise<{calendars:{id:string,summary:string,primary?:boolean,backgroundColor?:string}[]}|{error:string}>}
 */
export async function getCalendarList() {
  const json = await _apiFetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250'
  );
  if (json.error) return json;
  const calendars = (json.items ?? []).map((item) => ({
    id: item.id,
    summary: item.summary,
    primary: !!item.primary,
    backgroundColor: item.backgroundColor,
  }));
  return { calendars };
}

/**
 * 캘린더 이벤트 목록을 조회한다.
 *
 * @param {{calendarId?:string, timeMin?:string, timeMax?:string}} [params]
 * @returns {Promise<{events:object[]}|{error:string}>}
 */
export async function getCalendarEvents({ calendarId, timeMin, timeMax } = {}) {
  const calPath = _calendarIdPath(calendarId);
  const params = new URLSearchParams({
    timeMin:      timeMin ?? new Date(Date.now() - 7  * 86_400_000).toISOString(),
    timeMax:      timeMax ?? new Date(Date.now() + 60 * 86_400_000).toISOString(),
    singleEvents: 'true',
    orderBy:      'startTime',
    maxResults:   '250',
  });
  const json = await _apiFetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calPath}/events?${params}`
  );
  if (json.error) return json;
  return { events: json.items ?? [] };
}

/**
 * 캘린더 이벤트를 생성한다.
 *
 * @param {object} eventData — Google Calendar 이벤트 리소스
 * @param {{calendarId?:string}} [options]
 * @returns {Promise<{success:true, event:object}|{error:string}>}
 */
export async function createCalendarEvent(eventData, options = {}) {
  const calPath = _calendarIdPath(options.calendarId);
  const json = await _apiFetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calPath}/events`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(eventData),
    }
  );
  if (json.error) return json;
  return { success: true, event: json };
}

/**
 * 캘린더 이벤트를 수정한다 (PUT 전체 교체).
 *
 * @param {string} eventId
 * @param {object} eventData
 * @param {{calendarId?:string}} [options]
 * @returns {Promise<{success:true, event:object}|{error:string}>}
 */
export async function updateCalendarEvent(eventId, eventData, options = {}) {
  const calPath = _calendarIdPath(options.calendarId);
  const json = await _apiFetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calPath}/events/${encodeURIComponent(eventId)}`,
    {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(eventData),
    }
  );
  if (json.error) return json;
  return { success: true, event: json };
}

/**
 * 캘린더 이벤트를 삭제한다.
 *
 * @param {string} eventId
 * @param {{calendarId?:string}} [options]
 * @returns {Promise<{success:true}|{error:string}>}
 */
export async function deleteCalendarEvent(eventId, options = {}) {
  const calPath = _calendarIdPath(options.calendarId);
  return _apiFetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calPath}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE' }
  );
}

// ══════════════════════════════════════════════════════════════════════
//  Drive
// ══════════════════════════════════════════════════════════════════════

/**
 * Drive 폴더 내 파일/하위폴더 목록을 조회한다.
 * folderId 가 null 이면 루트('root') 를 조회한다.
 *
 * @param {string|null} folderId
 * @returns {Promise<{files:object[]}|{error:string}>}
 */
export async function listDriveFolder(folderId) {
  const parentId = folderId || 'root';
  const params = new URLSearchParams({
    q:       `'${parentId}' in parents and trashed=false`,
    fields:  'files(id,name,mimeType,webViewLink,size,parents)',
    orderBy: 'folder,name',
    pageSize:'200',
  });
  const json = await _apiFetch(
    `https://www.googleapis.com/drive/v3/files?${params}`
  );
  if (json.error) return json;
  return { files: json.files ?? [] };
}

/**
 * Drive 폴더 내 이미지 파일 목록을 조회한다.
 *
 * @param {string} folderId
 * @returns {Promise<{files:object[]}|{error:string}>}
 */
export async function listDriveImages(folderId) {
  const mimeTypes = [
    'image/png','image/jpeg','image/jpg','image/gif',
    'image/webp','image/bmp','image/tiff','image/heic','image/heif',
  ];
  const mimeQuery = mimeTypes.map(m => `mimeType='${m}'`).join(' or ');
  const params = new URLSearchParams({
    q:       `'${folderId}' in parents and (${mimeQuery}) and trashed=false`,
    fields:  'files(id,name,mimeType)',
    orderBy: 'name',
    pageSize:'200',
  });
  const json = await _apiFetch(
    `https://www.googleapis.com/drive/v3/files?${params}`
  );
  if (json.error) return json;
  return { files: json.files ?? [] };
}

/**
 * Drive에서 mimeType 으로 Google Workspace 파일 목록을 조회한다.
 *
 * @param {string} mimeType — e.g. application/vnd.google-apps.spreadsheet
 * @param {{ pageSize?: number }} [options]
 * @returns {Promise<{files:object[]}|{error:string}>}
 */
export async function listDriveFilesByMime(mimeType, options = {}) {
  const pageSize = options.pageSize ?? 30;
  const params = new URLSearchParams({
    q:       `mimeType='${mimeType}' and trashed=false`,
    fields:  'files(id,name,mimeType,webViewLink,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: String(pageSize),
  });
  const json = await _apiFetch(
    `https://www.googleapis.com/drive/v3/files?${params}`
  );
  if (json.error) return json;
  return { files: json.files ?? [] };
}

/**
 * Drive 파일을 Base64 로 가져온다 (이미지 미리보기용).
 * 큰 파일(>5MB) 은 브라우저 메모리 이슈가 있을 수 있다.
 *
 * @param {string} fileId
 * @returns {Promise<{data:string, mimeType:string}|{error:string}>}
 */
export async function getDriveImageData(fileId) {
  const token = await getValidAccessToken();
  if (!token) return { error: 'not_authenticated' };

  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return { error: `HTTP ${res.status}` };

    const mimeType = res.headers.get('content-type')?.split(';')[0] ?? 'image/png';
    const buf      = await res.arrayBuffer();

    // Uint8Array → Base64 (청크 분할로 스택 오버플로 방지)
    const bytes     = new Uint8Array(buf);
    const CHUNK     = 8192;
    let   binary    = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return { data: btoa(binary), mimeType };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Drive 파일을 휴지통으로 이동한다.
 *
 * @param {string} fileId
 * @returns {Promise<{success:true}|{error:string}>}
 */
export async function driveTrashFile(fileId) {
  const json = await _apiFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ trashed: true }),
    }
  );
  if (json.error) return json;
  return { success: true };
}

/**
 * Drive 파일/폴더를 다른 폴더로 이동한다.
 *
 * @param {string} fileId
 * @param {string} newParentId  — 대상 폴더 ID
 * @param {string} [oldParentId] — 원본 폴더 ID (없으면 파라미터 생략)
 * @returns {Promise<{success:true}|{error:string}>}
 */
export async function driveMoveFile(fileId, newParentId, oldParentId) {
  const params = new URLSearchParams({ addParents: newParentId, fields: 'id,parents' });
  if (oldParentId) params.set('removeParents', oldParentId);

  const json = await _apiFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`,
    {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({}),
    }
  );
  if (json.error) return json;
  return { success: true };
}

// Google Apps → Office 내보내기 맵
const _EXPORT_MAP = {
  'application/vnd.google-apps.document':
    { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx' },
  'application/vnd.google-apps.spreadsheet':
    { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        ext: '.xlsx' },
  'application/vnd.google-apps.presentation':
    { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: '.pptx' },
  'application/vnd.google-apps.drawing':
    { mime: 'application/pdf',                                                            ext: '.pdf'  },
};

/**
 * Drive 파일을 로컬 폴더에 다운로드한다.
 * Google Apps 파일(Docs/Sheets/Slides) 은 Office 형식으로 내보낸다.
 * plugin-fs binary write 를 사용한다.
 *
 * @param {string} fileId
 * @param {string} fileName
 * @param {string} mimeType
 * @param {string} destPath — 사용자가 선택한 저장 폴더 경로
 * @returns {Promise<{success:true, savedPath:string, fileName:string}|{error:string}>}
 */
export async function driveDownloadFile(fileId, fileName, mimeType, destPath) {
  const token = await getValidAccessToken();
  if (!token) return { error: 'not_authenticated' };

  const isGoogleApp = mimeType?.startsWith('application/vnd.google-apps');
  const exportInfo  = isGoogleApp ? _EXPORT_MAP[mimeType] : null;
  if (isGoogleApp && !exportInfo) return { error: '지원하지 않는 Google 파일 형식이에요' };

  const saveFileName = isGoogleApp
    ? fileName.replace(/\.[^.]+$/, '') + exportInfo.ext
    : fileName;

  const apiUrl = isGoogleApp
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export` +
      `?mimeType=${encodeURIComponent(exportInfo.mime)}`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;

  // 경로 결합 (Windows 백슬래시)
  const sep      = destPath.includes('\\') ? '\\' : '/';
  const savePath = destPath.replace(/[/\\]+$/, '') + sep + saveFileName;

  try {
    const res = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return { error: `HTTP ${res.status}` };

    const buf = await res.arrayBuffer();

    // plugin-fs binary write (ArrayBuffer body + path in headers)
    await window.__TAURI__.core.invoke(
      'plugin:fs|write_file',
      new Uint8Array(buf),
      {
        headers: {
          path:    encodeURIComponent(savePath),
          options: JSON.stringify({}),
        },
      }
    );
    return { success: true, savedPath: savePath, fileName: saveFileName };
  } catch (err) {
    return { error: err.message };
  }
}

const _FOLDER_MIME = 'application/vnd.google-apps.folder';

function _joinPath(dir, name) {
  const sep = String(dir).includes('\\') ? '\\' : '/';
  return String(dir).replace(/[/\\]+$/, '') + sep + name;
}

async function _ensureLocalDir(path) {
  try {
    await window.__TAURI__.core.invoke('plugin:fs|mkdir', {
      path,
      options: { recursive: true },
    });
  } catch {
    /* 이미 존재할 수 있음 */
  }
}

/** 폴더 내 전체 파일 목록 (페이지네이션) */
async function _listAllDriveFolderFiles(folderId) {
  const all = [];
  let pageToken = '';
  const parentId = folderId || 'root';
  do {
    const params = new URLSearchParams({
      q: `'${parentId}' in parents and trashed=false`,
      fields: 'nextPageToken,files(id,name,mimeType,webViewLink,size,parents)',
      orderBy: 'folder,name',
      pageSize: '200',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const json = await _apiFetch(`https://www.googleapis.com/drive/v3/files?${params}`);
    if (json.error) return json;
    all.push(...(json.files ?? []));
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return { files: all };
}

async function _downloadDriveFolderRecursive(folderId, folderName, destParentPath, stats) {
  const localPath = _joinPath(destParentPath, folderName);
  await _ensureLocalDir(localPath);

  const listing = await _listAllDriveFolderFiles(folderId);
  if (listing.error) {
    stats.errors.push(`${folderName}: ${listing.error}`);
    return;
  }

  for (const f of listing.files) {
    if (f.mimeType === _FOLDER_MIME) {
      await _downloadDriveFolderRecursive(f.id, f.name, localPath, stats);
      continue;
    }
    const isGoogleApp = f.mimeType?.startsWith('application/vnd.google-apps');
    const exportInfo = isGoogleApp ? _EXPORT_MAP[f.mimeType] : null;
    if (isGoogleApp && !exportInfo) {
      stats.skipped.push(f.name);
      continue;
    }
    const result = await driveDownloadFile(f.id, f.name, f.mimeType, localPath);
    if (result.error) stats.errors.push(`${f.name}: ${result.error}`);
    else stats.downloaded += 1;
  }
}

/**
 * Drive 폴더를 로컬 경로에 재귀 다운로드한다.
 * (Google은 폴더 zip API가 없어 하위 항목을 순회한다)
 *
 * @param {string} folderId
 * @param {string} folderName
 * @param {string} destPath — 로컬 부모 폴더 경로
 */
export async function driveDownloadFolder(folderId, folderName, destPath) {
  const token = await getValidAccessToken();
  if (!token) return { error: 'not_authenticated' };

  const stats = { downloaded: 0, skipped: [], errors: [] };
  await _downloadDriveFolderRecursive(folderId, folderName, destPath, stats);

  const savedPath = _joinPath(destPath, folderName);
  if (stats.downloaded === 0 && stats.errors.length) {
    return { error: stats.errors[0] };
  }
  return {
    success: true,
    savedPath,
    folderName,
    downloaded: stats.downloaded,
    skipped: stats.skipped.length,
    errors: stats.errors,
  };
}

// ══════════════════════════════════════════════════════════════════════
//  Tasks
// ══════════════════════════════════════════════════════════════════════

/**
 * 사용자 Tasks 목록 전체를 조회한다.
 *
 * @returns {Promise<{lists:{id:string,title:string}[]}|{error:string}>}
 */
export async function getTaskLists() {
  const json = await _apiFetch(
    'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100',
  );
  if (json.error) return json;
  const lists = (json.items ?? []).map((item) => ({
    id: item.id,
    title: item.title,
  }));
  return { lists };
}

/**
 * 기본 Tasks 목록('My Tasks' / '내 할 일') 의 ID 를 반환한다.
 *
 * @returns {Promise<{id:string, title:string}|{error:string}>}
 */
export async function tasksGetDefaultList() {
  const json = await _apiFetch(
    'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=20'
  );
  if (json.error) return json;
  const list =
    json.items?.find(l => l.title === 'My Tasks' || l.title === '내 할 일') ??
    json.items?.[0];
  return list ? { id: list.id, title: list.title } : { error: 'no_tasklist' };
}

/**
 * Tasks 목록 내 모든 항목(완료 포함) 을 조회한다.
 *
 * @param {string} listId
 * @returns {Promise<object>}
 */
export async function tasksListTasks(listId) {
  return _apiFetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks` +
    `?maxResults=100&showCompleted=true&showHidden=false`
  );
}

/**
 * 새 Task 를 생성한다.
 *
 * @param {string} listId
 * @param {{title:string, notes?:string}} task
 * @returns {Promise<object>}
 */
export async function tasksCreateTask(listId, { title, notes = '' }) {
  return _apiFetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ title, notes }),
    }
  );
}

/**
 * Task 의 제목 또는 상태를 수정한다 (PATCH).
 *
 * @param {string} listId
 * @param {string} taskId
 * @param {{title?:string, status?:'needsAction'|'completed'}} patch
 * @returns {Promise<object>}
 */
export async function tasksPatchTask(listId, taskId, { title, status } = {}) {
  const body = {};
  if (title  !== undefined) body.title  = title;
  if (status !== undefined) body.status = status;
  return _apiFetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    }
  );
}

/**
 * Task 를 삭제한다.
 *
 * @param {string} listId
 * @param {string} taskId
 * @returns {Promise<{success:true}|{error:string}>}
 */
export async function tasksDeleteTask(listId, taskId) {
  return _apiFetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: 'DELETE' }
  );
}

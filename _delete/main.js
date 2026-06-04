const {
  app, BrowserWindow, ipcMain, shell,
  Tray, Menu, nativeImage, screen, globalShortcut, dialog, clipboard,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs   = require('fs');
const http = require('http');
const https = require('https');
const zlib = require('zlib');

/* ── 렌더링 성능 최적화 — 60fps 보장 ── */
// 백그라운드 상태에서도 타이머/렌더러 쓰로틀링 비활성화
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
// GPU 래스터화 활성화 → CSS 애니메이션 하드웨어 가속
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

/* ── Auto-Updater 설정 ── */
autoUpdater.autoDownload        = true;   // 업데이트 발견 시 자동 다운로드
autoUpdater.autoInstallOnAppQuit = true;  // 앱 종료 시 자동 설치

autoUpdater.on('update-available', (info) => {
  console.log('[업데이트] 새 버전 발견:', info.version);
  if (win) win.webContents.send('update-status', { type: 'available', version: info.version });
});

autoUpdater.on('download-progress', (prog) => {
  const pct = Math.round(prog.percent);
  if (win) win.webContents.send('update-status', { type: 'progress', percent: pct });
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('[업데이트] 다운로드 완료:', info.version);
  if (win) win.webContents.send('update-status', { type: 'downloaded', version: info.version });
});

autoUpdater.on('update-not-available', () => {
  console.log('[업데이트] 최신 버전입니다.');
  if (win) win.webContents.send('update-status', { type: 'not-available' });
});

autoUpdater.on('error', (err) => {
  console.error('[업데이트] 오류:', err.message);
  if (win) win.webContents.send('update-status', { type: 'error', message: err.message });
});

/* ── 컬러 아이콘 생성 (외부 파일 불필요) ── */
function makePngIcon(r, g, b, size = 16) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  function crc32(buf) {
    let v = 0xFFFFFFFF;
    for (const b of buf) v = table[(v ^ b) & 0xFF] ^ (v >>> 8);
    return (v ^ 0xFFFFFFFF) >>> 0;
  }
  function chunk(type, data) {
    const t = Buffer.from(type), len = Buffer.alloc(4), crcB = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    crcB.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crcB]);
  }
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) { row[1+x*3]=r; row[2+x*3]=g; row[3+x*3]=b; }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ══════════════════════════════════════════
   내장 OAuth 자격증명 (Desktop App 방식)
══════════════════════════════════════════ */
const BUILT_IN_CLIENT_ID     = '578633255930-cmbmh0ns1a4q7meukntfr6n3o1nmceep.apps.googleusercontent.com';
const BUILT_IN_CLIENT_SECRET = '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';

/* ══════════════════════════════════════════
   Google OAuth 토큰 저장/로드
══════════════════════════════════════════ */
const TOKENS_PATH = path.join(app.getPath('userData'), 'gcal-tokens.json');

function loadTokens() {
  try {
    if (fs.existsSync(TOKENS_PATH)) {
      return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
    }
  } catch {}
  return null;
}

function saveTokens(tokens) {
  try {
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2), 'utf8');
  } catch (e) {
    console.error('토큰 저장 실패:', e);
  }
}

/* ── 액세스 토큰 갱신 ── */
function refreshAccessToken(tokens) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      client_id:     tokens.client_id     || BUILT_IN_CLIENT_ID,
      client_secret: tokens.client_secret || BUILT_IN_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }).toString();

    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error_description || json.error));
          else resolve(json);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/* ── 유효한 액세스 토큰 반환 (만료 시 자동 갱신) ── */
async function getValidAccessToken() {
  const tokens = loadTokens();
  if (!tokens || !tokens.refresh_token) return null;

  // 만료 60초 전부터 갱신
  if (tokens.expiry_date && Date.now() > tokens.expiry_date - 60_000) {
    try {
      const refreshed = await refreshAccessToken(tokens);
      tokens.access_token = refreshed.access_token;
      tokens.expiry_date  = Date.now() + refreshed.expires_in * 1000;
      if (refreshed.refresh_token) tokens.refresh_token = refreshed.refresh_token;
      saveTokens(tokens);
    } catch (e) {
      console.error('토큰 갱신 실패:', e);
      return null;
    }
  }
  return tokens.access_token;
}

/* ── Google Calendar 이벤트 생성 ── */
async function createCalendarEventAPI(eventData) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return { error: 'not_authenticated' };

  return new Promise((resolve) => {
    const body = JSON.stringify(eventData);
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: '/calendar/v3/calendars/primary/events',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) resolve({ error: json.error.message });
          else resolve({ success: true, event: json });
        } catch (e) { resolve({ error: e.message }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.write(body);
    req.end();
  });
}

/* ── Google Calendar 이벤트 수정 (PUT) ── */
async function updateCalendarEventAPI(eventId, eventData) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return { error: 'not_authenticated' };

  return new Promise((resolve) => {
    const body = JSON.stringify(eventData);
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: `/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) resolve({ error: json.error.message });
          else resolve({ success: true, event: json });
        } catch (e) { resolve({ error: e.message }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.write(body);
    req.end();
  });
}

/* ── Google Calendar 이벤트 삭제 ── */
async function deleteCalendarEventAPI(eventId) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return { error: 'not_authenticated' };

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: `/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }, (res) => {
      // 204 No Content = 성공
      if (res.statusCode === 204) { resolve({ success: true }); return; }
      res.setEncoding('utf8');
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ error: json.error?.message || `HTTP ${res.statusCode}` });
        } catch { resolve({ error: `HTTP ${res.statusCode}` }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.end();
  });
}

/* ── Google Drive 폴더 전체 파일 목록 (탐색기용) ── */
async function listDriveFolderAPI(folderId) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return { error: 'not_authenticated' };

  return new Promise((resolve) => {
    const q = folderId
      ? `'${folderId}' in parents and trashed=false`
      : `'root' in parents and trashed=false`;
    const params = new URLSearchParams({
      q,
      fields: 'files(id,name,mimeType,webViewLink,size)',
      orderBy: 'folder,name',
      pageSize: '200',
    });
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: `/drive/v3/files?${params}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    }, (res) => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) resolve({ error: json.error.message });
          else resolve({ files: json.files || [] });
        } catch (e) { resolve({ error: e.message }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.end();
  });
}

/* ── Google Drive 파일 휴지통으로 이동 ── */
async function driveTrashFileAPI(fileId) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return { error: 'not_authenticated' };

  return new Promise((resolve) => {
    const body = JSON.stringify({ trashed: true });
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: `/drive/v3/files/${encodeURIComponent(fileId)}`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode === 200) resolve({ success: true });
        else {
          try { resolve({ error: JSON.parse(data).error?.message || `HTTP ${res.statusCode}` }); }
          catch { resolve({ error: `HTTP ${res.statusCode}` }); }
        }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.write(body);
    req.end();
  });
}

/* ── Google Drive 파일/폴더 이동 ── */
async function driveMoveFileAPI(fileId, newParentId, oldParentId) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return { error: 'not_authenticated' };

  return new Promise((resolve) => {
    const params = new URLSearchParams({
      addParents: newParentId,
      removeParents: oldParentId,
      fields: 'id,parents',
    }).toString();
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: `/drive/v3/files/${encodeURIComponent(fileId)}?${params}`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': 2,
      },
    }, (res) => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode === 200) resolve({ success: true });
        else {
          try { resolve({ error: JSON.parse(data).error?.message || `HTTP ${res.statusCode}` }); }
          catch { resolve({ error: `HTTP ${res.statusCode}` }); }
        }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.write('{}');
    req.end();
  });
}

/* ── Google Drive 파일 다운로드 → 로컬 경로에 저장 ── */
async function driveDownloadFileAPI(fileId, fileName, mimeType, destPath) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return { error: 'not_authenticated' };

  const GOOGLE_EXPORT_MAP = {
    'application/vnd.google-apps.document':
      { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx' },
    'application/vnd.google-apps.spreadsheet':
      { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        ext: '.xlsx' },
    'application/vnd.google-apps.presentation':
      { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: '.pptx' },
    'application/vnd.google-apps.drawing':
      { mime: 'application/pdf',                                                            ext: '.pdf'  },
  };

  const isGoogleApp = mimeType.startsWith('application/vnd.google-apps');
  const exportInfo  = GOOGLE_EXPORT_MAP[mimeType];
  if (isGoogleApp && !exportInfo) return { error: '지원하지 않는 Google 파일 형식이에요' };

  const saveFileName = isGoogleApp
    ? fileName.replace(/\.[^.]+$/, '') + exportInfo.ext
    : fileName;
  const apiPath = isGoogleApp
    ? `/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportInfo.mime)}`
    : `/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const savePath = path.join(destPath, saveFileName);

  return new Promise((resolve) => {
    function doDownload(hostname, urlPath, useHttps) {
      const mod = useHttps ? https : http;
      mod.request({ hostname, path: urlPath, method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` } }, (res) => {
        if ([301,302,307,308].includes(res.statusCode)) {
          const loc = new URL(res.headers.location);
          doDownload(loc.hostname, loc.pathname + (loc.search || ''), loc.protocol === 'https:');
          return;
        }
        if (res.statusCode !== 200) {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => {
            try { resolve({ error: JSON.parse(d).error?.message || `HTTP ${res.statusCode}` }); }
            catch { resolve({ error: `HTTP ${res.statusCode}` }); }
          });
          return;
        }
        const fileStream = fs.createWriteStream(savePath);
        res.pipe(fileStream);
        fileStream.on('finish', () => { fileStream.close(); resolve({ success: true, savedPath: savePath, fileName: saveFileName }); });
        fileStream.on('error',  e => resolve({ error: e.message }));
      }).on('error', e => resolve({ error: e.message })).end();
    }
    doDownload('www.googleapis.com', apiPath, true);
  });
}

/* ── Google Drive 폴더 이미지 목록 ── */
async function listDriveImagesAPI(folderId) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return { error: 'not_authenticated' };

  return new Promise((resolve) => {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and (mimeType='image/png' or mimeType='image/jpeg' or mimeType='image/jpg' or mimeType='image/gif' or mimeType='image/webp' or mimeType='image/bmp' or mimeType='image/tiff' or mimeType='image/heic' or mimeType='image/heif') and trashed=false`,
      fields: 'files(id,name,mimeType)',
      orderBy: 'name',
      pageSize: '200',
    });
    const req = https.request({
      hostname: 'www.googleapis.com',
      path: `/drive/v3/files?${params}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    }, (res) => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) resolve({ error: json.error.message });
          else resolve({ files: json.files || [] });
        } catch (e) { resolve({ error: e.message }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.end();
  });
}

/* ── Google Drive 파일 → Base64 ── */
async function getDriveImageDataAPI(fileId) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return { error: 'not_authenticated' };

  return new Promise((resolve) => {
    function downloadFrom(hostname, path, isHttps) {
      const mod = isHttps ? https : http;
      const req = mod.request({ hostname, path, method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const loc = new URL(res.headers.location);
          downloadFrom(loc.hostname, loc.pathname + (loc.search||''), loc.protocol === 'https:');
          return;
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const mimeType = res.headers['content-type']?.split(';')[0] || 'image/png';
          resolve({ data: buf.toString('base64'), mimeType });
        });
      });
      req.on('error', e => resolve({ error: e.message }));
      req.end();
    }
    downloadFrom('www.googleapis.com', `/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, true);
  });
}

/* ── Google Calendar API 호출 ── */
async function fetchCalendarEventsFromAPI(timeMin, timeMax) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return { error: 'not_authenticated' };

  return new Promise((resolve) => {
    const params = new URLSearchParams({
      timeMin:      timeMin || new Date(Date.now() - 7  * 86400_000).toISOString(),
      timeMax:      timeMax || new Date(Date.now() + 60 * 86400_000).toISOString(),
      singleEvents: 'true',
      orderBy:      'startTime',
      maxResults:   '250',
    });

    const req = https.request({
      hostname: 'www.googleapis.com',
      path: `/calendar/v3/calendars/primary/events?${params}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    }, (res) => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) resolve({ error: json.error.message });
          else            resolve({ events: json.items || [] });
        } catch (e) { resolve({ error: e.message }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.end();
  });
}

/* ══════════════════════════════════════════
   창 위치 저장/복원 (멀티모니터 지원)
══════════════════════════════════════════ */
const BOUNDS_FILE = path.join(app.getPath('userData'), 'window-bounds.json');

function loadSavedBounds() {
  try { return JSON.parse(fs.readFileSync(BOUNDS_FILE, 'utf8')); } catch { return null; }
}

function saveBounds(bounds) {
  try { fs.writeFileSync(BOUNDS_FILE, JSON.stringify(bounds), 'utf8'); } catch {}
}

/** 저장된 디스플레이가 여전히 연결돼 있으면 복원, 없으면 커서 위치 디스플레이로 fallback */
function getInitialBounds() {
  const saved = loadSavedBounds();
  if (saved && saved.displayId) {
    const match = screen.getAllDisplays().find(d => d.id === saved.displayId);
    if (match) return { ...match.workArea, displayId: match.id };
  }
  // fallback: 커서가 있는 디스플레이 작업 영역 전체
  const cursor  = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  return { ...display.workArea, displayId: display.id };
}

/* ── 창 생성 ── */
let win, tray, oauthServer = null;

function createWindow() {
  const initBounds = getInitialBounds();

  win = new BrowserWindow({
    x: initBounds.x,
    y: initBounds.y,
    width:  initBounds.width,
    height: initBounds.height,
    frame: false,
    transparent: false,
    skipTaskbar: true,
    resizable: false,
    movable: true,          // 상단 바 드래그로 모니터 이동 허용
    alwaysOnTop: false,
    focusable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,   // 비활성 상태에서도 60fps 유지
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  win.once('ready-to-show', () => {
    win.showInactive();
    // 창 표시 3초 후 업데이트 확인 (시작 속도에 영향 없도록)
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(e => console.error('[업데이트] 확인 실패:', e.message));
    }, 3000);
  });

  // 드래그 완료 → 현재 디스플레이 작업 영역 전체로 스냅 + 위치 저장
  win.on('moved', () => {
    const b  = win.getBounds();
    const cx = b.x + b.width  / 2;
    const cy = b.y + b.height / 2;
    const display = screen.getDisplayNearestPoint({ x: cx, y: cy });
    const wa = display.workArea;
    win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height }, true);
    saveBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height, displayId: display.id });
  });

  win.on('close', (e) => { e.preventDefault(); win.hide(); });
}

/* ── 시스템 트레이 ── */
function setupTray() {
  const iconBuf = makePngIcon(124, 58, 237);
  const icon = nativeImage.createFromBuffer(iconBuf).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('업무 대시보드');

  const buildMenu = () => Menu.buildFromTemplate([
    { label: win.isVisible() ? '대시보드 숨기기' : '대시보드 보이기', click: toggleWindow },
    { type: 'separator' },
    { label: '항상 앞에 표시', type: 'checkbox', checked: win.isAlwaysOnTop(),
      click: (item) => win.setAlwaysOnTop(item.checked) },
    { type: 'separator' },
    { label: '종료', click: () => { win.removeAllListeners('close'); app.quit(); } },
  ]);

  tray.on('click', toggleWindow);
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
  tray.on('double-click', toggleWindow);
}

function toggleWindow() {
  if (!win) return;
  win.isVisible() ? win.hide() : win.showInactive();
  tray.setContextMenu(null);
}

/* ── 앱 시작 ── */
app.whenReady().then(() => {
  createWindow();
  setupTray();
  globalShortcut.register('CommandOrControl+Alt+D', toggleWindow);
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('window-all-closed', () => {});
app.on('will-quit', () => globalShortcut.unregisterAll());

/* ══════════════════════════════════════════
   IPC 핸들러
══════════════════════════════════════════ */

/* URL은 브라우저로, 파일/폴더 경로는 탐색기/기본앱으로 열기 */
ipcMain.handle('open-url', async (_e, url) => {
  if (!url) return { error: '경로 없음' };
  console.log('[open-url] 요청 경로:', url);
  // http(s):// 등 프로토콜 있으면 외부 브라우저
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//i.test(url)) {
    await shell.openExternal(url);
    return { success: true };
  }
  // 파일/폴더 경로 — shell.openPath 반환값은 에러 문자열 (빈 문자열 = 성공)
  const err = await shell.openPath(url);
  if (err) {
    console.error('[open-url] openPath 실패:', err, '| 경로:', url);
    // 실패 시 탐색기에서 파일 위치 표시로 폴백
    shell.showItemInFolder(url);
    return { error: err };
  }
  return { success: true };
});

/* 앱 종료 */
ipcMain.handle('quit-app', () => {
  win.removeAllListeners('close');
  app.quit();
});

/* 창 최소화 */
ipcMain.handle('minimize-window', () => { if (win) win.minimize(); });

/* 스크린 캡처 — 캡처 도구 실행 + 클립보드 폴링 → 이미지 감지 시 자동 복귀 */
ipcMain.handle('start-screen-capture', async () => {
  // 현재 클립보드 상태 저장 (비교용)
  const prevImg  = clipboard.readImage();
  const prevHash = prevImg.isEmpty() ? '' : prevImg.toDataURL().slice(0, 120);

  // 창 최소화 후 Windows 캡처 도구 실행
  if (win) win.minimize();
  shell.openExternal('ms-screenclip:').catch(() => {
    // ms-screenclip 불가 시 Snipping Tool 직접 실행
    require('child_process').exec('SnippingTool.exe /clip');
  });

  // 클립보드 폴링 (300ms 간격, 최대 60초)
  return new Promise(resolve => {
    let elapsed = 0;
    const poll = setInterval(() => {
      elapsed += 300;
      if (elapsed > 60000) { clearInterval(poll); resolve(null); return; }

      const img = clipboard.readImage();
      if (img.isEmpty()) return;
      const hash = img.toDataURL().slice(0, 120);
      if (hash === prevHash) return;

      clearInterval(poll);

      // 64×64 center-crop (NativeImage API)
      const size = img.getSize();
      const s  = Math.min(size.width, size.height);
      const sx = Math.floor((size.width  - s) / 2);
      const sy = Math.floor((size.height - s) / 2);
      const cropped = img.crop({ x: sx, y: sy, width: s, height: s });
      const resized = cropped.resize({ width: 64, height: 64 });
      const dataURL = resized.toDataURL();

      // 창 복귀 후 렌더러에 전달
      if (win) { win.restore(); win.show(); win.focus(); }
      setTimeout(() => {
        if (win && !win.isDestroyed()) win.webContents.send('capture-image-ready', dataURL);
      }, 350);
      resolve(dataURL);
    }, 300);
  });
});

/* 업데이트 설치 (다운로드 완료 후 재시작 — NSIS silent 모드) */
ipcMain.handle('install-update', () => {
  // isSilent=true  : NSIS 설치 창 없이 백그라운드 설치
  // isForceRunAfter=true : 설치 후 앱 자동 재시작
  autoUpdater.quitAndInstall(true, true);
});

/* 수동 업데이트 확인 */
ipcMain.handle('check-for-updates', async () => {
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    if (win) win.webContents.send('update-status', { type: 'error', message: e.message });
  }
});

/* 앱 버전 반환 */
ipcMain.handle('get-app-version', () => app.getVersion());

/* 알림 발화 시 창을 앞으로 가져오기 */
ipcMain.handle('focus-window', () => {
  if(!win) return;
  // screen-saver 레벨로 일시적으로 alwaysOnTop 설정 → Windows 포커스 도용 방지 우회
  win.setAlwaysOnTop(true, 'screen-saver');
  win.show();
  win.focus();
  // 5초 뒤 원래 상태(alwaysOnTop: false)로 복구
  setTimeout(() => { if(win) win.setAlwaysOnTop(false); }, 5000);
});

/* 경로가 폴더인지 파일인지 판별 */
ipcMain.handle('stat-path', (_e, filePath) => {
  try   { return { isDir: fs.statSync(filePath).isDirectory() }; }
  catch { return { isDir: false }; }
});

/* ── Google 인증 상태 확인 ── */
ipcMain.handle('get-auth-status', () => {
  const tokens = loadTokens();
  return { authenticated: !!(tokens && tokens.refresh_token) };
});

/* ════════════════════════════════════════
   Google Tasks API
════════════════════════════════════════ */
function googleTasksRequest(method, path, body, accessToken) {
  return new Promise((resolve) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request({
      hostname: 'tasks.googleapis.com',
      path,
      method,
      headers,
    }, (res) => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 204) { resolve({ success: true }); return; }
        if (res.statusCode === 401 || res.statusCode === 403) {
          try {
            const body = JSON.parse(data);
            const msg  = body?.error?.message || body?.error || data.slice(0, 200);
            console.error('[Tasks API] ' + res.statusCode + ':', msg);
            resolve({ error: 'tasks_auth_required', status: res.statusCode, detail: msg }); return;
          } catch { resolve({ error: 'tasks_auth_required', status: res.statusCode }); return; }
        }
        try {
          const json = JSON.parse(data);
          if (json.error) resolve({ error: json.error.message || json.error, status: res.statusCode });
          else resolve({ success: true, ...json });
        } catch (e) { resolve({ error: e.message }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/* 기본 태스크 목록 ID 조회 */
ipcMain.handle('tasks-get-default-list', async () => {
  const token = await getValidAccessToken();
  if (!token) return { error: 'not_authenticated' };
  const result = await googleTasksRequest('GET', '/tasks/v1/users/@me/lists?maxResults=20', null, token);
  if (result.error) return result;
  const list = result.items?.find(l => l.title === 'My Tasks' || l.title === '내 할 일') || result.items?.[0];
  return list ? { id: list.id, title: list.title } : { error: 'no_tasklist' };
});

/* 태스크 목록 조회 (완료 포함) */
ipcMain.handle('tasks-list-tasks', async (_e, taskListId) => {
  const token = await getValidAccessToken();
  if (!token) return { error: 'not_authenticated' };
  const path = `/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks?maxResults=100&showCompleted=true&showHidden=false`;
  return await googleTasksRequest('GET', path, null, token);
});

/* 태스크 생성 */
ipcMain.handle('tasks-create-task', async (_e, { taskListId, title, notes }) => {
  const token = await getValidAccessToken();
  if (!token) return { error: 'not_authenticated' };
  const path = `/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks`;
  return await googleTasksRequest('POST', path, { title, notes: notes || '' }, token);
});

/* 태스크 상태/제목 수정 (PATCH) */
ipcMain.handle('tasks-patch-task', async (_e, { taskListId, taskId, title, status }) => {
  const token = await getValidAccessToken();
  if (!token) return { error: 'not_authenticated' };
  const path = `/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`;
  const body = {};
  if (title  !== undefined) body.title  = title;
  if (status !== undefined) body.status = status; // 'needsAction' | 'completed'
  return await googleTasksRequest('PATCH', path, body, token);
});

/* 태스크 삭제 */
ipcMain.handle('tasks-delete-task', async (_e, { taskListId, taskId }) => {
  const token = await getValidAccessToken();
  if (!token) return { error: 'not_authenticated' };
  const path = `/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`;
  return await googleTasksRequest('DELETE', path, null, token);
});

/* ── Google Calendar 이벤트 가져오기 ── */
ipcMain.handle('get-calendar-events', async (_e, params = {}) => {
  return await fetchCalendarEventsFromAPI(params.timeMin, params.timeMax);
});

/* ── Google Calendar 이벤트 생성 ── */
ipcMain.handle('create-calendar-event',  async (_e, eventData) => createCalendarEventAPI(eventData));
ipcMain.handle('update-calendar-event',  async (_e, { eventId, eventData }) => updateCalendarEventAPI(eventId, eventData));
ipcMain.handle('delete-calendar-event',  async (_e, eventId) => deleteCalendarEventAPI(eventId));
ipcMain.handle('list-drive-images',      async (_e, folderId)                       => listDriveImagesAPI(folderId));
ipcMain.handle('list-drive-folder',      async (_e, folderId)                       => listDriveFolderAPI(folderId));
ipcMain.handle('get-drive-image-data',   async (_e, fileId)                         => getDriveImageDataAPI(fileId));
ipcMain.handle('drive-trash-file',       async (_e, fileId)                         => driveTrashFileAPI(fileId));
ipcMain.handle('drive-move-file',        async (_e, fileId, newParentId, oldParentId) => driveMoveFileAPI(fileId, newParentId, oldParentId));
ipcMain.handle('drive-download-file',    async (_e, fileId, fileName, mimeType, destPath) => driveDownloadFileAPI(fileId, fileName, mimeType, destPath));
ipcMain.handle('select-download-folder', async () => {
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: '다운로드할 폴더 선택' });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

/* ── Google 연결 해제 (토큰 삭제) ── */
ipcMain.handle('google-disconnect', () => {
  try { fs.unlinkSync(TOKENS_PATH); } catch {}
  return { success: true };
});

/* ── Windows 시작 시 자동 실행 ── */
ipcMain.handle('get-login-item', () => {
  return app.getLoginItemSettings({ openAtLogin: true });
});
ipcMain.handle('set-login-item', (_e, enable) => {
  app.setLoginItemSettings({ openAtLogin: !!enable });
  return { success: true };
});

/* ── Google OAuth2 (설치된 앱 방식 — 자격증명 내장) ── */
ipcMain.handle('google-auth-start', (ipcEvt, params) => {
  // 파라미터 없이 호출하면 내장 크레덴셜 사용
  const clientId     = params?.clientId     || BUILT_IN_CLIENT_ID;
  const clientSecret = params?.clientSecret || BUILT_IN_CLIENT_SECRET;
  const PORT = 59123;
  const SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/tasks',
  ].join(' ');

  // 렌더러에 실시간 상태 전송
  const sendStatus = (msg) => {
    console.log('[OAuth]', msg);
    try { ipcEvt.sender.send('auth-update', msg); } catch {}
  };

  // 이전 서버가 남아있으면 먼저 정리
  if (oauthServer) {
    try { oauthServer.close(); } catch {}
    oauthServer = null;
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (oauthServer) { try { oauthServer.close(); } catch {} oauthServer = null; }
      sendStatus('❌ 인증 시간 초과 (5분)');
      resolve({ success: false, error: '인증 시간 초과 (5분)' });
    }, 5 * 60 * 1000);

    oauthServer = http.createServer(async (req, res) => {
      try {
        const { URL } = require('url');
        const u     = new URL(req.url, `http://localhost:${PORT}`);
        const code  = u.searchParams.get('code');
        const error = u.searchParams.get('error');

        // favicon.ico 등 OAuth 콜백이 아닌 요청은 무시
        if (!code && !error) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body></body></html>');
          return;
        }

        clearTimeout(timer);

        const page = (msg) =>
          `<html><meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding:60px">
           <h2>${msg}</h2><p>이 창을 닫아주세요.</p></body></html>`;

        if (code) {
          sendStatus('🔄 Google 인증 코드 수신 — 토큰 교환 중...');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(page('✅ Google 계정 연결 완료! 이 창을 닫아주세요.'));
          if (oauthServer) { try { oauthServer.close(); } catch {} oauthServer = null; }
          try {
            const tokenData = await exchangeCode(code, clientId, clientSecret, PORT);
            if (!tokenData.refresh_token) {
              sendStatus('⚠️ refresh_token 없음 — Google Console에서 앱 접근을 취소 후 재시도');
              resolve({ success: false, error: 'refresh_token이 없습니다. Google 계정 > 앱 접근 권한에서 이 앱을 제거한 뒤 다시 시도해 주세요.' });
              return;
            }
            saveTokens({
              access_token:  tokenData.access_token,
              refresh_token: tokenData.refresh_token,
              expiry_date:   Date.now() + (tokenData.expires_in || 3600) * 1000,
              client_id:     clientId,
              client_secret: clientSecret,
            });
            sendStatus('✅ 토큰 저장 완료 — 연결 성공!');
            resolve({ success: true });
          } catch (e) {
            sendStatus('❌ 토큰 교환 실패: ' + e.message);
            resolve({ success: false, error: '토큰 교환 실패: ' + e.message });
          }
        } else {
          sendStatus('❌ Google 인증 거부: ' + (error || '알 수 없는 오류'));
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(page('❌ 인증 실패: ' + (error || '알 수 없는 오류')));
          if (oauthServer) { try { oauthServer.close(); } catch {} oauthServer = null; }
          resolve({ success: false, error: error || '인증 거부됨' });
        }
      } catch (e) {
        sendStatus('❌ 서버 처리 오류: ' + e.message);
        try { res.end('Error'); } catch {}
        resolve({ success: false, error: e.message });
      }
    });

    oauthServer.listen(PORT, '127.0.0.1', () => {
      sendStatus('🟢 로컬 서버 준비 (포트 ' + PORT + ') — 브라우저 오픈 중...');
      const authParams = new URLSearchParams({
        client_id:     clientId,
        redirect_uri:  `http://127.0.0.1:${PORT}`,
        response_type: 'code',
        scope:         SCOPES,
        access_type:   'offline',
        prompt:        'consent',
      });
      shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${authParams}`);
      sendStatus('🌐 브라우저 열림 — Google 계정 선택 후 허용을 클릭하세요');
    });

    oauthServer.on('error', (e) => {
      clearTimeout(timer);
      oauthServer = null;
      sendStatus('❌ 포트 오류: ' + e.message);
      resolve({ success: false, error: `포트 ${PORT} 사용 불가: ${e.message}` });
    });
  });
});

function exchangeCode(code, clientId, clientSecret, port) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      code,
      client_id:     clientId,
      client_secret: clientSecret,
      redirect_uri:  `http://127.0.0.1:${port}`,
      grant_type:    'authorization_code',
    }).toString();

    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      res.setEncoding('utf8');
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error_description || json.error));
          else resolve(json);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

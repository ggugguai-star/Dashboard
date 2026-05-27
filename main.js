const {
  app, BrowserWindow, ipcMain, shell,
  Tray, Menu, nativeImage, screen, globalShortcut,
} = require('electron');
const path = require('path');
const fs   = require('fs');
const http = require('http');
const https = require('https');
const zlib = require('zlib');

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
  ihdr[8] = 8; ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── 창 생성 ── */
let win, tray;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    x: 0,
    y: 0,
    width,
    height,
    frame: false,          // 제목표시줄 없음
    transparent: false,
    skipTaskbar: true,     // 작업표시줄·Alt+Tab에서 숨김
    resizable: false,
    movable: false,
    alwaysOnTop: false,    // 항상 다른 창 뒤에 위치
    focusable: true,       // 클릭 상호작용 가능
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  win.once('ready-to-show', () => {
    win.showInactive(); // 포커스 빼앗지 않고 표시
  });

  // 창 닫기 버튼 → 앱 종료 대신 숨기기
  win.on('close', (e) => {
    e.preventDefault();
    win.hide();
  });
}

/* ── 시스템 트레이 ── */
function setupTray() {
  const iconBuf = makePngIcon(124, 58, 237); // #7c3aed 보라
  const icon = nativeImage.createFromBuffer(iconBuf).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('업무 대시보드');

  const buildMenu = () => Menu.buildFromTemplate([
    {
      label: win.isVisible() ? '대시보드 숨기기' : '대시보드 보이기',
      click: toggleWindow,
    },
    { type: 'separator' },
    {
      label: '항상 앞에 표시',
      type: 'checkbox',
      checked: win.isAlwaysOnTop(),
      click: (item) => win.setAlwaysOnTop(item.checked),
    },
    { type: 'separator' },
    { label: '종료', click: () => { win.removeAllListeners('close'); app.quit(); } },
  ]);

  tray.on('click', toggleWindow);
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
  tray.on('double-click', toggleWindow);
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
  } else {
    win.showInactive();
  }
  tray.setContextMenu(null); // 다음 right-click 때 다시 빌드
}

/* ── 앱 시작 ── */
app.whenReady().then(() => {
  createWindow();
  setupTray();

  // Ctrl+Alt+D — 대시보드 토글
  globalShortcut.register('CommandOrControl+Alt+D', toggleWindow);

  app.on('activate', () => {
    if (!win) createWindow();
  });
});

app.on('window-all-closed', () => { /* 트레이 상주 — 닫지 않음 */ });

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

/* ── IPC: 시스템 브라우저로 URL 열기 ── */
ipcMain.handle('open-url', (_e, url) => {
  shell.openExternal(url);
});

/* ── IPC: 앱 종료 ── */
ipcMain.handle('quit-app', () => {
  win.removeAllListeners('close');
  app.quit();
});

/* ── IPC: 경로가 폴더인지 파일인지 판별 ── */
ipcMain.handle('stat-path', (_e, filePath) => {
  try {
    return { isDir: fs.statSync(filePath).isDirectory() };
  } catch {
    return { isDir: false };
  }
});

/* ── IPC: Google OAuth2 (설치된 앱 방식) ── */
ipcMain.handle('google-auth-start', (_e, { clientId, clientSecret }) => {
  const PORT = 58989;
  const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
  ].join(' ');

  return new Promise((resolve) => {
    let server;
    const timer = setTimeout(() => {
      server?.close();
      resolve({ success: false, error: '인증 시간 초과 (5분)' });
    }, 5 * 60 * 1000);

    server = http.createServer(async (req, res) => {
      try {
        const { URL } = require('url');
        const u = new URL(req.url, `http://localhost:${PORT}`);
        const code = u.searchParams.get('code');
        const error = u.searchParams.get('error');
        const page = (msg) =>
          `<html><meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>${msg}</h2><p>이 창을 닫아주세요.</p></body></html>`;

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        clearTimeout(timer);
        server.close();

        if (code) {
          res.end(page('✅ 인증 완료!'));
          try {
            const tokens = await exchangeCode(code, clientId, clientSecret, PORT);
            resolve({ success: true, tokens });
          } catch (e) {
            resolve({ success: false, error: e.message });
          }
        } else {
          res.end(page('❌ 인증 실패: ' + (error || '알 수 없는 오류')));
          resolve({ success: false, error: error || '인증 거부됨' });
        }
      } catch (e) {
        res.end('Error');
        resolve({ success: false, error: e.message });
      }
    });

    server.listen(PORT, () => {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: `http://localhost:${PORT}`,
        response_type: 'code',
        scope: SCOPES,
        access_type: 'offline',
        prompt: 'consent',
      });
      shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    });

    server.on('error', (e) => {
      clearTimeout(timer);
      resolve({ success: false, error: `포트 ${PORT} 사용 불가: ${e.message}` });
    });
  });
});

function exchangeCode(code, clientId, clientSecret, port) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `http://localhost:${port}`,
      grant_type: 'authorization_code',
    }).toString();

    const req = https.request(
      {
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) reject(new Error(json.error_description || json.error));
            else resolve(json);
          } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

# 업무 대시보드 — Electron → Tauri v2 마이그레이션 최종 결과 보고서

> 완료일: 2026-05-31  
> 버전: Electron v1.3.2 → **Tauri v2 v2.0.0**  
> 목표: 배포 용량 및 시스템 리소스 최적화

---

## 1. 마이그레이션 개요

### 왜 Tauri v2 인가

| 항목 | Electron | Tauri v2 |
|------|----------|----------|
| 런타임 | Node.js + Chromium 번들 | OS 내장 WebView2 활용 |
| 배포 용량 | ~150 MB | ~8 MB (예상) |
| 메모리 사용 | ~200 MB | ~30 MB (예상) |
| 백엔드 언어 | JavaScript (Node.js) | Rust |
| 보안 모델 | `nodeIntegration`, `contextBridge` | Capabilities 파일 기반 |

### 5대 마이그레이션 절대 원칙

모든 작업은 아래 원칙을 100% 준수하며 진행됐습니다:

1. **프론트엔드 중심 설계**: Google API(Calendar·Drive·Tasks) 통신은 전부 JS `fetch`로 처리. Rust 구현 금지
2. **플러그인 적극 활용**: fs·shell·dialog·tray 등은 Tauri v2 공식 플러그인 사용
3. **화면 캡처 우회**: `plugin-shell` + `plugin-clipboard-manager` + HTML5 Canvas
4. **OAuth 서버만 Rust 허용**: `tiny_http`로 port 59123 로컬 서버, emit으로 프론트 전달
5. **v2 보안 모델 준수**: `src-tauri/capabilities/` 권한 설정 필수

---

## 2. 아키텍처 변환

```
[Electron 구조]                     [Tauri v2 구조]
─────────────────────               ────────────────────────────────────
main.js (Node.js, 1,033줄)    →     lib.rs  (Rust, 176줄)
  ├ OAuth 서버                        ├ OAuth 서버 (oauth.rs, 201줄)
  ├ Google API 호출            →     src/google-api.js (JS fetch, 548줄)
  ├ 토큰 관리                  →     src/token-store.js (plugin-fs, 153줄)
  ├ 창 제어 / 트레이            →     lib.rs setup() + index.html JS
  ├ 자동 업데이트              →     plugin-updater
  └ IPC 핸들러 28개            →     소멸 (JS 직접 호출)

preload.js (contextBridge)    →     삭제 (window.__TAURI__ 직접 접근)
  window.api.* (52개 호출)    →     ES 모듈 import + tInvoke 브리지

index.html                    →     변경 최소화 (HTML·CSS·애니메이션 100% 보존)
  <script>                           <script type="module">
```

---

## 3. 단계별 작업 내역

### 1단계 — 스캐폴딩 + 플러그인 설치

**작업 내용**

- `src-tauri/` 디렉토리 구조 생성 (기존 Electron 파일 손상 없음)
- `Cargo.toml` — Tauri v2 + 플러그인 10종 + `tiny_http` 의존성 선언
- `tauri.conf.json` — 프레임리스 창, skipTaskbar, 트레이 아이콘, CSP, NSIS 설정
- `capabilities/main.json` — v2 보안 모델 권한 초안
- `package.json` — `tauri:dev`, `tauri:build` 스크립트 추가 (Electron 스크립트 유지)
- `src-tauri/icons/` — 기존 `assets/icon.ico`, `icon.png` 복사

**설치된 플러그인 (npm)**

```
@tauri-apps/api              @tauri-apps/plugin-fs
@tauri-apps/plugin-shell     @tauri-apps/plugin-dialog
@tauri-apps/plugin-clipboard-manager  @tauri-apps/plugin-autostart
@tauri-apps/plugin-updater   @tauri-apps/plugin-global-shortcut
@tauri-apps/plugin-process   @tauri-apps/plugin-window-state
@tauri-apps/plugin-http
```

**발견·수정한 빌드 오류**
- `devUrl: "../src"` → 상대경로 URL 파서 오류 → 필드 제거
- `bundle.nsis` → Tauri 2.6 스키마 변경으로 `bundle.windows.nsis` 로 이동

---

### 2단계 — OAuth 로컬 서버 (Rust)

**파일**: `src-tauri/src/oauth.rs` (201줄)

**구현 내용**

```
invoke('start_oauth')         ← JS 호출 (논블로킹)
    ↓
oauth::start(app)             ← 백그라운드 스레드 spawn
    ↓
tiny_http::Server::http("127.0.0.1:59123")
    ↓
recv_timeout(120초)           ← 콜백 대기
    ↓
/?code=XXXX 수신
    ↓
브라우저에 "인증 완료" HTML 응답
    ↓
app.emit("auth-code", code)   ← 프론트엔드로 전달
```

**특징**
- 단발성 서버 (1회 요청 처리 후 자동 종료)
- 타임아웃 120초 / 오류 시 `auth-code-error` emit
- 간이 URL 퍼센트 디코딩 내장
- **토큰 교환 없음** (5대 원칙 §4 — JS 영역)

---

### 3단계 — token-store.js + google-api.js

#### `src/token-store.js` (153줄)

| 함수 | 역할 |
|------|------|
| `checkMigration()` | 기존 Electron 토큰 파일 존재 확인 및 로그 |
| `loadTokens()` | `gcal-tokens.json` 읽기 → 파싱 객체 반환 |
| `saveTokens(tokens)` | 디렉토리 자동 생성 + JSON 저장 |
| `clearTokens()` | 로그아웃 시 파일 삭제 |
| `isAuthenticated()` | `refresh_token` 유무로 로그인 상태 확인 |

**마이그레이션 전략 (핵심 설계)**

```
Electron userData:  %APPDATA%\업무 대시보드\gcal-tokens.json
Tauri dataDir():    %APPDATA%\업무 대시보드\gcal-tokens.json  (동일!)

→ 파일 복사 없이 자동 마이그레이션 완료
→ 기존 사용자 재로그인 불필요
```

`BaseDirectory.Data (4)` = Windows `%APPDATA%` = Electron `app.getPath('userData')` 부모 디렉토리

#### `src/google-api.js` (548줄, 18개 함수)

| 그룹 | 함수 | 역할 |
|------|------|------|
| **Auth** | `getAuthUrl()` | Google OAuth2 URL 생성 |
| | `exchangeCodeForTokens(code)` | 코드 → 토큰 교환 + 저장 |
| | `getValidAccessToken()` | 유효 토큰 반환 (만료 60초 전 자동 갱신) |
| **Calendar** | `getCalendarEvents({timeMin, timeMax})` | 이벤트 목록 |
| | `createCalendarEvent(data)` | 이벤트 생성 |
| | `updateCalendarEvent(id, data)` | 이벤트 수정 |
| | `deleteCalendarEvent(id)` | 이벤트 삭제 |
| **Drive** | `listDriveFolder(folderId)` | 폴더 파일 목록 |
| | `listDriveImages(folderId)` | 이미지 파일 목록 |
| | `getDriveImageData(fileId)` | 이미지 → Base64 |
| | `driveTrashFile(fileId)` | 휴지통 이동 |
| | `driveMoveFile(fileId, newParent, oldParent)` | 폴더 간 이동 |
| | `driveDownloadFile(fileId, name, mime, dest)` | 로컬 저장 |
| **Tasks** | `tasksGetDefaultList()` | 기본 목록 ID |
| | `tasksListTasks(listId)` | 태스크 전체 조회 |
| | `tasksCreateTask(listId, {title, notes})` | 태스크 생성 |
| | `tasksPatchTask(listId, taskId, {title, status})` | 태스크 수정 |
| | `tasksDeleteTask(listId, taskId)` | 태스크 삭제 |

---

### 4단계 — window.api.* 전면 교체

**작업 내용**
- `<script>` → `<script type="module">`
- `token-store.js` · `google-api.js` `import` 추가
- `window.api.*` 52개 호출 → Tauri 브리지 함수로 100% 대체
- `Object.assign(window, { ... })` — onclick 속성용 함수 56개 전역 노출

**교체된 window.api.* → Tauri 대응표 (주요)**

| 기존 | Tauri 대체 |
|------|-----------|
| `window.api.googleAuthStart()` | `invoke('start_oauth')` + `tListen('auth-code')` + `exchangeCodeForTokens()` |
| `window.api.getCalendarEvents()` | `getCalendarEvents()` (JS fetch) |
| `window.api.openPath(url)` | `invoke('plugin:shell\|open', { path: url })` |
| `window.api.selectDownloadFolder()` | `invoke('plugin:dialog\|open', { directory: true })` |
| `window.api.quitApp()` | `invoke('plugin:process\|exit', { code: 0 })` |
| `window.api.getLoginItem()` | `invoke('plugin:autostart\|is_enabled')` |
| `window.api.setLoginItem(e)` | `invoke('plugin:autostart\|enable/disable')` |
| `window.api.getAppVersion()` | `invoke('plugin:app\|version')` |
| `window.api.focusWindow()` | `getCurrentWindow().show/setAlwaysOnTop/setFocus` |
| `window.api.onUpdateStatus(cb)` | 로컬 콜백 패턴 `_updateStatusCallback` |
| `tasksCreateTask({taskListId, title})` | `tasksCreateTask(listId, {title})` (시그니처 정규화) |

**중간 시각 테스트 결과**: Electron과 100% 동일한 파스텔톤 UI·폰트·레이아웃 렌더링 확인 ✅

---

### 5단계 — 화면 캡처 우회

**흐름**

```
icpStartCapture()
  ├── 아이콘 피커 숨김
  ├── openPath('ms-screenclip:')         ← plugin-shell
  ├── _icpWaitFocusRestore()
  │     ├── win.listen('tauri://blur')   ← 캡처 도구 활성화 감지
  │     └── win.listen('tauri://focus')  ← 앱 복귀 감지 (30초 타임아웃)
  └── _icpApplyClipboard()
        ├── [1차] invoke('plugin:clipboard-manager|read_image') → rid
        │         invoke('plugin:image|rgba', { rid })
        │         invoke('plugin:image|size', { rid })
        │         invoke('plugin:resources|close', { rid })
        │         _icpRgbaToDataURL() → center-crop → 64×64 PNG
        └── [2차 폴백] navigator.clipboard.read() → Blob → 64×64 PNG
```

**핵심 설계**
- `blur → focus` 이벤트 감지로 캡처 완료/취소 판단 (폴링 없음)
- Tauri 네이티브 → Web API 2중 폴백 구조
- 모든 이미지 처리는 HTML5 Canvas (Rust 없음 — 5대 원칙 준수)

---

### 6단계 — 창 제어 · 트레이 · 전역 단축키

#### Rust 측 (`lib.rs`)

**시스템 트레이**

```
setup_tray()
  ├── TrayIconBuilder
  │     ├── 메뉴: 대시보드 열기 | 항상 앞에 표시 | 종료
  │     ├── 좌클릭 → toggle_window() (표시/숨김)
  │     └── 우클릭 → 컨텍스트 메뉴
  └── toggle_window()
        ├── is_visible() == true  → window.hide()
        └── is_visible() == false → window.show() + set_focus()
```

**전역 단축키**

```
tauri_plugin_global_shortcut::Builder::new()
    .with_handler(|app, shortcut, event| {
        Ctrl+Alt+D + Pressed → toggle_window(app)
    })
```
> JS 핸들러가 아닌 **Rust에서 직접 등록** — 창 숨김 상태에서도 작동

#### JS 측 (`index.html`)

| 기능 | 구현 |
|------|------|
| 창 드래그 | `<div class="topbar" data-tauri-drag-region>` |
| ✕ 버튼 | `hideToTray()` — 완전 종료 아닌 트레이로 숨김 |
| 멀티모니터 스냅 | `invoke('plugin:window\|current_monitor')` → `setPosition + setSize` (workArea 기준) |
| 앱 시작 스냅 | `DOMContentLoaded` → `snapToCurrentMonitor()` |
| 드래그 후 스냅 | `tauri://move` 이벤트 → 400ms 디바운스 → `snapToCurrentMonitor()` |
| `focusWindow()` | `show()` + `setAlwaysOnTop(true)` + `setFocus()` + 스냅 |

---

### 7단계 — 자동 업데이트

**흐름**

```
checkForUpdates()
  ├── invoke('plugin:updater|check')
  ├── null → not-available
  └── metadata → available
        ↓
_startDownloadProgress(metadata)
  ├── new window.__TAURI__.core.Channel()   ← Tauri IPC 채널
  ├── invoke('plugin:updater|download', { onEvent: channel, rid })
  │     ├── { event: 'Started', data: { contentLength } }
  │     ├── { event: 'Progress', data: { chunkLength } } × N
  │     └── { event: 'Finished' }  → _downloadedBytesRid 저장
  └── _emitUpdateStatus({ type: 'downloaded', version })
        ↓
  사용자: "지금 재시작하여 업데이트" 클릭
        ↓
installUpdate()
  ├── invoke('plugin:updater|install', { updateRid, bytesRid })
  └── NSIS silent 설치 → 앱 자동 재시작
```

**특징**
- Vanilla JS에서 `Channel` 객체 직접 활용 (node_modules import 불필요)
- `pubkey` 미설정 에러 정규식 감지 → 조용한 폴백 처리
- 앱 시작 3초 후 자동 업데이트 확인 (UI 로딩 방해 없음)

---

### 8단계 — 최종 배포 설정

#### Capabilities PoLP 최소화

| 항목 | 이전 | 이후 |
|------|------|------|
| 총 권한 수 | 28개 | **17개** |
| 제거된 권한 | `allow-outer/inner-size`, `allow-set-resizable`, `allow-set-skip-taskbar`, `app:allow-name`, `app:allow-tauri-version`, `dialog:allow-save`, `clipboard-manager:allow-read/write-text/write-image`, `global-shortcut:*` (4개) | — |

#### tauri.conf.json 프로덕션 설정

```json
{
  "version": "2.0.0",
  "bundle": {
    "targets": "nsis",
    "windows": {
      "nsis": {
        "installMode": "currentUser",
        "compression": "lzma",
        "minimumWebview2Version": "109.0.1518.0",
        "languages": ["Korean", "English"]
      }
    }
  },
  "plugins": {
    "updater": {
      "pubkey": "",
      "endpoints": [
        "https://github.com/ggugguai-star/Dashboard/releases/latest/download/latest.json"
      ]
    }
  }
}
```

---

## 4. 최종 파일 구조

```
C:\AI\Code\Dashbaord\
├── src\                              ← 프론트엔드 (수정 최소화)
│   ├── index.html                    (7,003줄 — HTML·CSS 100% 보존, JS 로직만 교체)
│   ├── token-store.js                (153줄  — 토큰 관리)
│   ├── google-api.js                 (548줄  — Google API fetch 레이어)
│   └── fonts\                        (로컬 폰트 — 변경 없음)
│
├── src-tauri\                        ← Rust 백엔드 (신규 추가)
│   ├── src\
│   │   ├── main.rs                   (7줄   — 진입점)
│   │   ├── lib.rs                    (176줄 — 플러그인·트레이·단축키)
│   │   └── oauth.rs                  (201줄 — OAuth 콜백 서버)
│   ├── capabilities\
│   │   └── main.json                 (PoLP 최소 권한 17개)
│   ├── icons\
│   │   ├── icon.ico
│   │   └── icon.png
│   ├── tauri.conf.json               (앱 설정)
│   ├── Cargo.toml                    (Rust 의존성)
│   └── build.rs                      (빌드 스크립트)
│
├── SPEC.md                           (기능 명세서)
├── MIGRATION_PLAN.md                 (마이그레이션 계획)
├── MIGRATION_RESULT.md               (이 파일 — 최종 결과 보고)
└── RELEASE_GUIDE.md                  (서명 키·빌드·배포 가이드)
```

---

## 5. 빌드 산출물

```
src-tauri\target\release\bundle\nsis\
└── 업무 대시보드_2.0.0_x64-setup.exe   ← 배포 설치 파일 ✅
```

---

## 6. 남은 작업 (배포 전)

| 항목 | 명령어 / 파일 | 참고 |
|------|--------------|------|
| Ed25519 서명 키 생성 | `npm run tauri -- signer generate` | `RELEASE_GUIDE.md` §1 |
| `tauri.conf.json` pubkey 설정 | 공개 키 붙여넣기 | `RELEASE_GUIDE.md` §1-2 |
| `TAURI_SIGNING_PRIVATE_KEY` 환경 변수 | PowerShell 설정 | `RELEASE_GUIDE.md` §2 |
| `latest.json` 작성 + GitHub Release 업로드 | `.exe` + `.sig` + `latest.json` | `RELEASE_GUIDE.md` §4 |

---

## 7. 마이그레이션 완성 요약

| 단계 | 작업 | 상태 |
|------|------|------|
| 1단계 | Tauri v2 스캐폴딩 + 플러그인 + capabilities | ✅ 완료 |
| 2단계 | OAuth 로컬 서버 (Rust, port 59123) | ✅ 완료 |
| 3단계 | token-store.js + google-api.js (JS fetch 레이어) | ✅ 완료 |
| 4단계 | window.api.* 52개 전면 교체 + ES 모듈화 | ✅ 완료 |
| 5단계 | 화면 캡처 우회 (ms-screenclip + clipboard + Canvas) | ✅ 완료 |
| 6단계 | 창 제어 · 멀티모니터 스냅 · 트레이 · Ctrl+Alt+D | ✅ 완료 |
| 7단계 | 자동 업데이트 (Channel 기반 진행률) | ✅ 완료 |
| 8단계 | PoLP 최소 권한 · NSIS 최적화 · 배포 가이드 | ✅ 완료 |
| 빌드 | `업무 대시보드_2.0.0_x64-setup.exe` 생성 확인 | ✅ 완료 |

**Electron v1.3.2 → Tauri v2 v2.0.0 마이그레이션 완성 🎉**

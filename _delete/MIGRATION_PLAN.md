# Tauri v2 마이그레이션 브리핑

> 작성 기준: 5대 마이그레이션 절대 원칙 + SPEC.md + 실제 소스 코드 분석  
> 작성일: 2026-05-30

---

## 📦 설치할 플러그인 전체 목록

### Tauri 공식 플러그인 (JS + Rust 자동 바인딩)

| 플러그인 | 용도 | 대체 대상 (Electron) |
|----------|------|---------------------|
| `@tauri-apps/plugin-shell` | URL/파일 열기, `ms-screenclip:` 실행 | `shell.openExternal`, `shell.openPath`, `child_process.exec` |
| `@tauri-apps/plugin-fs` | 토큰 파일 저장/로드, 창 위치 저장 | `fs.readFileSync`, `fs.writeFileSync` |
| `@tauri-apps/plugin-dialog` | 다운로드 폴더 선택 대화상자 | `dialog.showOpenDialog` |
| `@tauri-apps/plugin-clipboard-manager` | 클립보드 이미지 읽기 (화면 캡처용) | `clipboard.readImage()` |
| `@tauri-apps/plugin-autostart` | Windows 시작 시 자동 실행 | `app.setLoginItemSettings` |
| `@tauri-apps/plugin-updater` | GitHub Releases 자동 업데이트 | `electron-updater` |
| `@tauri-apps/plugin-global-shortcut` | `Ctrl+Alt+D` 전역 단축키 | `globalShortcut.register` |
| `@tauri-apps/plugin-process` | 앱 종료 (`exit(0)`) | `app.quit()` |
| `@tauri-apps/plugin-window-state` | 창 위치/모니터 저장 | `window-bounds.json` 직접 구현 |

### Tauri v2 Core API (별도 설치 없음)

| API 모듈 | 용도 |
|----------|------|
| `@tauri-apps/api/window` | 창 최소화, 포커스, alwaysOnTop, 모니터 감지 |
| `@tauri-apps/api/app` | 앱 버전 조회 |
| `@tauri-apps/api/event` | 백엔드 → 프론트 이벤트 수신 (`listen`) |
| `@tauri-apps/api/tray` | 시스템 트레이 구성 |

### Rust Cargo 크레이트 (main.rs 전용)

| 크레이트 | 용도 |
|----------|------|
| `tiny_http` | OAuth 콜백용 로컬 서버 (port 59123) |

---

## 🔄 아키텍처 변환 요약

```
[Electron 구조]                    [Tauri v2 구조]
main.js (Node.js)            →     main.rs (Rust) ← OAuth 서버만
  Google API 호출            →     src/google-api.js (JS fetch)
  토큰 관리                  →     src/token-store.js (plugin-fs)
  IPC 핸들러 28개            →     대부분 JS 직접 호출로 소멸
preload.js (contextBridge)   →     삭제 (window.api.* 전부 제거)
src/index.html               →     그대로 유지 (수정 최소화)
```

### `window.api.*` 전체 28개 → Tauri 변환 매핑

| 기존 (`window.api.*`) | 변환 방식 |
|----------------------|-----------|
| `googleAuthStart()` | `invoke('start_oauth')` → `listen('auth-code')` |
| `getAuthStatus()` | JS: 토큰 파일 존재 여부 확인 |
| `getCalendarEvents()` | JS: `fetch('https://www.googleapis.com/calendar/...')` |
| `createCalendarEvent()` | JS: `fetch(...)` |
| `updateCalendarEvent()` | JS: `fetch(...)` |
| `deleteCalendarEvent()` | JS: `fetch(...)` |
| `listDriveFolder()` | JS: `fetch(...)` |
| `listDriveImages()` | JS: `fetch(...)` |
| `getDriveImageData()` | JS: `fetch(...)` |
| `driveTrashFile()` | JS: `fetch(...)` |
| `driveMoveFile()` | JS: `fetch(...)` |
| `driveDownloadFile()` | JS: `fetch(...)` + `plugin-fs` write |
| `tasksGetDefaultList()` | JS: `fetch(...)` |
| `tasksListTasks()` | JS: `fetch(...)` |
| `tasksCreateTask()` | JS: `fetch(...)` |
| `tasksPatchTask()` | JS: `fetch(...)` |
| `tasksDeleteTask()` | JS: `fetch(...)` |
| `googleDisconnect()` | JS: `plugin-fs` 파일 삭제 |
| `openPath(url)` | `plugin-shell`: `open(url)` |
| `selectDownloadFolder()` | `plugin-dialog`: `open({directory: true})` |
| `getLoginItem()` | `plugin-autostart`: `isEnabled()` |
| `setLoginItem(enable)` | `plugin-autostart`: `enable()` / `disable()` |
| `quitApp()` | `plugin-process`: `exit(0)` |
| `minimizeWindow()` | `getCurrentWindow().minimize()` |
| `focusWindow()` | `getCurrentWindow().setFocus()` + `setAlwaysOnTop` |
| `getAppVersion()` | `getVersion()` |
| `checkForUpdates()` | `plugin-updater`: `check()` |
| `installUpdate()` | `plugin-updater`: `update.downloadAndInstall()` |
| `startScreenCapture()` | `plugin-shell` + `plugin-clipboard-manager` + Canvas |
| `onAuthUpdate(cb)` | `listen('auth-update', cb)` |
| `onUpdateStatus(cb)` | `listen('update-status', cb)` |
| `onCaptureImageReady(cb)` | JS 콜백으로 처리 |

---

## 🏗️ 작업 단계 계획 (8단계)

| 단계 | 작업 내용 | 결과물 |
|------|-----------|--------|
| **1단계** | Tauri v2 프로젝트 스캐폴딩 + 플러그인 설치 + `tauri.conf.json` 설정 + capabilities 파일 초안 | 앱이 빈 화면으로 뜨는 상태 |
| **2단계** | `main.rs` — OAuth 로컬 서버 (tiny_http) + Tauri 이벤트 emit | Google 로그인 가능 |
| **3단계** | `src/token-store.js` + `src/google-api.js` — 토큰 관리 + 전체 Google API fetch 함수 구현 | Google API 호출 가능 |
| **4단계** | `src/index.html` 내 `window.api.*` → 플러그인 직접 호출로 교체 (Calendar/Drive/Tasks 연동) | 주요 기능 동작 |
| **5단계** | 화면 캡처 — `plugin-shell` + `plugin-clipboard-manager` + Canvas 크롭/리사이즈 | 아이콘 캡처 가능 |
| **6단계** | 창 동작 — 프레임리스, 멀티모니터 스냅, 트레이, `Ctrl+Alt+D`, alwaysOnTop | 윈도우 위젯 동작 |
| **7단계** | 자동 업데이트 — `plugin-updater` + 업데이트 배너/오버레이 연결 | 업데이트 기능 완성 |
| **8단계** | capabilities 전체 검토 + NSIS 빌드 설정 + 릴리즈 테스트 | 배포 가능한 `.exe` |

---

## ⚠️ 주요 주의사항

1. **CORS**: Google API는 브라우저 `fetch`에서 직접 호출 가능하나, Tauri의 `tauri.conf.json`에 CSP 설정이 필요
2. **토큰 저장**: `plugin-fs`로 `$APPDATA/업무 대시보드/gcal-tokens.json`에 저장 (기존과 동일 경로)
3. **화면 배율**: CSS 변수 기반이라 그대로 동작 (변경 없음)
4. **index.html**: 프론트엔드 코드 대부분 유지, `window.api.*` 호출 부분만 수정

---

## 5대 마이그레이션 절대 원칙 (참고)

1. **프론트엔드 중심 설계**: Google API 통신 전부 JS fetch로 이동 (Rust 구현 금지)
2. **플러그인 적극 활용**: fs, shell, dialog, tray 등 공식 플러그인 사용
3. **화면 캡처 우회**: plugin-shell + plugin-clipboard-manager + Canvas API
4. **OAuth 서버만 Rust 허용**: tiny_http로 port 59123 로컬 서버, 코드만 프론트로 전달
5. **v2 보안 모델 준수**: `src-tauri/capabilities/` 권한 설정 필수

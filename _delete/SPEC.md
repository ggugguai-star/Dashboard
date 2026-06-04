# 업무 대시보드 — 기능 명세서 (v1.3.2)

> AI 분석 및 Tauri 마이그레이션 검토용 상세 명세서  
> 작성 기준: 실제 소스 코드 (main.js, src/index.html, preload.js, package.json)

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [기술 스택](#2-기술-스택)
3. [파일 구조](#3-파일-구조)
4. [프로세스 아키텍처](#4-프로세스-아키텍처)
5. [IPC 통신 채널 전체 목록](#5-ipc-통신-채널-전체-목록)
6. [데이터 저장소](#6-데이터-저장소)
7. [초기 설정 위저드](#7-초기-설정-위저드)
8. [메인 대시보드 UI](#8-메인-대시보드-ui)
9. [Google OAuth 인증](#9-google-oauth-인증)
10. [Google Calendar 기능](#10-google-calendar-기능)
11. [Google Drive 기능](#11-google-drive-기능)
12. [Google Tasks 연동](#12-google-tasks-연동)
13. [카테고리 패널 시스템](#13-카테고리-패널-시스템)
14. [메모 · 할 일 패널](#14-메모--할-일-패널)
15. [알림(Alarm) 시스템](#15-알림alarm-시스템)
16. [화면 캡처](#16-화면-캡처)
17. [아이콘 피커](#17-아이콘-피커)
18. [배율(Scale) 시스템](#18-배율scale-시스템)
19. [창 관리](#19-창-관리)
20. [시스템 트레이](#20-시스템-트레이)
21. [자동 업데이트](#21-자동-업데이트)
22. [설정 모달](#22-설정-모달)
23. [렌더링 성능 최적화](#23-렌더링-성능-최적화)

---

## 1. 프로젝트 개요

**업무 대시보드**는 Windows 데스크탑 전체 화면을 덮는 Electron 기반 업무용 위젯 앱이다.

- 모니터 전체 작업 영역을 점유하며 항상 바탕화면 위에 상주
- 프레임 없는 창 (frameless window)
- 시스템 트레이에서 숨기기/표시하기 제어
- Google Calendar, Drive, Tasks와 실시간 동기화
- 카테고리별 링크/파일/Drive 탐색기 패널

---

## 2. 기술 스택

| 항목 | 내용 |
|------|------|
| 런타임 | Electron 33.4.11 |
| 패키징 | electron-builder 25.x (NSIS oneClick) |
| 자동 업데이트 | electron-updater 6.8.3 + GitHub Releases |
| 릴리즈 채널 | GitHub (owner: ggugguai-star, repo: Dashboard) |
| 프론트엔드 | HTML5 / CSS3 / Vanilla JS (단일 파일 src/index.html) |
| 폰트 | DM Sans, Noto Sans KR (로컬 번들) |
| 이미지 처리 | Electron NativeImage API (crop, resize) |
| 외부 API | Google OAuth2, Calendar v3, Drive v3, Tasks v1 |
| 데이터 통신 | Node.js https 모듈 (직접 구현, 별도 HTTP 라이브러리 없음) |
| Node.js 내장 모듈 | fs, http, https, zlib, path, child_process, url |
| devDependencies (배포 미포함) | playwright-core (개발/테스트 스크립트 전용), sharp (아이콘 생성), to-ico (아이콘 변환) |

---

## 3. 파일 구조

```
C:\AI\Code\Dashbaord\
├── main.js              # Electron 메인 프로세스 (백엔드 전체)
├── preload.js           # contextBridge — IPC 브리지
├── package.json         # 의존성, 빌드 설정
├── src/
│   ├── index.html       # 렌더러 (UI 전체 — HTML/CSS/JS 단일 파일)
│   └── fonts/
│       └── fonts.css    # 로컬 폰트 선언
└── assets/
    └── icon.ico         # 앱 아이콘
```

---

## 4. 프로세스 아키텍처

```
┌─────────────────────────────────────────────────────┐
│                 MAIN PROCESS (main.js)               │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ Google OAuth │  │ Google APIs  │  │ Electron  │  │
│  │ (localhost   │  │ Calendar,    │  │ autoUpdate│  │
│  │  server:     │  │ Drive,       │  │ er        │  │
│  │  59123)      │  │ Tasks        │  │           │  │
│  └──────────────┘  └──────────────┘  └───────────┘  │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ 창 관리      │  │ 파일 시스템  │  │ Tray/     │  │
│  │ (BrowserWindow│ │ (gcal-tokens │  │ Shortcut  │  │
│  │  멀티모니터) │  │  .json 등)   │  │           │  │
│  └──────────────┘  └──────────────┘  └───────────┘  │
│                                                      │
│               ipcMain.handle(...)                    │
└────────────────────────┬────────────────────────────┘
                         │ contextBridge (preload.js)
                         │ window.api.*
┌────────────────────────▼────────────────────────────┐
│              RENDERER (src/index.html)               │
│                                                      │
│  Setup Wizard → 대시보드 UI                          │
│  - 달력 패널     - 카테고리 패널 (3~7개)             │
│  - Weekly Plan  - 메모·할일 패널                    │
│  - 설정 모달     - 알림 오버레이                     │
│  - 아이콘 피커   - 업데이트 배너                     │
└─────────────────────────────────────────────────────┘
```

---

## 5. IPC 통신 채널 전체 목록

### 5-1. 렌더러 → 메인 (invoke/handle)

| 채널 | 파라미터 | 반환값 | 기능 |
|------|----------|--------|------|
| `open-url` | `url: string` | `{success}` or `{error}` | URL → 외부 브라우저, 파일/폴더 경로 → 탐색기 |
| `quit-app` | — | — | 앱 완전 종료 |
| `minimize-window` | — | — | 창 최소화 |
| `start-screen-capture` | — | `dataURL` or `null` | 캡처 도구 실행 + 클립보드 폴링 |
| `install-update` | — | — | 다운로드 완료된 업데이트 설치 (NSIS silent) |
| `check-for-updates` | — | — | 수동 업데이트 확인 |
| `get-app-version` | — | `string` | 현재 앱 버전 반환 |
| `focus-window` | — | — | 창을 최상위로 가져오기 |
| `stat-path` | `filePath: string` | `{isDir: boolean}` | 경로가 폴더인지 파일인지 판별 |
| `get-auth-status` | — | `{authenticated: boolean}` | Google 인증 상태 확인 |
| `google-auth-start` | `{clientId?, clientSecret?}` | `{success, error?}` | OAuth2 인증 플로우 시작 |
| `google-disconnect` | — | `{success}` | 저장된 토큰 삭제 |
| `get-calendar-events` | `{timeMin?, timeMax?}` | `{events}` or `{error}` | 캘린더 이벤트 목록 조회 |
| `create-calendar-event` | `eventData: object` | `{success, event}` or `{error}` | 새 일정 생성 |
| `update-calendar-event` | `{eventId, eventData}` | `{success, event}` or `{error}` | 기존 일정 수정 |
| `delete-calendar-event` | `eventId: string` | `{success}` or `{error}` | 일정 삭제 |
| `list-drive-folder` | `folderId: string` | `{files}` or `{error}` | Drive 폴더 내용 목록 |
| `list-drive-images` | `folderId: string` | `{files}` or `{error}` | Drive 폴더 내 이미지 목록 |
| `get-drive-image-data` | `fileId: string` | `{data, mimeType}` or `{error}` | Drive 이미지 → Base64 |
| `drive-trash-file` | `fileId: string` | `{success}` or `{error}` | Drive 파일을 휴지통으로 이동 |
| `drive-move-file` | `fileId, newParentId, oldParentId` | `{success}` or `{error}` | Drive 파일 폴더 간 이동 |
| `drive-download-file` | `fileId, fileName, mimeType, destPath` | `{success, savedPath}` or `{error}` | Drive 파일 로컬 저장 |
| `select-download-folder` | — | `string` or `null` | 폴더 선택 다이얼로그 |
| `tasks-get-default-list` | — | `{id, title}` or `{error}` | 기본 Tasks 목록 ID 조회 |
| `tasks-list-tasks` | `taskListId: string` | `{items, ...}` or `{error}` | 할 일 목록 조회 |
| `tasks-create-task` | `{taskListId, title, notes}` | `{success, ...}` or `{error}` | 할 일 생성 |
| `tasks-patch-task` | `{taskListId, taskId, title?, status?}` | `{success}` or `{error}` | 할 일 수정 (제목/상태) |
| `tasks-delete-task` | `{taskListId, taskId}` | `{success}` or `{error}` | 할 일 삭제 |
| `get-login-item` | — | `LoginItemSettings` | Windows 시작 시 자동 실행 상태 조회 |
| `set-login-item` | `enable: boolean` | `{success}` | 자동 실행 설정/해제 |

### 5-2. 메인 → 렌더러 (webContents.send)

| 채널 | 페이로드 | 시점 |
|------|----------|------|
| `update-status` | `{type: 'available'|'progress'|'downloaded'|'not-available'|'error', version?, percent?, message?}` | 업데이트 상태 변화 시 |
| `auth-update` | `msg: string` | OAuth 인증 진행 상태 메시지 |
| `capture-image-ready` | `dataURL: string` | 화면 캡처 완료 시 |

---

## 6. 데이터 저장소

### 6-1. 파일 시스템 (userData = %APPDATA%\업무 대시보드)

| 파일 | 내용 | 형식 |
|------|------|------|
| `gcal-tokens.json` | Google OAuth 토큰 (access_token, refresh_token, expiry_date, client_id, client_secret) | JSON |
| `window-bounds.json` | 창 위치/크기/디스플레이 ID | JSON |

### 6-2. localStorage (렌더러, Electron은 userData 경로의 IndexedDB 기반)

| 키 | 내용 | 기본값 |
|----|------|--------|
| `appScale` | 화면 배율 (60~150, %) | `100` |
| `dashboardLaunched` | 대시보드 첫 실행 완료 여부 | — |
| `catData` | 카테고리 전체 데이터 (JSON 직렬화) | — |
| `weeklyPlanTitle` | Weekly Plan 패널 제목 | `"Weekly Plan"` |
| `driveWeeklyId` | Weekly Plan Drive 폴더 ID | — |
| `driveMemoId` | 메모 Drive 폴더 ID | — |
| `todoItems` | 로컬 할 일 목록 (JSON) | `[]` |
| `todoAlarms` | 할 일 알림 설정 (JSON, key=todoId) | `{}` |
| `gtasksListId` | Google Tasks 기본 목록 ID | — |
| `driveWeeklyImages_*` | Weekly Plan 이미지 캐시 | — |
| `driveImgCache_*` | Drive 이미지 Base64 캐시 | — |

---

## 7. 초기 설정 위저드

앱을 처음 실행하거나 설정을 열 때 표시되는 3단계 설정 화면.

### Step 0 — 화면 설정

- **모니터 해상도 선택**: WQHD 16:10 (2560×1600), WQHD 16:9 (2560×1440), FHD 16:9 (1920×1080), FHD 16:10 (1920×1200)
- **업무 카테고리 수 선택**: 3~7개 (기본 5개)
- **화면 배율 설정**: 60~150% 슬라이더 + 프리셋 버튼 (70/85/100/115/130%)
  - 실시간 미리보기 (화면 비율 축소 표시)
- localStorage에 즉시 저장

### Step 1 — Google 연동

- Google 계정 연결 버튼 클릭 → OAuth 플로우 시작
- 인증 진행 상태를 실시간 로그로 표시 (auth-update 이벤트)
- 기존 연결 상태 자동 감지 후 UI 반영
- "연동 없이 계속하기" → 스킵 가능

### Step 2 — Drive 폴더 연결

- Weekly Plan 폴더 ID 입력 (Google Drive URL에서 추출)
- Windows 시작 시 자동 실행 체크박스
- Drive 폴더 ID는 localStorage에 저장

---

## 8. 메인 대시보드 UI

### 8-1. 레이아웃 구조

```
┌─────────────────────────────────────────────────────┐
│  TOPBAR (56px)                                       │
│  [대시보드] [날짜]    [Google연결됨 ●] [↻][⚙][✕]   │
├──────────────┬──────────────────────────────────────┤
│  SIDE-L      │  CAT-ZONE (카테고리 패널 N개)         │
│  (310px)     │                                       │
│  ① 월 달력  │  [패널1] [패널2] [패널3] [패널4] [패널5] │
│  ② WeeklyPlan│                                      │
│  ③ 메모·할일│                                       │
└──────────────┴──────────────────────────────────────┘
```

### 8-2. 상단 바 (Topbar)

| 요소 | 기능 |
|------|------|
| 대시보드 로고 | 텍스트만 표시 |
| 날짜 | 현재 날짜 실시간 표시 (1분 단위 갱신) |
| Google 연결 상태 칩 | 연결 여부에 따라 초록/회색 점 |
| ↻ 동기화 버튼 | Google Calendar + Drive 전체 동기화 (hover 시 60° 회전, 진행 중 무한 회전) |
| ⚙ 설정 버튼 | 설정 모달 열기 (hover 시 60° 회전) |
| ✕ 종료 버튼 | 앱 종료 (hover 시 빨간색) |
| 상단 바 드래그 | 창을 다른 모니터로 이동 가능 (`-webkit-app-region: drag`) |

---

## 9. Google OAuth 인증

### 인증 방식
- **Desktop App OAuth2** (Installed App Flow)
- 빌트인 Client ID/Secret 내장 (별도 설정 불필요)
- Scopes: `calendar`, `calendar.events`, `drive`, `tasks`

### 인증 플로우
1. main.js에서 포트 59123의 로컬 HTTP 서버 시작
2. 외부 브라우저로 Google 인증 URL 열기 (`shell.openExternal`)
3. 사용자가 Google 계정 선택 및 권한 허용
4. 리다이렉트: `http://127.0.0.1:59123?code=AUTH_CODE`
5. main.js 서버가 코드 수신 → `oauth2.googleapis.com/token`에 POST
6. access_token + refresh_token 획득 → `gcal-tokens.json`에 저장
7. 렌더러에 `auth-update` 이벤트로 상태 전송

### 토큰 관리
- access_token 만료 60초 전 자동 갱신 (`refreshAccessToken`)
- 모든 API 호출 전 `getValidAccessToken()` 통해 유효한 토큰 보장
- 갱신 실패 시 `null` 반환 → 인증 오류 처리

### 저장 구조 (gcal-tokens.json)
```json
{
  "access_token": "ya29.xxx",
  "refresh_token": "1//xxx",
  "expiry_date": 1234567890000,
  "client_id": "xxx.apps.googleusercontent.com",
  "client_secret": "GOCSPX-xxx"
}
```

---

## 10. Google Calendar 기능

### 10-1. 캘린더 표시

- **월 달력 그리드**: 7열 × 6행, 요일 헤더 포함
- **이벤트 도트**: 이벤트 있는 날짜에 핑크-라벤더 그라디언트 원형 점 표시
- **날짜 클릭**: 해당 날짜의 이벤트 목록을 하단에 표시
- **월 이동**: ‹ / 오늘 / › 버튼
- **이벤트 항목**: 색상 도트 + 시간 + 제목

### 10-2. 이벤트 조회 API

```
GET https://www.googleapis.com/calendar/v3/calendars/primary/events
  ?timeMin=<현재-7일>
  &timeMax=<현재+60일>
  &singleEvents=true
  &orderBy=startTime
  &maxResults=250
```

### 10-3. 이벤트 추가/수정 다이얼로그

**필드:**
- 제목 (최대 200자)
- 종일 체크박스
- 날짜 (커스텀 날짜 피커)
- 시작/종료 시간 (커스텀 시간 피커, 30분 단위)
- 장소
- 설명 (textarea)
- 알림 체크박스 + 날짜/시간 선택
- 색상 선택 (12가지)

**저장:**
- 신규: `POST /calendar/v3/calendars/primary/events`
- 수정: `PUT /calendar/v3/calendars/primary/events/{eventId}`

### 10-4. 이벤트 우클릭 메뉴

- **수정**: 기존 이벤트 데이터를 다이얼로그에 채워서 열기
- **삭제**: `DELETE /calendar/v3/calendars/primary/events/{eventId}`

### 10-5. 커스텀 날짜/시간 피커

- 달력 팝업 (월 이동, 날짜 선택)
- 시간 드롭다운 (00:00 ~ 23:30, 30분 간격)
- 시작 시간 선택 시 종료 시간 자동 +1시간
- 한국어 날짜 포맷 표시 ("5월 29일 (목)")

---

## 11. Google Drive 기능

### 11-1. Weekly Plan 이미지 뷰어

- Drive 폴더 ID(localStorage: `driveWeeklyId`)에서 이미지 목록 로드
- 지원 형식: PNG, JPEG, GIF, WebP, BMP, TIFF, HEIC, HEIF
- ‹ / › 버튼으로 이미지 네비게이션
- 이미지 클릭 → 라이트박스 확대 표시
- Drive 폴더 아이콘 클릭 → 해당 Drive 폴더를 브라우저로 열기
- ↻ 버튼으로 새로고침

### 11-2. 라이트박스

- 전체 화면 오버레이
- 배경 블러 처리
- ← → 버튼으로 이미지 순서 이동
- 하단 카운터 표시 (현재/전체)
- 클릭 또는 ✕ 버튼으로 닫기

### 11-3. Drive 카테고리 패널 (Drive 타입)

Drive 폴더를 카테고리 패널 내에서 탐색하는 내장 파일 탐색기:

**UI 구성:**
- 브레드크럼 경로 표시 (클릭 시 해당 폴더로 이동)
- ↻ 새로고침 버튼
- 파일/폴더 목록 (폴더 우선 정렬)

**파일 상호작용:**
- 폴더 클릭 → 해당 폴더로 탐색
- 파일 클릭 → `webViewLink`로 브라우저에서 열기
- 파일 우클릭 → 컨텍스트 메뉴 (다운로드, 이동, 휴지통)

**파일 다운로드:**
- Google Docs → `.docx`
- Google Sheets → `.xlsx`
- Google Slides → `.pptx`
- Google Drawing → `.pdf`
- 일반 파일 → 원본 형식
- 저장 경로: 폴더 선택 다이얼로그 (`dialog.showOpenDialog`)

**파일 이동:**
- Drive 파일을 다른 카테고리 패널(Drive 타입)로 드래그 앤 드롭
- 대상 폴더를 브라우저 다이얼로그에서 선택 후 확정

### 11-4. Drive API 엔드포인트

| 기능 | API |
|------|-----|
| 폴더 목록 | `GET /drive/v3/files?q='parentId' in parents...` |
| 이미지 목록 | `GET /drive/v3/files?q=mimeType='image/*'...` |
| 이미지 다운로드 | `GET /drive/v3/files/{id}?alt=media` |
| Google Docs 내보내기 | `GET /drive/v3/files/{id}/export?mimeType=...` |
| 파일 휴지통 이동 | `PATCH /drive/v3/files/{id}` `{trashed: true}` |
| 파일 폴더 이동 | `PATCH /drive/v3/files/{id}?addParents=...&removeParents=...` |

**공통:** HTTP 301/302/307/308 리다이렉트 자동 처리

---

## 12. Google Tasks 연동

### 12-1. 초기화 플로우

1. Google 인증 확인 (`window.api.tasksGetDefaultList`)
2. 'My Tasks' 또는 '내 할 일' 목록 찾기 (없으면 첫 번째 목록 사용)
3. 목록 ID를 localStorage(`gtasksListId`)에 저장
4. 동기화 버튼 표시 후 초기 동기화 실행

### 12-2. 동기화 동작

- Google Tasks 할 일을 로컬 할 일 목록에 머지
- Google Tasks에서 완료된 항목은 로컬에서 done 처리
- 로컬 항목 중 `gtaskId`가 있는 항목은 Tasks와 연결됨
- Google 연결 해제 시 Tasks 상태 초기화

### 12-3. 할 일 CRUD → Tasks 동기화

| 동작 | Tasks API |
|------|-----------|
| 할 일 추가 | `POST /tasks/v1/lists/{listId}/tasks` |
| 완료 체크 | `PATCH /tasks/v1/lists/{listId}/tasks/{taskId}` `{status: 'completed'}` |
| 완료 해제 | `PATCH` `{status: 'needsAction'}` |
| 삭제 | `DELETE /tasks/v1/lists/{listId}/tasks/{taskId}` |
| 목록 조회 | `GET /tasks/v1/lists/{listId}/tasks?showCompleted=true&maxResults=100` |

### 12-4. 오류 처리

- 401/403 → `tasks_auth_required` 에러 반환 + 상세 메시지 로깅
- `_gtasksListId`가 null이면 `tasksGetDefaultList` 재시도
- 재로그인 후 `checkGoogleAuth()` 자동 호출로 Tasks 재초기화

---

## 13. 카테고리 패널 시스템

### 13-1. 개요

- 메인 우측 영역을 N등분 (N = 설정된 카테고리 수, 3~7개)
- 각 패널은 독립적인 데이터와 설정을 가짐
- 전체 카테고리 데이터는 localStorage(`catData`)에 JSON으로 저장

### 13-2. 패널 타입

| 타입 | 설명 |
|------|------|
| `local` | 로컬 링크/파일/폴더 목록 + 메모 태그 |
| `drive` | Google Drive 폴더 내장 탐색기 |

### 13-3. 패널 헤더 구성

- **컬러 드래그 바** (상단 6px 컬러 바): 드래그로 패널 순서 변경
- **카테고리 아이콘**: 클릭 시 아이콘 피커 열기
- **카테고리 이름**: 표시 (편집은 ⚙ 버튼 통해)
- **서브텍스트**: 아이템 수 또는 연결된 Drive 폴더명
- **⚙ 버튼**: 호버 시 나타남 → 카테고리 편집 팝업 열기

### 13-4. 패널 아이템 (local 타입)

각 아이템은:
- 아이콘 (이모지 또는 이미지 dataURL)
- 레이블 (표시 이름)
- 원본 경로 (URL 또는 로컬 파일 경로)
- 태그 (색상 배지)

**아이템 상호작용:**
- 클릭 → `open-url` IPC 호출 (URL이면 외부 브라우저, 경로면 탐색기)
- 우클릭 → 컨텍스트 메뉴 (열기, 경로 복사, 이름 수정, 아이콘 수정, 제거)
- 드래그 앤 드롭으로 패널 내 순서 변경
- 패널 간 드래그 앤 드롭으로 이동

### 13-5. 아이템 추가 방법

1. **URL 입력**: 하단 드롭존에 URL 직접 입력
2. **파일 드래그**: 로컬 파일을 패널에 드롭
3. **Drive 파일 드래그**: Drive 파일을 Local 패널로 드래그 (다운로드 없이 webViewLink 추가)
4. **링크 추가 버튼**: 인라인 URL 입력 폼

### 13-6. 패널 메모 태그 영역

- 패널 하단에 태그 목록 표시
- 입력창 → Enter로 태그 추가
- 각 태그에 카테고리 컬러 점 표시
- 태그 ✕ 버튼으로 삭제

### 13-7. 카테고리 편집 팝업 (CEP)

- 아이콘 선택 그리드 (이모지 선택)
- 이름 입력
- 색상 팔레트 (21색)
- 타입 전환: 로컬 / Drive
- Drive 타입 시: 루트 폴더 ID 입력란

### 13-8. 패널 드래그 순서 변경

- 상단 컬러 바를 드래그하여 패널 순서 재배치
- 드래그 중: 원본 패널 투명화 + 고스트 엘리먼트 표시
- 삽입 위치: 좌/우 보라색 인디케이터 선

### 13-9. 색상 팔레트 (카테고리 컬러)

8가지 기본 컬러 + 각 컬러별 배경/테두리/태그 스타일:

| 컬러명 | 주색 |
|--------|------|
| Red | `#f87171` |
| Blue | `#60a5fa` |
| Green | `#34d399` |
| Purple | `#a78bfa` |
| Yellow | `#fbbf24` |
| Pink | `#f472b6` |
| Indigo | `#818cf8` |
| Teal | `#2dd4bf` |

---

## 14. 메모 · 할 일 패널

### 14-1. 구조

```
┌─────────────────────────────────────┐
│ ✅ 메모 · 할 일  [정리] [↻]         │
├─────────────────────────────────────┤
│ ○ 할 일 항목 1            🔔 ✕      │
│ ✓ 완료된 할 일 (취소선)             │
│ ○ 할 일 항목 2  [G]       🔔 ✕     │
├─────────────────────────────────────┤
│ [할 일 입력 후 Enter ↵]       [+]   │
└─────────────────────────────────────┘
```

### 14-2. 할 일 항목 데이터 구조

```javascript
{
  id: "todo_1234567890",  // 로컬 ID
  text: "할 일 내용",
  done: false,
  alarm: null,            // ISO datetime string or null
  gtaskId: "xyz123",      // Google Tasks ID (연동 시)
}
```

### 14-3. 기능

| 기능 | 동작 |
|------|------|
| 항목 추가 | 입력창 Enter 또는 + 버튼 |
| 완료 체크 | 원형 체크 버튼 클릭 (완료 시 취소선 + 투명도 낮춤) |
| 항목 삭제 | 호버 시 나타나는 ✕ 버튼 |
| 완료 정리 | "정리" 버튼 → 완료 항목 일괄 삭제 |
| Google Tasks 동기화 | ↻ 버튼 (Google 연결 시 표시) |
| ✅ 아이콘 클릭 | Google Tasks 웹 열기 (`https://tasks.google.com`) |

### 14-4. Google Tasks 배지

- Google Tasks에서 가져온 항목에 파란 `G` 배지 표시 (hover 시)
- 배지 상시 표시 옵션: `badge-on` CSS 클래스

---

## 15. 알림(Alarm) 시스템

### 15-1. 두 가지 알림 유형

| 유형 | 설정 위치 | 방식 |
|------|-----------|------|
| 할 일 알림 | 할 일 항목의 🔔 버튼 | 미니 팝업에서 날짜/시간 선택 |
| 캘린더 이벤트 알림 | 일정 추가 다이얼로그 | 이벤트 저장 시 함께 저장 |

### 15-2. 알림 체크 메커니즘

- 1분 간격으로 `setInterval`로 현재 시각과 알림 시각 비교
- 알림 발화 시 전체 화면 알림 오버레이 표시

### 15-3. 알림 오버레이

```
┌─────────────────────────────────────┐
│              🔔                     │
│              알림                   │
│      [할 일/이벤트 제목]            │
│      [날짜 시간]                    │
│                                     │
│          [  확인  ]                 │
└─────────────────────────────────────┘
```

- 🔔 아이콘 진동 애니메이션 (3회)
- "확인" 클릭으로 닫기
- 창이 숨겨진 경우 `focus-window` IPC로 창 앞으로 가져오기

### 15-4. 알림 미니 팝업

- 할 일 항목 🔔 클릭 → 작은 팝업
- 날짜/시간 칩 클릭 → 날짜 피커 연동
- 저장/해제 버튼
- `todoAlarms` localStorage에 저장

---

## 16. 화면 캡처

### 16-1. 플로우

1. 아이콘 피커에서 "화면 캡처" 선택
2. `start-screen-capture` IPC 호출
3. main.js:
   - 현재 클립보드 상태 해시 저장 (비교용)
   - 창 최소화 (`win.minimize()`)
   - `ms-screenclip:` URI로 Windows 캡처 도구 실행 (`shell.openExternal`)
   - 실패 시 폴백: `SnippingTool.exe /clip` (`child_process.exec`)
4. 클립보드 폴링 (300ms 간격, 최대 60초)
5. 새 이미지 감지 시:
   - **Center-crop**: 정사각형으로 중앙 크롭 (`NativeImage.crop`)
   - **Resize**: 64×64 px로 축소 (`NativeImage.resize`)
   - dataURL 변환
   - 창 복귀 (`win.restore()`, `win.show()`, `win.focus()`)
   - 350ms 후 `capture-image-ready` 이벤트로 렌더러 전달
6. 렌더러에서 아이콘 피커 재오픈 + 프리뷰 업데이트

### 16-2. 결과 활용

- 캡처한 이미지는 카테고리 아이템의 아이콘으로 사용
- dataURL 형태로 localStorage에 저장

---

## 17. 아이콘 피커

### 17-1. 구조

```
┌─────────────────────────┐
│ [프리뷰] 아이콘 선택     │
│                         │
│ [탭1] [탭2] [탭3] ...   │
│                         │
│ [이모지 그리드 7열]     │
│ (최대 188px 높이, 스크롤)│
│                         │
│ [커스텀 이미지 ▲] [취소] [확인] │
└─────────────────────────┘
```

### 17-2. 이모지 탭 구성

| 탭 | 내용 |
|----|------|
| 🌟 전체 | 모든 이모지 |
| 💼 업무 | 업무 관련 이모지 |
| 📁 파일 | 파일/폴더 관련 |
| 🔧 도구 | 도구/설정 관련 |
| 📱 앱 | 앱/기술 관련 |
| 😊 기타 | 기타 이모지 |

### 17-3. 커스텀 이미지 서브메뉴

"커스텀 이미지" 버튼 클릭 시 서브메뉴 표시:

| 옵션 | 동작 |
|------|------|
| Google Drive에서 가져오기 | Drive 이미지 목록 팝업 열기 |
| 화면 캡처 | 캡처 도구 실행 플로우 시작 |

### 17-4. Drive 이미지 선택

- Drive 이미지 목록 조회 (`list-drive-images`)
- 이미지 클릭 → `get-drive-image-data`로 Base64 로드
- 64×64 프리뷰 표시
- 확인 시 dataURL을 아이콘으로 저장

---

## 18. 배율(Scale) 시스템

### 18-1. 방식

- **CSS `transform: scale()` 금지** — 전체 레이아웃을 뷰포트에 맞게 확장
- CSS 커스텀 프로퍼티(`--scale`, `--fs-base` 등)로 폰트/패딩/크기 조절
- `injectScaleStyle()` 함수로 모든 컴포넌트에 동적 스타일 주입

### 18-2. 적용 범위

```javascript
// CSS 변수
--scale: 1.0        // 배율 (소수)
--fs-base: 12px     // 기본 폰트 (12 * ratio)
--fs-sm: 11px
--fs-xs: 10px
--fs-md: 13.5px
--fs-lg: 16px
--pad-card: 10px
--gap-layout: 9px
--side-w: 280px     // 사이드바 너비
--topbar-h: 48px    // 상단 바 높이
--r-card: 18px      // 카드 모서리 반경
```

### 18-3. 배율 범위

- 최소: 60%, 최대: 150%, 스텝: 5%
- localStorage(`appScale`)에 저장

### 18-4. 배율 UI

| 위치 | 형태 |
|------|------|
| 초기 설정 Step 0 | 슬라이더 + 프리셋 버튼 + 미리보기 |
| 플로팅 배율 조절기 | 우하단 고정 패널 (−/+ 버튼 + 슬라이더) |
| 설정 모달 표시 탭 | 슬라이더 + 프리셋 버튼 |

---

## 19. 창 관리

### 19-1. 창 속성

| 속성 | 값 |
|------|-----|
| 프레임 | 없음 (`frame: false`) |
| 크기 | 현재 디스플레이 작업 영역 전체 |
| 크기 조절 | 불가 (`resizable: false`) |
| 이동 | 가능 (`movable: true`) — 드래그로 모니터 간 이동 |
| 항상 앞에 표시 | 기본 꺼짐 (트레이 메뉴에서 토글 가능) |
| 작업 표시줄 | 숨김 (`skipTaskbar: true`) |
| 그림자 | 없음 (`hasShadow: false`) |

### 19-2. 멀티모니터 지원

- 창 이동 후(`moved` 이벤트) 현재 디스플레이 작업 영역 전체로 자동 스냅
- `window-bounds.json`에 디스플레이 ID 저장
- 앱 재실행 시 저장된 디스플레이가 연결되어 있으면 해당 모니터에 복원
- 저장된 디스플레이가 없으면 커서 위치 디스플레이로 폴백

### 19-3. 창 표시/숨기기

- `win.hide()` / `win.showInactive()` (포커스 도용 없이 표시)
- `close` 이벤트에서 `preventDefault()` → 숨기기만 함 (종료 안 함)
- 글로벌 단축키: `Ctrl+Alt+D`

---

## 20. 시스템 트레이

| 기능 | 동작 |
|------|------|
| 트레이 아이콘 | 16×16 보라색 PNG (코드 내 동적 생성) |
| 단클릭 | 대시보드 토글 (표시/숨기기) |
| 더블클릭 | 대시보드 토글 |
| 우클릭 | 컨텍스트 메뉴 |

**트레이 컨텍스트 메뉴:**
- 대시보드 숨기기 / 보이기 (현재 상태에 따라 전환)
- 항상 앞에 표시 (체크박스)
- 종료

---

## 21. 자동 업데이트

### 21-1. 설정

```json
{
  "provider": "github",
  "owner": "ggugguai-star",
  "repo": "Dashboard",
  "releaseType": "release"
}
```

- `autoDownload: true` — 업데이트 발견 시 자동 다운로드
- `autoInstallOnAppQuit: true` — 앱 종료 시 자동 설치

### 21-2. 업데이트 UI 플로우

| 상태 | UI |
|------|-----|
| 업데이트 발견 | 상단 배너 슬라이드 인 + 버전 표시 |
| 다운로드 중 | 배너에 진행률 표시 |
| 다운로드 완료 | "지금 설치" 버튼 활성화 |
| 설치 중 | 전체 화면 오버레이 + 스피너 |

### 21-3. 설치 방식

- `autoUpdater.quitAndInstall(true, true)`: NSIS silent + 설치 후 재시작
- 업데이트 확인: 앱 시작 3초 후 자동 (`ready-to-show` + 3s timeout)
- 수동 확인: 설정 모달 > 일반 탭 > "업데이트 확인" 버튼

### 21-4. 버전 관리

- **반드시 semver 3자리** (1.x.y) — electron-builder는 4자리 버전 거부
- 빌드 명령: `npm run release` = `electron-builder --win --publish always`
- 환경변수: `$env:GH_TOKEN` (PowerShell에서 주입)

---

## 22. 설정 모달

### 22-1. 탭 구성

| 탭 | 내용 |
|----|------|
| 🖥️ 화면 표시 | 배율 슬라이더 및 프리셋 |
| 📁 카테고리 | 카테고리 추가/수정/삭제/순서 변경 |
| 🔗 연동 | Google 연결/해제, Drive 폴더 ID 설정 |
| ⚙️ 일반 | 자동 실행, 앱 버전, 업데이트 확인 |

### 22-2. 카테고리 탭

- 현재 카테고리 목록을 편집용으로 복사 (`spCats`)
- 드래그 앤 드롭으로 순서 변경 (커스텀 드래그 고스트 표시)
- 아이콘 입력, 이름 입력, 색상 스와치 클릭 → 색상 팔레트 팝오버
- 카테고리 삭제 (최소 1개 유지)
- 카테고리 추가 (최대 7개)
- "적용" 클릭 시 실제 카테고리에 반영

### 22-3. Google 연동 탭

- 현재 연결 상태 표시 (연결됨/미연결)
- "Google 계정으로 연결" 버튼
- "연결 해제" 버튼 (토큰 삭제)
- Weekly Plan Drive 폴더 ID 입력
- 메모 Drive 폴더 ID 입력

### 22-4. 일반 탭

- Windows 시작 시 자동 실행 토글
- 현재 앱 버전 표시 (`get-app-version` IPC)
- "업데이트 확인" 버튼 (`check-for-updates` IPC)
- 업데이트 상태 텍스트 표시

---

## 23. 렌더링 성능 최적화

### 23-1. Electron 앱 명령 스위치 (main.js)

```javascript
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
```

- 백그라운드 상태에서도 타이머/렌더러 쓰로틀링 비활성화
- GPU 래스터화로 CSS 애니메이션 하드웨어 가속

### 23-2. BrowserWindow 설정

```javascript
{
  backgroundThrottling: false,  // 비활성 상태에서도 60fps 유지
}
```

### 23-3. CSS 최적화

- 드래그 아이템에 `will-change: transform, opacity`
- 카테고리 패널에 `will-change: transform, box-shadow`
- 이벤트 다이얼로그에 `will-change: transform, opacity`

---

## 부록: 주요 알려진 이슈 및 해결 기록

| 이슈 | 원인 | 해결 |
|------|------|------|
| 한글 일정 제목 깨짐 | Node.js HTTP 응답 청크를 UTF-8 없이 합산 시 멀티바이트 문자 분할 손상 | 모든 `res.on('data')` 핸들러 앞에 `res.setEncoding('utf8')` 추가 |
| 새로고침 버튼 박스가 함께 회전 | `transform: rotate()` 가 부모 요소 전체에 적용됨 | `<span class="sync-ico">` 자식 요소에만 transform 적용 |
| Tasks 재로그인 후 동기화 안됨 | 로그아웃 시 `_gtasksListId` 초기화 누락 + 재로그인 후 `checkGoogleAuth()` 미호출 | `doGoogleDisconnect()`에서 Tasks 상태 초기화, `onAuthUpdate`에서 `checkGoogleAuth()` 호출 |
| `1.3.1.1` 버전 빌드 실패 | electron-builder는 semver 3자리만 허용 | 4자리 버전 사용 금지 |
| Tasks API 403 오류 | Google 동의 화면에서 Tasks 스코프 미승인 | 사용자가 동의 화면에서 "계속" 클릭 필요 |
